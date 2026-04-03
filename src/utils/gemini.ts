/**
 * Gemini API integration for the Opticlick agent.
 */

import type { AgentDecision } from './types';
import type { VFSFile } from './db';

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

VFS mutations, fetchDOM, and UI actions are all independent — combine them freely
in one turn (e.g. fetchDOM a link list AND click a button, or download a file alone).
VFS mutations and fetchDOM execute before the UI action within the same turn.

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
  "fetchDOM": <targetId number — ask extension for element's outer HTML, optional>
}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts the first meaningful sentence from raw thinking tokens
 * so the popup log stays concise.
 */
function summariseThinking(raw: string): string {
  // Collapse whitespace, split on sentence boundaries
  const clean = raw.replace(/\s+/g, ' ').trim();
  const sentences = clean.split(/(?<=\.)\s+/);
  const first = sentences.find((s) => s.length > 30) ?? clean;
  if (first.length <= 260) return first;
  const cut = first.lastIndexOf(' ', 260);
  return first.slice(0, cut > 120 ? cut : 260) + '…';
}

export async function callGemini(
  apiKey: string,
  base64Image: string,
  userPrompt: string,
  history: { role: string; content: string }[] = [],
  logFn: (msg: string, level?: string) => Promise<void> = async () => {},
  vfsFiles: VFSFile[] = [],
): Promise<AgentDecision> {
  const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];

  for (const turn of history) {
    contents.push({
      role: turn.role,
      parts: [{ text: turn.content }],
    });
  }

  const vfsContext = vfsFiles.length > 0
    ? `\n\n── Virtual Filesystem (VFS) — current contents ──\n${
        vfsFiles.map(f =>
          `  id="${f.id}"  name="${f.name}"  type="${f.mimeType}"  size=${f.size}B  created=${new Date(f.createdAt).toISOString()}`
        ).join('\n')
      }\nYou can use vfsSaveScreenshot, vfsWrite, vfsDelete, or uploadFileId (with targetId) to manage these files.`
    : '\n\n── Virtual Filesystem (VFS) — currently empty ──\nUse vfsSaveScreenshot or vfsWrite to create files.';

  contents.push({
    role: 'user',
    parts: [
      { text: `User task: ${userPrompt}${vfsContext}\n\nAnalyze the annotated screenshot and respond in JSON.` },
      {
        inlineData: {
          mimeType: 'image/png',
          data: base64Image,
        },
      },
    ],
  });

  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_INSTRUCTIONS }],
    },
    contents,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingBudget: THINKING_BUDGET,
      },
    },
  };

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60_000);
      let resp: Response;
      try {
        resp = await fetch(GEMINI_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (resp.status === 429) {
        const delay = RATE_LIMIT_DELAY_MS * attempt;
        lastError = new Error(`Gemini rate limit (429) after ${attempt} attempts`);
        await logFn(
          `Rate limited by Gemini (attempt ${attempt}/${MAX_API_RETRIES}). Waiting ${delay / 1000}s…`,
          'warn',
        );
        await sleep(delay);
        continue;
      }

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Gemini API error ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const data = await resp.json();
      const parts: Array<{ thought?: boolean; text: string }> =
        data?.candidates?.[0]?.content?.parts ?? [];

      // Log LLM thinking tokens as [THINK] entries
      const thoughtText = parts
        .filter((p) => p.thought)
        .map((p) => p.text)
        .join(' ');
      if (thoughtText.trim()) {
        await logFn(summariseThinking(thoughtText), 'think');
      }

      // The answer is in the non-thought parts
      const rawText = parts
        .filter((p) => !p.thought)
        .map((p) => p.text)
        .join('');

      if (!rawText) throw new Error('Empty response from Gemini.');

      return JSON.parse(rawText) as AgentDecision;
    } catch (err) {
      lastError = err as Error;
      if (attempt < MAX_API_RETRIES) {
        await logFn(`API attempt ${attempt} failed: ${lastError.message}. Retrying…`, 'warn');
        await sleep(1500 * attempt);
      }
    }
  }

  throw lastError;
}
