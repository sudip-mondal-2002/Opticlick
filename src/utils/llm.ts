/**
 * LLM integration for the Opticlick agent.
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { AgentDecision, TodoItem } from './types';
import type { VFSFile } from './db';
import { formatTodoForPrompt } from './todo';

const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const MAX_API_RETRIES = 5;
const RATE_LIMIT_DELAY_MS = 10_000;
const THINKING_BUDGET = 8192;

const SYSTEM_INSTRUCTIONS = `You are an autonomous web agent that can browse ANY website.

You are given a screenshot of a webpage where all interactable elements have been
numbered with blue bounding boxes (the Set-of-Mark technique). You also have full
read/write access to a Virtual Filesystem (VFS) that persists for the duration of this
session. Every step's screenshot is automatically saved to the VFS, but YOU decide
what else lives there — create, name, overwrite, and delete files as you see fit.

═══ CAPABILITIES ════════════════════════════════════════════════════════════════

── UI Actions (choose at most one per turn) ─────────────────────────────────
1. CLICK   — set "targetId" to a numbered element.
2. TYPE    — set "typeText" to type into the focused element (combine with a click).
3. NAVIGATE — set "navigateUrl" to a full URL to load a different page.
4. SCROLL  — set "scroll" to "up"/"down"/"left"/"right".
             Add "scrollTargetId" to scroll inside a specific element.
5. KEY     — set "pressKey" (e.g. "Enter", "Tab", "Escape", "ArrowDown").
6. UPLOAD  — to upload a file, set "targetId" to the visible upload button or file
             input element AND "uploadFileId" to either the filename or ID of the VFS
             file to upload. The extension finds the real hidden <input type="file">
             automatically — you do not need to locate it yourself.
             If you are writing a file and uploading it in the same turn, use the
             filename as uploadFileId (e.g. "test.svg") — the UUID isn't known yet.
             Never click a file input or upload button without also setting uploadFileId.

── VFS Mutations (any combination, execute BEFORE the UI action this turn) ──
7. SAVE SCREENSHOT — set "vfsSaveScreenshot" to a filename (e.g. "login_page.png")
             to persist the CURRENT screenshot with that name. Use this whenever you
             want to capture the page state for later reference or upload.
8. WRITE FILE — set "vfsWrite" to { "name": "<filename>", "content": "<text>",
             "mimeType": "<optional, default text/plain>" } to create or overwrite
             a text file in the VFS. Use this to store scraped data, notes, JSON,
             CSV, HTML snippets, or any other text content.
9.  DELETE FILE — set "vfsDelete" to a VFS file ID to remove it from the filesystem.
10. DOWNLOAD URL — set "vfsDownload" to { "url": "<full URL>", "name": "<optional filename>" }
             to fetch any HTTP/HTTPS URL directly into the VFS. The service worker
             fetches the file — no browser download dialog, no size limit within reason.
             Use this to grab PDFs, images, CSVs, ZIPs, or any other remote file.
             The filename and MIME type are auto-detected from the response headers,
             but you can override the filename with the "name" field.
11. FETCH ELEMENT DOM — set "fetchDOM" to a targetId number to ask the extension
             for the full outer HTML of that element. The HTML is injected directly
             into your context for the next step — nothing is stored in VFS.
             Use this whenever the screenshot doesn't give you enough detail: to read
             link hrefs, table cell values, hidden attributes, or clipped text.

── Todo List Management (persisted in VFS across sessions) ───────────────
12. TODO CREATE — set "todoCreate" to an array of TodoItem objects to establish
             the session plan. MANDATORY on step 1 when no todo list exists yet.
             Break the user's goal into concrete, ordered sub-tasks.
             Use short kebab-case IDs (e.g. "navigate-to-login", "fill-form").
             Set the first item you are about to work on to "in_progress";
             all others should be "pending".
             You can also use todoCreate mid-session to replace the list entirely
             if the plan needs a significant revision.
13. TODO UPDATE — set "todoUpdate" to an array of { id, status?, notes? } patches.
             Use this every turn to keep the todo list accurate:
             - Mark an item "done" as soon as you complete it.
             - Mark the next item "in_progress" before starting it.
             - Add "notes" to record key observations (e.g. URL found, error seen).
             - Mark items "skipped" if they turn out to be unnecessary.
             Combine todoUpdate freely with any UI action in the same turn.

VFS mutations, fetchDOM, todo mutations, and UI actions are all independent — combine
them freely in one turn. VFS/todo mutations and fetchDOM execute before the UI action.

═══ REASONING GUIDELINES ════════════════════════════════════════════════════════

BEFORE DECIDING, REASON CAREFULLY:
- Look at the screenshot closely. What page am I on? What state is it in?
- What is the user's goal? How close am I to achieving it?
- What will happen AFTER this action? Will it navigate away? Submit a form?
- For IRREVERSIBLE actions (submit/buy/delete), confirm inputs are correct first.
- If a previous action failed or produced unexpected results, reassess.
- Prefer "navigateUrl" over guessing form submissions when the URL is known.
- Use the VFS proactively: capture screenshots at key moments, write scraped data,
  store intermediate results. You decide filenames and content — be descriptive.
- When you see a link or button that would trigger a file download, use "vfsDownload"
  with that URL instead of clicking — the file lands in VFS without a dialog.
  If you're unsure of the exact URL, use "fetchDOM" on the element first to read
  the href, then download on the next step.
- Use "fetchDOM" whenever the screenshot doesn't give you enough detail — to read
  link targets, table rows, hidden attributes, or long text that's cut off.

IMPORTANT:
- You can ALWAYS navigate to a different URL. Never give up because the current page
  is wrong — use "navigateUrl" to go there.
- Scroll to find elements before giving up.
- Only set "done" to true when the user's task is fully accomplished.
- Respond ONLY with valid JSON. No markdown, no prose.

═══ RESPONSE FORMAT ══════════════════════════════════════════════════════════════

{
  "targetId": <number | null>,
  "done": <boolean>,
  "reasoning": "<thorough step-by-step explanation>",
  "typeText": "<text to type, optional>",
  "navigateUrl": "<full URL, optional>",
  "scroll": "<'up'|'down'|'left'|'right', optional>",
  "scrollTargetId": <number, optional>,
  "pressKey": "<key name, optional>",
  "uploadFileId": "<VFS file ID — only for file inputs, optional>",
  "vfsSaveScreenshot": "<filename.png — save current screenshot, optional>",
  "vfsWrite": { "name": "<filename>", "content": "<full text content>", "mimeType": "<optional>" },
  "vfsDelete": "<VFS file ID to delete, optional>",
  "vfsDownload": { "url": "<full HTTP/HTTPS URL>", "name": "<optional filename override>" },
  "fetchDOM": <targetId number — ask extension for element's outer HTML, optional>,
  "todoCreate": [{ "id": "kebab-id", "title": "Task title", "status": "pending|in_progress", "notes": "optional" }],
  "todoUpdate": [{ "id": "kebab-id", "status": "in_progress|done|skipped", "notes": "optional observation" }]
}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts the first meaningful sentence from raw thinking tokens
 * so the popup log stays concise.
 */
function summariseThinking(raw: string): string {
  const clean = raw.replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/(?<=\.)\s+/);
  const first = sentences.find((s) => s.length > 30) ?? clean;
  if (first.length <= 260) return first;
  const cut = first.lastIndexOf(' ', 260);
  return first.slice(0, cut > 120 ? cut : 260) + '…';
}

export interface InlineImage {
  name: string;
  mimeType: string;
  /** Base64-encoded data (no data-URL prefix). */
  data: string;
}

/**
 * Creates a configured ChatGoogleGenerativeAI model instance.
 */
export function createModel(apiKey: string): ChatGoogleGenerativeAI {
  return new ChatGoogleGenerativeAI({
    model: GEMINI_MODEL,
    apiKey,
    temperature: 0.1,
    maxRetries: 0, // Retry loop in callModel handles backoff and rate-limit delays.
    thinkingConfig: { thinkingBudget: THINKING_BUDGET },
  });
}

export async function callModel(
  model: ChatGoogleGenerativeAI,
  base64Image: string,
  userPrompt: string,
  history: { role: string; content: string }[] = [],
  logFn: (msg: string, level?: string) => Promise<void> = async () => {},
  vfsFiles: VFSFile[] = [],
  inlineImages: InlineImage[] = [],
  currentTodo: TodoItem[] = [],
): Promise<AgentDecision> {

  const messages: BaseMessage[] = [new SystemMessage(SYSTEM_INSTRUCTIONS)];

  for (const turn of history) {
    messages.push(turn.role === 'user' ? new HumanMessage(turn.content) : new AIMessage(turn.content));
  }

  const vfsContext =
    vfsFiles.length > 0
      ? `\n\n── Virtual Filesystem (VFS) — current contents ──\n${vfsFiles
          .map(
            (f) =>
              `  id="${f.id}"  name="${f.name}"  type="${f.mimeType}"  size=${f.size}B  created=${new Date(f.createdAt).toISOString()}`,
          )
          .join('\n')}\nYou can use vfsSaveScreenshot, vfsWrite, vfsDelete, or uploadFileId (with targetId) to manage these files.`
      : '\n\n── Virtual Filesystem (VFS) — currently empty ──\nUse vfsSaveScreenshot or vfsWrite to create files.';

  const todoContext = currentTodo.length > 0
    ? `\n\n── Todo List — current state ──\n${formatTodoForPrompt(currentTodo)}\nUpdate items via "todoUpdate". Use "todoCreate" only to replace the entire plan.`
    : `\n\n── Todo List — not created yet ──\nYou MUST set "todoCreate" this turn to establish the task plan before taking any action.`;

  const userContent: Array<{ type: string; text?: string; url?: string }> = [
    { type: 'text', text: `User task: ${userPrompt}${vfsContext}${todoContext}` },
  ];

  if (inlineImages.length > 0) {
    userContent.push({
      type: 'text',
      text: `\n\n── User-provided reference images (${inlineImages.length}) ──\nThe user attached the following images as context for this task:`,
    });
    for (const img of inlineImages) {
      userContent.push({ type: 'text', text: `[${img.name}]` });
      userContent.push({ type: 'image', url: `data:${img.mimeType};base64,${img.data}` });
    }
  }

  userContent.push({ type: 'text', text: '\n\nAnalyze the annotated screenshot below and respond in JSON.' });
  userContent.push({ type: 'image', url: `data:image/png;base64,${base64Image}` });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages.push(new HumanMessage({ content: userContent as any }));

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      const response = await model.invoke(messages);

      // Log thinking tokens when the model surfaces them.
      const thinking = response.additional_kwargs?.thinking as string | undefined;
      if (thinking?.trim()) {
        await logFn(summariseThinking(thinking), 'think');
      }

      // Content may be a plain string or an array of content blocks.
      const rawText =
        typeof response.content === 'string'
          ? response.content
          : (response.content as Array<{ type: string; text?: string }>)
              .filter((p) => p.type === 'text')
              .map((p) => p.text ?? '')
              .join('');

      if (!rawText) throw new Error('Empty response from LLM.');
      return JSON.parse(rawText) as AgentDecision;
    } catch (err) {
      lastError = err as Error;
      const isRateLimit =
        lastError.message.includes('429') || lastError.message.toLowerCase().includes('rate limit');

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
