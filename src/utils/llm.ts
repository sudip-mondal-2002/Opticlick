/**
 * LLM integration for the Opticlick agent.
 *
 * Public API:
 *   createModel(apiKey)  — create a configured ChatGoogleGenerativeAI instance
 *   callModel(...)       — assemble prompt, invoke model, parse tool calls → AgentResult
 *
 * Internal pipeline (each step is its own function):
 *   buildHistory        — convert stored turns into LangChain BaseMessages
 *   buildUserMessage    — assemble the multipart human turn (text + images)
 *   invokeWithRetry     — call the model with exponential back-off
 *   parseResponse       — extract reasoning + typed AgentActions from the response
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage, type AIMessageChunk } from '@langchain/core/messages';
import { AGENT_TOOLS, parseToolCall } from './tools';
import type { AgentAction, AgentResult, TodoItem } from './types';
import type { VFSFile } from './db';
import { formatTodoForPrompt } from './todo';

const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
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
- Call todo_create on the FIRST step if no todo list exists yet — MANDATORY.
- Call todo_update every turn: mark items done/in_progress and add observations.
- You may combine any number of VFS/todo/DOM tool calls with AT MOST ONE UI action per turn.
- Todo, VFS, and fetch_dom calls execute BEFORE the UI action.
- Only call finish when the user's goal is fully accomplished.

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
  message), call wait() or finish() — do not send repeated messages while waiting.`;

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
type BoundModel = ReturnType<ChatGoogleGenerativeAI['bindTools']>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summariseThinking(raw: string): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/(?<=\.)\s+/);
  const first = sentences.find((s) => s.length > 30) ?? clean;
  if (first.length <= 260) return first;
  const cut = first.lastIndexOf(' ', 260);
  return first.slice(0, cut > 120 ? cut : 260) + '…';
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

/**
 * Build the multipart human turn: task description, VFS listing, todo state,
 * optional reference images, and the annotated screenshot.
 */
function buildUserMessage(
  userPrompt: string,
  vfsFiles: VFSFile[],
  currentTodo: TodoItem[],
  inlineImages: InlineImage[],
  base64Image: string,
): HumanMessage {
  const content: Array<{ type: string; text?: string; url?: string }> = [
    {
      type: 'text',
      text: `User task: ${userPrompt}${vfsContextBlock(vfsFiles)}${todoContextBlock(currentTodo)}`,
    },
  ];

  if (inlineImages.length > 0) {
    content.push({
      type: 'text',
      text: `\n\n── User-provided reference images (${inlineImages.length}) ──`,
    });
    for (const img of inlineImages) {
      content.push({ type: 'text', text: `[${img.name}]` });
      content.push({ type: 'image', url: `data:${img.mimeType};base64,${img.data}` });
    }
  }

  content.push({
    type: 'text',
    text: '\n\nAnalyze the annotated screenshot and call the appropriate tools.',
  });
  content.push({ type: 'image', url: `data:image/png;base64,${base64Image}` });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new HumanMessage({ content: content as any });
}

// ─────────────────────────────────────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract reasoning text and typed AgentActions from a raw model response.
 * Logs thinking tokens if the model surfaces them.
 */
async function parseResponse(
  response: AIMessageChunk,
  logFn: LogFn,
): Promise<{ reasoning: string; actions: AgentAction[] }> {
  const thinking = response.additional_kwargs?.thinking as string | undefined;
  if (thinking?.trim()) {
    await logFn(summariseThinking(thinking), 'think');
  }

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
 * Invoke the model and retry on failure with exponential back-off.
 * Rate-limit (429) errors use a longer base delay than general errors.
 */
async function invokeWithRetry(
  modelWithTools: BoundModel,
  messages: BaseMessage[],
  logFn: LogFn,
): Promise<{ reasoning: string; actions: AgentAction[] }> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      const response = await modelWithTools.invoke(messages);
      return await parseResponse(response as AIMessageChunk, logFn);
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

export function createModel(apiKey: string): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    model: GEMINI_MODEL,
    apiKey,
    temperature: 0.1,
    maxRetries: 0,
    thinkingConfig: {
      thinkingLevel: THINKING_LEVEL
    },
  });
}

export async function callModel(
  model: ChatGoogleGenerativeAI,
  base64Image: string,
  userPrompt: string,
  history: { role: string; content: string }[] = [],
  logFn: LogFn = async () => {},
  vfsFiles: VFSFile[] = [],
  inlineImages: InlineImage[] = [],
  currentTodo: TodoItem[] = [],
): Promise<AgentResult> {
  const messages: BaseMessage[] = [
    new SystemMessage(SYSTEM_INSTRUCTIONS),
    ...buildHistory(history),
    buildUserMessage(userPrompt, vfsFiles, currentTodo, inlineImages, base64Image),
  ];

  const modelWithTools = model.bindTools([...AGENT_TOOLS]);
  const { reasoning, actions } = await invokeWithRetry(modelWithTools, messages, logFn);
  return { reasoning, actions, done: actions.some((a) => a.type === 'finish') };
}
