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
import { HumanMessage, SystemMessage, AIMessage, ToolMessage, type BaseMessage, type AIMessageChunk } from '@langchain/core/messages';
import { AGENT_TOOLS, parseToolCall } from './tools';
import type { AgentAction, AgentResult, RawToolCall, TodoItem, CoordinateEntry } from './types';
import type { VFSFile, MemoryEntry, ConversationTurn } from './db';
import { formatTodoForPrompt } from './todo';
import { formatMemoryForPrompt } from './memory';
import { formatScratchpadForPrompt } from './scratchpad';
import type { ScratchpadEntry } from './scratchpad';
import { DEFAULT_MODEL, OLLAMA_BASE_URL, isOllamaModel, ollamaModelName } from './models';
import { getLangSmithTracer } from './langsmith-config';

const MAX_API_RETRIES = 5;
const RATE_LIMIT_DELAY_MS = 10_000;
const THINKING_LEVEL = 'HIGH';

// ─────────────────────────────────────────────────────────────────────────────
// System prompt — reasoning guidelines only; capabilities live in tool schemas
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTIONS = `You are an elite, autonomous web-operating AI agent. You browse any website using the Set-of-Mark (SOM) visual technique (interactable elements are numbered with blue bounding boxes) and have full read/write access to a persistent Virtual Filesystem (VFS).

Your primary directive is to accomplish the user's goals reliably, efficiently, and with rigorous logical reasoning.

=========================================
1. COGNITIVE FRAMEWORK: THE REASONING ENGINE
=========================================
Before making ANY tool calls, you must explicitly reason through the current state. Adopt the OODA loop (Observe, Orient, Decide, Act):
- OBSERVE: What is the exact state of the page? (Look at the URL, visible UI, modals, errors).
- ORIENT: Did my last action succeed? (Compare current state to expected state). Am I on the right path, or trapped in a distraction/rabbit hole?
- DECIDE: What is the optimal next step? Do I need more information (fetch_dom, ask_user), state management (note_write, todo_update), or a UI action?
- ACT: Execute the chosen tools.

=========================================
2. PLANNING & STATE MANAGEMENT
=========================================
- MANDATORY INITIALIZATION: Call \`todo_create\` on your VERY FIRST turn. Establish a concrete, multi-step plan. Never use \`todo_create\` as the sole tool call; combine it with the first logical action.
- RELENTLESS UPDATING: Call \`todo_update\` every turn to mark progress, document failures, and adapt the plan.
- SCRATCHPAD (\`note_write\`): Proactively log intermediate data (prices, names, extracted text, running totals). Do not rely on your context window to remember fragmented data across multiple pages. Overwrite/append dynamically so your scratchpad contains the ultimate truth.
- LONG-TERM MEMORY (\`memory_upsert\`, \`memory_delete\`): Persist cross-session user facts (usernames, preferences, default locations) via namespaced keys (e.g., "github/username"). Do NOT store passwords or highly sensitive PII.

=========================================
3. TOOL EXECUTION CONSTRAINTS
=========================================
- ACTION LIMITS: You may execute ANY number of non-UI tool calls (todo, VFS, fetch_dom, memory, note) per turn, but AT MOST ONE UI action (click, type, navigate, scroll, press_key) per turn.
- EXECUTION ORDER: Always execute state, memory, and analytical tool calls BEFORE your single UI action.
- HYBRID ACTIONS: \`type\` should only be used AFTER a \`click\` to focus the input field, OR if the field is verifiably auto-focused.
- EARLY EXIT: The moment the user's core objective is achieved, call \`finish()\` immediately. Do not linger, do not click around, do not "double check" if the success state is visually obvious.

=========================================
4. ADVANCED WEB STRATEGIES & RESILIENCE
=========================================
- MODALS & INTERRUPTIONS: Relentlessly hunt for and dismiss blocking elements (cookie banners, newsletter popups, login walls). If a modal blocks your target, your ONLY goal is to clear it first.
- SPAs & DYNAMIC UI: Modern web apps update without changing URLs. Verify success via visual DOM changes, not just URL checks. If a loading spinner appears, use \`wait(1000 - 3000)\` before assuming failure.
- TARGET SEMANTICS: Always aim for the innermost semantic SOM marker (<a>, <button>, <input>). Avoid clicking generic <div> or parent containers unless absolutely necessary.
- AI OVERVIEWS: When navigating Search Engines, always prefer organic organic links (<a> tags) over AI-generated summary citations, which often break or lead to unpredictable anchor links.
- VFS OVER BROWSER: If the task requires downloading files (PDFs, CSVs, images), use \`vfs_download\` on the target URL rather than clicking the link in the UI, which may trigger unmanageable browser dialogs.
- INVISIBLE DATA: If the screenshot is too dense, text is clipped, or you need exact hrefs/attributes, immediately pause UI actions and use \`fetch_dom\` to read the underlying code.

=========================================
5. ANTI-STAGNATION & ERROR RECOVERY
=========================================
- THE 3-STRIKE RULE: Never attempt the exact same failed action (click, scroll, type) more than 3 times. If an element won't respond, PIVOT. 
- PIVOT STRATEGIES: 
   1. Bypass the UI by injecting the target into the URL via \`Maps()\` (e.g., manually constructing a search query: example.com/search?q=term).
   2. Target an alternative element that accomplishes the same goal.
   3. Refresh the page or navigate back to the root domain.
- ORIENTATION RECOVERY: If you find yourself on an irrelevant page (e.g., clicked an ad, ended up in user settings instead of the dashboard), DO NOT attempt to organically click your way out. Immediately use \`Maps()\` to hard-reset to the last known good URL or the original [CONTEXT] URL.
- IRREVERSIBLE ACTIONS: Before clicking "Submit", "Buy", "Delete", or "Send", you MUST verify all form inputs via the screenshot or DOM. If unsure, \`ask_user()\`.

=========================================
6. HUMAN INTERACTION BOUNDARIES
=========================================
- AMBIGUITY: Use \`ask_user()\` only when the task is critically blocked by missing context (e.g., "Which account should I use?", "Do you want the 16GB or 32GB model?"). 
- NEVER GUESS: Do not guess user preferences for financial transactions or destructive actions. 
- NO CHIT-CHAT: Do not use \`ask_user()\` for progress updates. Be a silent, efficient executor. Wait (\`wait()\`) for asynchronous human responses; do not spam messages.`;

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
function buildHistory(history: ConversationTurn[]): BaseMessage[] {
  return history.map((turn) => {
    if (turn.role === 'tool') {
      return new ToolMessage({
        tool_call_id: turn.toolCallId ?? '',
        content: turn.content,
        name: turn.toolName,
      });
    }
    if (turn.role === 'model' && turn.toolCalls?.length) {
      return new AIMessage({
        content: turn.content,
        tool_calls: turn.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          args: tc.args,
          type: 'tool_call' as const,
        })),
      });
    }
    if (turn.role === 'model') {
      return new AIMessage(turn.content);
    }
    return new HumanMessage(turn.content);
  });
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

/** Render annotated elements as a text index alongside the screenshot. */
function annotatedElementsBlock(coordinateMap: CoordinateEntry[]): string {
  if (coordinateMap.length === 0) return '';
  const rows = coordinateMap
    .map((e) => {
      const type = e.inputType ? `${e.tag}(${e.inputType})` : e.tag;
      return `[${e.id}] ${type} "${e.text}"`;
    })
    .join('\n');
  return `\n\n── Annotated Elements ──\n${rows}`;
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
  coordinateMap: CoordinateEntry[] = [],
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
    text: `\n\nAnalyze the annotated screenshot and call the appropriate tools.${annotatedElementsBlock(coordinateMap)}`,
  });
  content.push(imageBlock(`data:image/png;base64,${base64Image}`));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new HumanMessage({ content: content as any });
}

// ─────────────────────────────────────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract reasoning text, typed AgentActions, and raw tool calls from the merged stream response.
 * Thinking tokens are NOT logged here — they are flushed live during streaming.
 */
function parseResponse(response: AIMessageChunk): { reasoning: string; actions: AgentAction[]; rawToolCalls: RawToolCall[] } {
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

  const rawToolCalls: RawToolCall[] = toolCalls.map((tc) => ({
    id: tc.id ?? '',
    name: tc.name,
    args: tc.args as Record<string, unknown>,
  }));

  const actions = toolCalls
    .map((tc) => parseToolCall(tc.name, tc.args as Record<string, unknown>))
    .filter((a): a is NonNullable<typeof a> => a !== null);

  return { reasoning: reasoning.trim(), actions, rawToolCalls };
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
): Promise<{ reasoning: string; actions: AgentAction[]; rawToolCalls: RawToolCall[] }> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      const tracer = getLangSmithTracer();
      const streamOptions = tracer ? { callbacks: [tracer] } : {};
      const stream = await modelWithTools.stream(messages, streamOptions);
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
  history: ConversationTurn[] = [],
  logFn: LogFn = async () => {},
  vfsFiles: VFSFile[] = [],
  inlineImages: InlineImage[] = [],
  currentTodo: TodoItem[] = [],
  memoryEntries: MemoryEntry[] = [],
  scratchpadEntries: ScratchpadEntry[] = [],
  coordinateMap: CoordinateEntry[] = [],
): Promise<AgentResult> {
  const ollamaFormat = model instanceof ChatOllama;
  const messages: BaseMessage[] = [
    new SystemMessage(SYSTEM_INSTRUCTIONS),
    ...buildHistory(history),
    buildUserMessage(userPrompt, vfsFiles, currentTodo, inlineImages, base64Image, memoryEntries, scratchpadEntries, ollamaFormat, coordinateMap),
  ];

  const modelWithTools = model.bindTools([...AGENT_TOOLS]);
  const { reasoning, actions, rawToolCalls } = await streamWithRetry(modelWithTools, messages, logFn);
  return { reasoning, actions, done: actions.some((a: AgentAction) => a.type === 'finish'), rawToolCalls };
}
