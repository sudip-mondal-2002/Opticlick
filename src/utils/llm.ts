/**
 * LLM integration for the Opticlick agent.
 *
 * Public API:
 *   createModel(apiKey)  — create a configured ChatGoogleGenerativeAI instance
 *   callModel(...)       — assemble prompt, stream model response, parse tool calls → AgentResult
 *
 * Internal pipeline (each step is its own function):
 *   buildHistory        — convert stored turns into LangChain BaseMessages
 *   buildUserMessage    — assemble the multipart human turn (text + images)
 *   streamWithRetry     — stream the model with exponential back-off; flushes thinking tokens live
 *   parseResponse       — extract reasoning + typed AgentActions from the merged stream chunks
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage, type AIMessageChunk } from '@langchain/core/messages';
import { AGENT_TOOLS, parseToolCall } from './tools';
import type { AgentAction, AgentResult, TodoItem } from './types';
import type { VFSFile, MemoryEntry } from './db';
import { formatTodoForPrompt } from './todo';
import { formatMemoryForPrompt } from './memory';
import { formatScratchpadForPrompt } from './scratchpad';
import type { ScratchpadEntry } from './scratchpad';
import { DEFAULT_MODEL, OLLAMA_BASE_URL, isOllamaModel, ollamaModelName } from './models';

const MAX_API_RETRIES = 5;
const RATE_LIMIT_DELAY_MS = 10_000;
const THINKING_LEVEL = 'HIGH';

// ─────────────────────────────────────────────────────────────────────────────
// System prompt — reasoning guidelines only; capabilities live in tool schemas
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTIONS = `You are an autonomous web agent that browses ANY website using the Set-of-Mark technique.
Every screenshot has interactable elements numbered with blue bounding boxes.
You have full read/write access to a Virtual Filesystem (VFS) that persists for the session.

REASONING GUIDELINES:
- Look at the screenshot closely: what page am I on? What state is it in?
- What is the user's goal? How close am I to achieving it?
- For IRREVERSIBLE actions (submit/buy/delete), confirm inputs are correct first.
- If a previous action failed or produced unexpected results, reassess before repeating.
- Prefer navigate over guessing form submissions when the target URL is known.
- Use fetch_dom when the screenshot lacks detail (link hrefs, table rows, hidden attributes, clipped text).
- Use vfs_download for remote files instead of clicking download links.
- Capture screenshots at key moments; write scraped data to VFS files.
- Use wait when a page needs time to settle after an interaction before the next action.

RULES:
- Call todo_create on the FIRST step if no todo list exists yet — MANDATORY. Always combine it with the primary UI action for that turn; never use todo_create as your only tool call.
- Call todo_update every turn: mark items done/in_progress and add observations.
- You may combine any number of VFS/todo/DOM tool calls with AT MOST ONE UI action per turn.
- UI actions are: click, type, navigate, scroll, press_key. Type is used AFTER a click to enter text into the focused element.
- Todo, VFS, and fetch_dom calls execute BEFORE the UI action.
- When the task contains an explicit HTTP/HTTPS URL (e.g. "https://example.com"), call navigate with that URL immediately in the current turn.
- When explicitly instructed to call finish, or when all todo items are done and the user's goal is fully accomplished, call finish immediately.

OPERATING RULES — ORIENTATION:
- ORIENTATION CHECK: At the start of every turn, ask yourself: "Is the current page directly relevant to completing the user's task?" If the answer is no (e.g. you ended up on a profile page, settings page, or unrelated site), do NOT keep clicking around. Immediately call navigate to return to the URL provided in [CONTEXT] or the last known relevant URL. One wrong click does not justify five more wrong clicks trying to recover organically.
- SELF-CORRECTION: If your todo list shows an item as in_progress but the last 2 turns have not made progress on it, treat the current approach as blocked. Use todo_add to insert a recovery step (e.g. "navigate-back-to-issue") and execute it immediately.

OPERATING RULES — RESILIENT NAVIGATION:
- VERIFY NAVIGATION: After every click or navigate action, confirm the URL changed or the DOM
  updated in a meaningful way. If the URL before and after is identical and no new content
  appeared, treat the action as FAILED and do not count it as progress.
- NO REPEAT FAILURES: Do not attempt the same failed click, scroll, or "Show More" action
  more than 3 times in a row. After 3 identical failed attempts, PIVOT: switch to URL
  manipulation (use navigate with a reconstructed URL such as google.com/search?q=…) or
  try a completely different interaction path.
- PREFER ORGANIC RESULTS: When a Google AI Overview / SGE summary box is present, prefer
  the organic web-result <a> links below it over any AI-cited source links inside the
  summary. If an AI-cited link fails to navigate (URL unchanged after click), immediately
  fall back to the organic results section and select the top <a> result there instead.
- PREFER SEMANTIC TARGETS: When multiple annotated elements overlap the same region, always
  target the innermost semantic element (<a>, <button>, <input>) rather than a parent <div>
  or layout container. A click on a <div> wrapper is less reliable than a click on the <a>
  it contains.
- FINISH AND STOP: Once the user's goal is fully accomplished, call finish() immediately and
  do NOT take any further actions. Do not keep scrolling, clicking, or messaging after the
  task is done. If you are waiting for an external response (e.g. a friend to reply to a
  message), call wait() or finish() — do not send repeated messages while waiting.

MEMORY GUIDELINES:
- You have a persistent long-term memory that survives across sessions. Its current contents are shown in each prompt.
- When you discover NEW useful information about the user, call memory_upsert to save it.
- Examples worth remembering: usernames, email addresses, display names, locale/timezone, organization memberships, commonly used accounts.
- If you see the user is logged in on a site, remember their account info (username, display name, email).
- Do NOT store passwords, tokens, API keys, or other sensitive credentials.
- Use descriptive namespaced keys like "github/username", "google/email", "twitter/handle".
- If a value changes (e.g. user changed their display name), call memory_upsert with the new value — it will be merged.
- Call memory_delete to remove stale or incorrect entries.

SCRATCHPAD GUIDELINES:
- You have an in-session scratchpad for accumulating intermediate findings within the current task.
- Call note_write PROACTIVELY whenever you discover partial results: items found while scrolling, data extracted from a page, running totals, or anything you need to remember for the next turn.
- When gathering a list across multiple scrolls or pages, ALWAYS update the scratchpad with ALL items found so far (not just the new ones) before moving on.
- The scratchpad is shown in every subsequent prompt so you will not lose track of accumulated data.
- The scratchpad is cleared at session end — use memory_upsert instead for facts to keep across sessions.
- Use short descriptive keys: "issues_found", "emails_collected", "search_results", "count".`;


// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface InlineImage {
  name: string;
  mimeType: string;
  /** Base64-encoded data (no data-URL prefix). */
  data: string;
}

type LogFn = (msg: string, level?: string) => Promise<void>;
export type AnyModel = ChatGoogleGenerativeAI | ChatOllama;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoundModel = any;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Return the index at which to flush the buffered thinking text.
 * Flushes at the last sentence-end (. ! ?) if the buffer is long enough,
 * otherwise at the last word boundary, otherwise 0 (don't flush yet).
 * Exported for unit testing.
 */
export function thinkingFlushPoint(buf: string, minLen = 120): number {
  if (buf.length < minLen) return 0;
  // Walk backwards looking for a sentence-end followed by whitespace or end-of-string
  for (let i = buf.length - 1; i >= minLen / 2; i--) {
    if ('.!?'.includes(buf[i]) && (i + 1 >= buf.length || buf[i + 1] === ' ' || buf[i + 1] === '\n')) {
      return i + 1;
    }
  }
  // No sentence boundary — flush at last space to avoid splitting a word
  const lastSpace = buf.lastIndexOf(' ');
  return lastSpace > minLen / 2 ? lastSpace + 1 : 0;
}

/** Extract any thinking-token delta from a stream chunk. Exported for unit testing. */
export function thinkingDeltaOf(chunk: AIMessageChunk): string {
  // Gemini surfaces thinking either in additional_kwargs.thinking …
  const fromKwargs = (chunk.additional_kwargs?.thinking as string | undefined) ?? '';
  // … or as content-array blocks with type === 'thinking'
  let fromContent = '';
  if (Array.isArray(chunk.content)) {
    for (const part of chunk.content as Array<{ type: string; thinking?: string }>) {
      if (part.type === 'thinking' && part.thinking) fromContent += part.thinking;
    }
  }
  return fromKwargs + fromContent;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt assembly
// ─────────────────────────────────────────────────────────────────────────────

/** Convert stored conversation turns into LangChain BaseMessages. */
function buildHistory(history: { role: string; content: string }[]): BaseMessage[] {
  return history.map((turn) =>
    turn.role === 'user' ? new HumanMessage(turn.content) : new AIMessage(turn.content),
  );
}

/** Render the VFS file listing as a context block. */
function vfsContextBlock(files: VFSFile[]): string {
  if (files.length === 0) return '\n\n── Virtual Filesystem (VFS) — currently empty ──';
  const rows = files
    .map(
      (f) =>
        `  id="${f.id}"  name="${f.name}"  type="${f.mimeType}"  size=${f.size}B  created=${new Date(f.createdAt).toISOString()}`,
    )
    .join('\n');
  return `\n\n── Virtual Filesystem (VFS) — current contents ──\n${rows}`;
}

/** Render the todo list as a context block. */
function todoContextBlock(todo: TodoItem[]): string {
  if (todo.length > 0) return `\n\n── Todo List ──\n${formatTodoForPrompt(todo)}`;
  return '\n\n── Todo List — not created yet. Call todo_create this turn. ──';
}

/** Render the memory store as a context block. */
function memoryContextBlock(entries: MemoryEntry[]): string {
  return formatMemoryForPrompt(entries);
}

/** Render the scratchpad as a context block. */
function scratchpadContextBlock(entries: ScratchpadEntry[]): string {
  return formatScratchpadForPrompt(entries);
}

/**
 * Build the multipart human turn: task description, VFS listing, todo state,
 * optional reference images, and the annotated screenshot.
 *
 * @param ollamaFormat - When true, images use the OpenAI-compatible
 *   `{ type: 'image_url', image_url: { url: '...' } }` format required by
 *   @langchain/ollama. When false (default), uses the Gemini-native
 *   `{ type: 'image', url: '...' }` format.
 */
function buildUserMessage(
  userPrompt: string,
  vfsFiles: VFSFile[],
  currentTodo: TodoItem[],
  inlineImages: InlineImage[],
  base64Image: string,
  memoryEntries: MemoryEntry[] = [],
  scratchpadEntries: ScratchpadEntry[] = [],
  ollamaFormat = false,
): HumanMessage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: Array<any> = [
    {
      type: 'text',
      text: `User task: ${userPrompt}${vfsContextBlock(vfsFiles)}${todoContextBlock(currentTodo)}${memoryContextBlock(memoryEntries)}${scratchpadContextBlock(scratchpadEntries)}`,
    },
  ];

  const imageBlock = (dataUrl: string) =>
    ollamaFormat
      ? { type: 'image_url', image_url: { url: dataUrl } }
      : { type: 'image', url: dataUrl };

  if (inlineImages.length > 0) {
    content.push({
      type: 'text',
      text: `\n\n── User-provided reference images (${inlineImages.length}) ──`,
    });
    for (const img of inlineImages) {
      content.push({ type: 'text', text: `[${img.name}]` });
      content.push(imageBlock(`data:${img.mimeType};base64,${img.data}`));
    }
  }

  content.push({
    type: 'text',
    text: '\n\nAnalyze the annotated screenshot and call the appropriate tools.',
  });
  content.push(imageBlock(`data:image/png;base64,${base64Image}`));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new HumanMessage({ content: content as any });
}

// ─────────────────────────────────────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract reasoning text and typed AgentActions from the merged stream response.
 * Thinking tokens are NOT logged here — they are flushed live during streaming.
 */
function parseResponse(response: AIMessageChunk): { reasoning: string; actions: AgentAction[] } {
  const reasoning =
    typeof response.content === 'string'
      ? response.content
      : (response.content as Array<{ type: string; text?: string }>)
          .filter((p) => p.type === 'text')
          .map((p) => p.text ?? '')
          .join('');

  const toolCalls = response.tool_calls ?? [];
  if (toolCalls.length === 0) {
    throw new Error('Model returned no tool calls — cannot determine action.');
  }

  const actions = toolCalls
    .map((tc) => parseToolCall(tc.name, tc.args as Record<string, unknown>))
    .filter((a): a is NonNullable<typeof a> => a !== null);

  return { reasoning: reasoning.trim(), actions };
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry loop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stream the model response with exponential back-off on failure.
 * Thinking tokens are flushed to logFn at sentence boundaries as they arrive.
 * Tool calls are collected across all chunks and parsed once the stream ends.
 * Rate-limit (429) errors use a longer base delay than general errors.
 */
async function streamWithRetry(
  modelWithTools: BoundModel,
  messages: BaseMessage[],
  logFn: LogFn,
): Promise<{ reasoning: string; actions: AgentAction[] }> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      const stream = await modelWithTools.stream(messages);
      const chunks: AIMessageChunk[] = [];
      let thinkingBuf = '';
      let streamedThinkingChars = 0;

      for await (const rawChunk of stream) {
        const chunk = rawChunk as AIMessageChunk;

        // Accumulate thinking tokens and flush at sentence boundaries
        const delta = thinkingDeltaOf(chunk);
        if (delta) {
          thinkingBuf += delta;
          streamedThinkingChars += delta.length;
          const flushAt = thinkingFlushPoint(thinkingBuf);
          if (flushAt > 0) {
            await logFn(thinkingBuf.slice(0, flushAt).trim(), 'think');
            thinkingBuf = thinkingBuf.slice(flushAt);
          }
        }

        chunks.push(chunk);
      }

      // Flush any remaining buffered thinking from per-chunk streaming
      if (thinkingBuf.trim()) {
        await logFn(thinkingBuf.trim(), 'think');
      }

      if (chunks.length === 0) throw new Error('Empty stream response');

      // Merge all chunks into a single message so tool_calls are fully assembled
      const final = chunks.reduce((acc, c) => acc.concat(c));

      // Fallback: some Gemini model versions only surface thinking in additional_kwargs
      // of the final merged message, not in individual stream chunks.
      // Split into paragraphs so long thinking is displayed as multiple log entries.
      if (streamedThinkingChars === 0) {
        const mergedThinking = (final.additional_kwargs?.thinking as string | undefined) ?? '';
        if (mergedThinking.trim()) {
          // Split on double newlines or sentence boundaries for readability
          const paragraphs = mergedThinking.split(/\n\n+/).filter((p) => p.trim());
          if (paragraphs.length > 3) {
            // If many paragraphs, log the first one and summarize the rest
            await logFn(paragraphs[0].trim(), 'think');
            await logFn(`[${paragraphs.length - 1} more thinking steps…]`, 'think');
          } else {
            // Otherwise log each paragraph separately for progressive appearance
            for (const para of paragraphs) {
              await logFn(para.trim(), 'think');
            }
          }
        }
      }

      return parseResponse(final);
    } catch (err) {
      lastError = err as Error;
      const isRateLimit =
        lastError.message.includes('429') ||
        lastError.message.toLowerCase().includes('rate limit');

      if (attempt < MAX_API_RETRIES) {
        if (isRateLimit) {
          const delay = RATE_LIMIT_DELAY_MS * attempt;
          await logFn(
            `Rate limited (attempt ${attempt}/${MAX_API_RETRIES}). Waiting ${delay / 1000}s…`,
            'warn',
          );
          await sleep(delay);
        } else {
          await logFn(`API attempt ${attempt} failed: ${lastError.message}. Retrying…`, 'warn');
          await sleep(1500 * attempt);
        }
      }
    }
  }

  throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function createModel(apiKey: string, modelId?: string): ChatGoogleGenerativeAI {
  const model = modelId ?? DEFAULT_MODEL;

  // Extended thinking is supported only on Gemini 2.5 and 3.1 models.
  // Gemini 4.x (Gemma) models do NOT support extended thinking.
  const supportsThinking = !model.includes('gemini-4-');

  interface ModelConfig {
    model: string;
    apiKey: string;
    temperature: number;
    maxRetries: number;
    thinkingConfig?: { thinkingLevel: 'THINKING_LEVEL_UNSPECIFIED' | 'LOW' | 'MEDIUM' | 'HIGH'; includeThoughts: boolean };
  }
  const config: ModelConfig = {
    model,
    apiKey,
    temperature: 0.1,
    maxRetries: 0,
  };

  if (supportsThinking) {
    config.thinkingConfig = {
      thinkingLevel: THINKING_LEVEL,
      includeThoughts: true,
    };
  }

  return new ChatGoogleGenerativeAI(config);
}

export function createOllamaModel(modelId: string): ChatOllama {
  return new ChatOllama({
    model: ollamaModelName(modelId),
    baseUrl: OLLAMA_BASE_URL,
    temperature: 0.1,
  });
}

/**
 * Unified factory — returns a Gemini or Ollama model depending on the model ID.
 * For Ollama models, apiKey is ignored (may be null).
 * For Gemini models, apiKey is required.
 */
export function createAnyModel(apiKey: string | null, modelId: string): AnyModel {
  if (isOllamaModel(modelId)) return createOllamaModel(modelId);
  if (!apiKey) throw new Error('Gemini API key required for Gemini models');
  return createModel(apiKey, modelId);
}

export async function callModel(
  model: AnyModel,
  base64Image: string,
  userPrompt: string,
  history: { role: string; content: string }[] = [],
  logFn: LogFn = async () => {},
  vfsFiles: VFSFile[] = [],
  inlineImages: InlineImage[] = [],
  currentTodo: TodoItem[] = [],
  memoryEntries: MemoryEntry[] = [],
  scratchpadEntries: ScratchpadEntry[] = [],
): Promise<AgentResult> {
  const ollamaFormat = model instanceof ChatOllama;
  const messages: BaseMessage[] = [
    new SystemMessage(SYSTEM_INSTRUCTIONS),
    ...buildHistory(history),
    buildUserMessage(userPrompt, vfsFiles, currentTodo, inlineImages, base64Image, memoryEntries, scratchpadEntries, ollamaFormat),
  ];

  const modelWithTools = model.bindTools([...AGENT_TOOLS]);
  const { reasoning, actions } = await streamWithRetry(modelWithTools, messages, logFn);
  return { reasoning, actions, done: actions.some((a: AgentAction) => a.type === 'finish') };
}
