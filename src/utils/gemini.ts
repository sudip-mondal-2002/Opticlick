/**
 * Gemini API integration for the Opticlick agent.
 */

import type { AgentDecision } from './types';

const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
const MAX_API_RETRIES = 5;
const RATE_LIMIT_DELAY_MS = 10_000;
const THINKING_BUDGET = 8192;

const SYSTEM_INSTRUCTIONS = `You are an autonomous web agent that can browse ANY website.

You are given a screenshot of a webpage where all interactable elements have been
numbered with blue bounding boxes (the Set-of-Mark technique).

Your task: decide the NEXT ACTION to accomplish the user's goal. You have these capabilities:
1. Click a numbered element by setting "targetId".
2. Type text into the focused element by setting "typeText".
3. Navigate to ANY URL by setting "navigateUrl" — use this when the current page is NOT the right site, or when the user provides a URL in their task. You can go to any website.
4. Scroll by setting "scroll" to "up", "down", "left", or "right". To scroll INSIDE a specific scrollable element (e.g. a sidebar, code block, or panel), also set "scrollTargetId" to that element's number. Without scrollTargetId the entire page scrolls.
5. Press a keyboard key by setting "pressKey" (e.g. "Enter", "Tab", "Escape").

BEFORE DECIDING, REASON CAREFULLY:
- Look at the screenshot closely. What page am I on? What state is it in?
- What is the user's goal? How close am I to achieving it?
- What will happen AFTER this action? Will it navigate away? Submit a form? Open a modal?
- For IRREVERSIBLE actions (pressing Enter on a form, clicking a submit/buy/delete button), be especially careful — confirm the inputs are correct and the action is the intended next step.
- If the previous action failed or produced an unexpected result, reassess before retrying the same action.
- Prefer navigating with "navigateUrl" over guessing at form submissions when the destination URL is known.

IMPORTANT:
- You can ALWAYS navigate to a different URL. If the current page is not relevant to the task, use "navigateUrl" to go there. NEVER give up or set "done" to true just because the current page is wrong.
- If you cannot see the element you need, scroll first before giving up.
- Only set "done" to true when the user's task has been fully accomplished.
- Respond ONLY with valid JSON. No markdown, no prose.
- Format:
  {
    "targetId": <number | null>,
    "done": <boolean>,
    "reasoning": "<thorough step-by-step explanation of your reasoning and why this is the right action>",
    "typeText": "<text to type, optional>",
    "navigateUrl": "<full URL, optional>",
    "scroll": "<'up' | 'down' | 'left' | 'right', optional>",
    "scrollTargetId": "<number — element to scroll inside, optional>",
    "pressKey": "<key name, optional>"
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
): Promise<AgentDecision> {
  const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];

  for (const turn of history) {
    contents.push({
      role: turn.role,
      parts: [{ text: turn.content }],
    });
  }

  contents.push({
    role: 'user',
    parts: [
      { text: `User task: ${userPrompt}\n\nAnalyze the annotated screenshot and respond in JSON.` },
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
      const resp = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

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
