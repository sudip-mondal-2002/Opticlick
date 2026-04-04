/**
 * E2E tests for LLM action decisions.
 *
 * These tests use the real Gemini API to verify that the agent correctly
 * interprets a Set-of-Mark annotated screenshot and returns the expected
 * action type for a given user task.
 *
 * Prerequisites:
 *   - A valid GEMINI_API_KEY in the .env file at the project root.
 *   - Playwright browsers installed: npx playwright install chromium
 *
 * Usage: npm run test:e2e -- --reporter=verbose tests/e2e/llm-actions.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { createModel, callModel } from '../../src/utils/llm';
import type { AgentAction } from '../../src/utils/types';

// ── Load API key from .env ────────────────────────────────────────────────────

const envPath = path.resolve(__dirname, '../../.env');
const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
const GEMINI_API_KEY = envContent.match(/GEMINI_API_KEY=([^\r\n]+)/)?.[1]?.trim() ?? process.env.GEMINI_API_KEY ?? '';

// ── Helpers ───────────────────────────────────────────────────────────────────

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/llm-fixture.html');

let browser: Browser;

async function screenshotFixture(): Promise<string> {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(`file://${FIXTURE_PATH}`);
  await page.waitForLoadState('domcontentloaded');
  const buffer = await page.screenshot({ type: 'png' });
  await page.close();
  return buffer.toString('base64');
}

function findAction<T extends AgentAction['type']>(
  actions: AgentAction[],
  type: T,
): Extract<AgentAction, { type: T }> | undefined {
  return actions.find((a): a is Extract<AgentAction, { type: T }> => a.type === type);
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not found. Add it to .env or set the env var.');
  }
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LLM action decisions from annotated screenshots', () => {
  it('returns a click action targeting the Login button [3] when credentials are filled', async () => {
    const base64 = await screenshotFixture();
    const model = createModel(GEMINI_API_KEY);

    // Provide history showing credentials were already entered so the LLM's
    // next logical step is to click the Submit / Login button, not fill fields.
    const history = [
      {
        role: 'user',
        content: 'Fill the login form with username "admin" and password "secret".',
      },
      {
        role: 'assistant',
        content:
          'I clicked the username field [1] and typed "admin", then clicked the password field [2] and typed "secret". The form is ready to submit.',
      },
    ];
    const preTodo = [
      { id: 'fill-form', title: 'Fill in login credentials', status: 'done' as const },
      { id: 'click-login', title: 'Click the Login button', status: 'pending' as const },
    ];

    const result = await callModel(
      model,
      base64,
      'The form fields are already filled. Click the Login button [3] to submit.',
      history,
      async () => {},
      [],
      [],
      preTodo,
    );

    expect(result.actions.length).toBeGreaterThan(0);

    const clickAction = findAction(result.actions, 'click');
    expect(clickAction, 'Expected a click action').toBeDefined();
    // The Login button is clearly labeled [3] in the fixture
    expect(clickAction!.targetId).toBe(3);
  }, 60_000);

  it('fills in the username field [1] with the requested text', async () => {
    const base64 = await screenshotFixture();
    const model = createModel(GEMINI_API_KEY);

    // Pre-populate todo so the LLM skips the mandatory todo_create step and
    // immediately performs the typing action.
    const preTodo = [
      {
        id: 'type-username',
        title: 'Type john_doe into the username input',
        status: 'pending' as const,
      },
    ];

    const result = await callModel(
      model,
      base64,
      // Explicitly instruct the LLM to use the click tool with typeText so it
      // does not split focusing and typing into separate turns.
      'Call the click tool on element [1] (the Username input) and set typeText to "john_doe".',
      [],
      async () => {},
      [],
      [],
      preTodo,
    );

    expect(result.actions.length).toBeGreaterThan(0);

    const clickAction = findAction(result.actions, 'click');
    expect(clickAction, 'Expected a click action on the username field').toBeDefined();
    expect(clickAction!.targetId).toBe(1);
    // typeText should carry the value requested (model may omit surrounding quotes)
    expect(clickAction!.typeText ?? '').toContain('john_doe');
  }, 60_000);

  it('returns a navigate action with the correct URL when asked to visit a URL', async () => {
    const base64 = await screenshotFixture();
    const model = createModel(GEMINI_API_KEY);

    const result = await callModel(
      model,
      base64,
      'Navigate to https://example.com — ignore the current page.',
    );

    expect(result.actions.length).toBeGreaterThan(0);

    const navigateAction = findAction(result.actions, 'navigate');
    expect(navigateAction, 'Expected a navigate action').toBeDefined();
    expect(navigateAction!.url).toContain('example.com');
  }, 60_000);

  it('returns a click on the Register link [5] when asked to register', async () => {
    const base64 = await screenshotFixture();
    const model = createModel(GEMINI_API_KEY);

    const result = await callModel(
      model,
      base64,
      'I need to create a new account. Click the registration link.',
    );

    expect(result.actions.length).toBeGreaterThan(0);

    const clickAction = findAction(result.actions, 'click');
    expect(clickAction, 'Expected a click action on the register link').toBeDefined();
    // Register link is labeled [5]
    expect(clickAction!.targetId).toBe(5);
  }, 60_000);

  it('returns a finish action when the task is already done', async () => {
    const base64 = await screenshotFixture();
    const model = createModel(GEMINI_API_KEY);

    // Todo is already fully done — the agent should call finish() immediately
    // without any further todo_update, since nothing is pending.
    const completedTodo = [
      { id: 'login', title: 'Log in to Acme Corp', status: 'done' as const, notes: 'Logged in successfully.' },
      { id: 'verify', title: 'Verify the login page loaded', status: 'done' as const, notes: 'Login page confirmed.' },
    ];

    const result = await callModel(
      model,
      base64,
      'All tasks in the todo list are done. Call finish() now with a brief summary.',
      [],
      async () => {},
      [],
      [],
      completedTodo,
    );

    expect(result.done).toBe(true);
    const finishAction = findAction(result.actions, 'finish');
    expect(finishAction, 'Expected a finish action').toBeDefined();
    expect(finishAction!.summary).toBeTruthy();
  }, 60_000);
});
