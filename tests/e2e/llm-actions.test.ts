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

// ── Load API key from .env or .env.test ──────────────────────────────────────

const envTestPath = path.resolve(__dirname, '../../.env.test');
const envPath = path.resolve(__dirname, '../../.env');
const envContent = fs.existsSync(envTestPath)
  ? fs.readFileSync(envTestPath, 'utf-8')
  : fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf-8')
    : '';
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

// ── Unified Test Suite (Guarded by skipIf) ───────────────────────────────────

describe.skipIf(!GEMINI_API_KEY)('LLM action decisions from annotated screenshots', () => {
  
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('returns a click action targeting the Login button [3] when credentials are filled', async () => {
    const base64 = await screenshotFixture();
    const model = createModel(GEMINI_API_KEY);

    // FIX: sessionId changed from string 'test-session' to number 1 to resolve type incompatibility
    const history = [
      {
        role: 'user',
        content: 'Fill the login form with username "admin" and password "secret".',
        sessionId: 1,
        ts: Date.now(),
      },
      {
        role: 'assistant',
        content:
          'I clicked the username field [1] and typed "admin", then clicked the password field [2] and typed "secret". The form is ready to submit.',
        sessionId: 1,
        ts: Date.now() + 1,
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
    expect(clickAction!.targetId).toBe(3);
  }, 120_000);

  it('fills in the username field [1] with the requested text', async () => {
    const base64 = await screenshotFixture();
    const model = createModel(GEMINI_API_KEY);

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
      'Focus the username field by clicking element [1].',
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
  }, 120_000);

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
  }, 120_000);

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
    expect(clickAction!.targetId).toBe(5);
  }, 120_000);

  it('returns a finish action when the task is already done', async () => {
    const base64 = await screenshotFixture();
    const model = createModel(GEMINI_API_KEY);

    const completedTodo = [
      { id: 'login', title: 'Log in to Acme Corp', status: 'done' as const, notes: 'Logged in successfully.' },
      { id: 'verify', title: 'Verify the login page loaded', status: 'done' as const, notes: 'Login page confirmed.' },
    ];

    const result = await callModel(
      model,
      base64,
      'All tasks are already marked done — no todo_create or todo_update needed. ' +
      'Call finish() right now with a brief summary of what was accomplished.',
      [],
      async () => {},
      [],
      [],
      completedTodo,
    );

    const finishAction = findAction(result.actions, 'finish');
    expect(finishAction, `Expected a finish action. Got actions: ${JSON.stringify(result.actions.map(a => a.type))}`).toBeDefined();
    expect(result.done).toBe(true);
    expect(finishAction!.summary).toBeTruthy();
  }, 120_000);
});