/**
 * evals/harness.ts
 *
 * Run strategy:
 *  1. launchPersistentContext with extension + recordVideo
 *  2. Seed Gemini API key via Service Worker → chrome.storage.local
 *  3. Navigate main tab to a benign site (example.com) to avoid CAPTCHA triggers
 *  4. Navigate a SECOND page directly to chrome-extension://<id>/sidepanel/index.html
 *     ↳ Avoids chrome.sidePanel.open() user-gesture requirement
 *     ↳ Avoids chrome.tabs.getCurrent() which is undefined on web pages
 *  5. bringToFront(mainPage) so agent's chrome.tabs.query({active:true}) returns google.com
 *  6. Fill textarea + click Run on the side panel page
 *  7. Poll agentState.status every 2s with per-case timeout
 *  8. mainPage.video().path() → close pages → context.close()
 */

import { chromium, type BrowserContext, type Page, type Video } from '@playwright/test';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import type { EvalCase, RunResult } from './types.js';

const EXTENSION_PATH = path.resolve(process.cwd(), '.output/chrome-mv3');
const VIDEOS_DIR = path.resolve(process.cwd(), 'evals/results/videos');

/** Selectors from ChatInput.tsx */
const SELECTORS = {
  textarea: 'textarea[placeholder="Describe a task… (Enter to run, Shift+Enter for newline, / for templates)"]',
  runButton: 'button[title="Run agent"]',
} as const;

type AgentStatus = 'idle' | 'running' | 'done' | 'stopped' | 'error';

class EvalTimeoutError extends Error {
  constructor(caseId: string, ms: number) {
    super(`Eval "${caseId}" timed out after ${ms / 1000}s`);
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export async function launchWithExtension() {
  if (!fs.existsSync(EXTENSION_PATH)) {
    throw new Error(`Extension not built. Run 'npm run build' first.\nExpected: ${EXTENSION_PATH}`);
  }
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opticlick-eval-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    recordVideo: { dir: VIDEOS_DIR, size: { width: 1280, height: 720 } },
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      // ────────────────────────────────────────────────────────────────────
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  // Inject pre-authenticated cookies if state.json exists
  const authStatePath = path.resolve(process.cwd(), 'evals/auth/state.json');
  if (fs.existsSync(authStatePath)) {
    try {
      const stateData = JSON.parse(fs.readFileSync(authStatePath, 'utf8'));
      if (stateData.cookies && stateData.cookies.length > 0) {
        await context.addCookies(stateData.cookies);
        console.log(`     🍪 Injected ${stateData.cookies.length} auth cookies into browser context`);
      }
    } catch (err) {
      console.warn(`     ⚠ Failed to inject auth state: ${(err as Error).message}`);
    }
  }

  return { context, userDataDir };
}

async function getServiceWorker(context: BrowserContext) {
  if (context.serviceWorkers().length > 0) return context.serviceWorkers()[0];
  return context.waitForEvent('serviceworker');
}

/** Seed API key + model via the Service Worker (has chrome.storage access). */
async function seedApiKey(context: BrowserContext) {
  const sw = await getServiceWorker(context);
  // Use an object arg — Playwright's evaluate() types tuple args as string[] which
  // is incompatible with [string, string] destructuring. Objects avoid this entirely.
  const model = process.env.EVAL_AGENT_MODEL ?? 'gemma-4-31b-it';
  if (model === 'custom-openai:cerebras') {
    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) throw new Error('CEREBRAS_API_KEY is not set');
    const customConfig = {
      id: 'cerebras',
      name: 'Cerebras',
      baseUrl: process.env.CEREBRAS_BASE_URL ?? 'https://api.cerebras.ai/v1',
      apiKey,
      modelName: process.env.EVAL_AGENT_MODEL_NAME ?? 'gpt-oss-120b',
    };
    await sw.evaluate(
      ({ selectedModel, config }) => chrome.storage.local.set({
        selectedModel,
        customOpenaiConfigs: [config],
      }),
      { selectedModel: model, config: customConfig },
    );
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  await sw.evaluate(
    ({ key, model }: { key: string; model: string }) =>
      chrome.storage.local.set({ geminiApiKey: key, selectedModel: model }),
    { key: apiKey, model },
  );
}

/**
 * Open side panel by navigating directly to chrome-extension://<id>/sidepanel/index.html.
 *
 * WHY NOT chrome.sidePanel.open():
 *   Requires a user gesture — silently fails from serviceWorker.evaluate().
 *
 * WHY NOT mainPage.evaluate(chrome.tabs.getCurrent):
 *   chrome.tabs is undefined on normal web pages (google.com).
 *
 * Direct URL navigation gives us the same React app with full extension API access.
 */
async function openSidePanelPage(context: BrowserContext): Promise<Page> {
  const sw = await getServiceWorker(context);
  // SW URL: chrome-extension://<extensionId>/background.js
  const extensionId = new URL(sw.url()).hostname;
  const sidePanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;

  const sidePanelPage = await context.newPage();
  await sidePanelPage.goto(sidePanelUrl, { waitUntil: 'domcontentloaded' });
  // Confirm sidebar mounted (API key was seeded → textarea visible, not ApiKeySetup screen)
  await sidePanelPage.waitForSelector(SELECTORS.textarea, { timeout: 20_000 });
  return sidePanelPage;
}

/** Poll agentState.status every 2s until terminal. Races against timeout. */
async function waitForAgentDone(
  sidePanelPage: Page,
  caseId: string,
  timeoutMs: number,
): Promise<{ status: AgentStatus; numSteps: number }> {
  const poll = async () => {
    while (true) {
      try {
        const state = await sidePanelPage.evaluate(async () => {
          const { agentState } = (await chrome.storage.session.get('agentState')) as {
            agentState?: { status: string; step?: number };
          };
          return agentState ?? null;
        });
        if (state?.status === 'done' || state?.status === 'stopped' || state?.status === 'error') {
          return { status: state.status as AgentStatus, numSteps: state.step ?? 0 };
        }
      } catch { /* page navigating — keep polling */ }
      await sleep(2000);
    }
  };

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new EvalTimeoutError(caseId, timeoutMs)), timeoutMs),
  );
  return Promise.race([poll(), timeout]);
}

async function startAgent(sidePanelPage: Page, prompt: string): Promise<void> {
  const modelId = process.env.EVAL_AGENT_MODEL ?? 'gemma-4-31b-it';
  const response = await sidePanelPage.evaluate(async ({ taskPrompt, modelId }) => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const target = tabs.find((tab) => tab.active && /^https?:/.test(tab.url ?? ''))
      ?? tabs.find((tab) => /^https?:/.test(tab.url ?? ''));
    if (target?.id == null) throw new Error('No injectable HTTP(S) target tab found');

    return chrome.runtime.sendMessage({
      type: 'START_AGENT',
      tabId: target.id,
      prompt: taskPrompt,
      modelId,
    }) as Promise<{ started?: boolean; reason?: string } | undefined>;
  }, { taskPrompt: prompt, modelId });

  if (!response?.started) {
    throw new Error(`Agent start was rejected${response?.reason ? `: ${response.reason}` : ''}`);
  }

  await sidePanelPage.waitForFunction(async () => {
    const { agentState } = (await chrome.storage.session.get('agentState')) as {
      agentState?: { status?: string };
    };
    return agentState?.status === 'running' || agentState?.status === 'done' || agentState?.status === 'error';
  }, undefined, { timeout: 15_000 });
}

async function stopAgent(sidePanelPage: Page): Promise<void> {
  await sidePanelPage.evaluate(() => chrome.runtime.sendMessage({ type: 'STOP_AGENT' })).catch(() => {});
  await sidePanelPage.waitForFunction(async () => {
    const { agentState } = (await chrome.storage.session.get('agentState')) as {
      agentState?: { status?: string };
    };
    return agentState?.status !== 'running';
  }, undefined, { timeout: 10_000 }).catch(() => {});
}

async function readAgentSnapshot(sidePanelPage: Page): Promise<{ numSteps: number; output: string }> {
  return sidePanelPage.evaluate(async () => {
    const { agentState, agentLog } = (await chrome.storage.session.get(['agentState', 'agentLog'])) as {
      agentState?: { step?: number };
      agentLog?: Array<{ message: string; level: string }>;
    };
    return {
      numSteps: agentState?.step ?? 0,
      output: Array.isArray(agentLog)
        ? agentLog.slice(-40).map((entry) => `[${entry.level}] ${entry.message}`).join('\n')
        : '',
    };
  }).catch(() => ({ numSteps: 0, output: '' }));
}

/** Run one eval case end-to-end. */
export async function runEvalCase(evalCase: EvalCase): Promise<RunResult> {
  const { context, userDataDir } = await launchWithExtension();
  const startTime = Date.now();

  let finishReason: RunResult['finishReason'] = 'error';
  let numSteps = 0;
  let timedOut = false;
  let errorOccurred = false;
  let rawVideoPath = '';
  let agentOutput = '';
  let mainPage: Page | null = null;
  let mainVideo: Video | null = null;
  let sidePanelPage: Page | null = null;

  try {
    await seedApiKey(context);

    // Neutral starting page — satisfies chrome.tabs.query({ active:true }) requirement
    // (needs an http/https tab) without pre-loading Google which triggers CAPTCHA.
    mainPage = await context.newPage();
    await mainPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });

    // Side panel as a second tab (direct URL — no user-gesture required)
    sidePanelPage = await openSidePanelPage(context);

    // CRITICAL: make google.com the "active" tab.
    // When the sidebar's handleRun() calls chrome.tabs.query({ active: true, currentWindow: true })
    // it must find google.com — not the side panel tab — as the target for the agent.
    await mainPage.bringToFront();

    // Start through the extension message API and require an acknowledgement. Clicking
    // the background side-panel tab introduced a focus race and could leave the harness
    // polling forever even though START_AGENT was never accepted.
    await startAgent(sidePanelPage, evalCase.prompt);

    const result = await waitForAgentDone(sidePanelPage, evalCase.id, evalCase.timeoutMs);
    finishReason = result.status as RunResult['finishReason'];
    numSteps = result.numSteps;
    errorOccurred = result.status === 'error';

    // Read the agent's log from session storage — this is the agent's actual text output
    // (reasoning steps, final answer) that the judge needs to evaluate output_correctness.
    // The main tab video only shows navigation; the sidebar text shows what the agent found.
    agentOutput = (await readAgentSnapshot(sidePanelPage)).output;

    // Flush video: get path before closing
    mainVideo = mainPage.video();
    await mainPage.close();
    mainPage = null;

  } catch (err) {
    if (err instanceof EvalTimeoutError) {
      timedOut = true;
      finishReason = 'timeout';
      if (sidePanelPage) {
        const snapshot = await readAgentSnapshot(sidePanelPage);
        numSteps = snapshot.numSteps;
        agentOutput = snapshot.output;
        await stopAgent(sidePanelPage);
      }
    } else {
      errorOccurred = true;
      finishReason = 'error';
      console.error(`[${evalCase.id}] Harness error:`, (err as Error).message);
    }
    if (mainPage) {
      mainVideo = mainPage.video();
      await mainPage.close().catch(() => {});
      mainPage = null;
    }
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  // Persistent-context videos are finalized only after the context closes.
  // Resolving path() earlier can add several minutes to every case.
  rawVideoPath = (await mainVideo?.path().catch(() => undefined)) ?? '';

  const durationSeconds = (Date.now() - startTime) / 1000;

  // Rename raw video file to case ID for easy lookup
  const namedPath = path.join(VIDEOS_DIR, `${evalCase.id}.webm`);
  if (rawVideoPath && fs.existsSync(rawVideoPath) && rawVideoPath !== namedPath) {
    fs.renameSync(rawVideoPath, namedPath);
  }
  const finalRaw = fs.existsSync(namedPath) ? namedPath : rawVideoPath;

  return {
    caseId: evalCase.id,
    rawVideoPath: finalRaw,
    compressedVideoPath: path.join(VIDEOS_DIR, `${evalCase.id}.mp4`),
    finishReason,
    durationSeconds,
    numSteps,
    timedOut,
    errorOccurred,
    agentOutput,
  };
}
