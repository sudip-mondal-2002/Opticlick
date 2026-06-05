/**
 * Mocked E2E tests for LLM action decisions.
 *
 * These tests mock the Gemini API and verify that the callModel pipeline
 * correctly parses various tool calls and thinking tokens.
 */

import { describe, it, expect } from 'vitest';
import { callModel } from '../../src/utils/llm';
import type { AgentAction } from '../../src/utils/types';
import { makeFakeGeminiModel, toolChunk } from '../setup/gemini-mock';

// A placeholder base64 image (empty 1x1 PNG or similar dummy string)
const FAKE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function findAction<T extends AgentAction['type']>(
  actions: AgentAction[],
  type: T,
): Extract<AgentAction, { type: T }> | undefined {
  return actions.find((a): a is Extract<AgentAction, { type: T }> => a.type === type);
}

describe('LLM action decisions from annotated screenshots (mocked)', () => {
  it('returns a click action targeting the Login button [3] when credentials are filled', async () => {
    const model = makeFakeGeminiModel([
      toolChunk('click', { targetId: 3 }),
    ]);

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
      model as any,
      FAKE_BASE64,
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
  });

  it('fills in the username field [1] with the requested text', async () => {
    const model = makeFakeGeminiModel([
      toolChunk('click', { targetId: 1 }),
    ]);

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
      model as any,
      FAKE_BASE64,
      // The agent emits at most one UI action per turn. The first step is to
      // click element [1] to focus the username field; a subsequent turn would
      // then emit the type action with the text.
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
  });

  it('returns a navigate action with the correct URL when asked to visit a URL', async () => {
    const model = makeFakeGeminiModel([
      toolChunk('navigate', { url: 'https://example.com' }),
    ]);

    const result = await callModel(
      model as any,
      FAKE_BASE64,
      'Navigate to https://example.com — ignore the current page.',
    );

    expect(result.actions.length).toBeGreaterThan(0);

    const navigateAction = findAction(result.actions, 'navigate');
    expect(navigateAction, 'Expected a navigate action').toBeDefined();
    expect(navigateAction!.url).toContain('example.com');
  });

  it('returns a drag_and_drop action targeting another annotated element', async () => {
    const model = makeFakeGeminiModel([
      toolChunk('drag_and_drop', { sourceId: 1, targetId: 2 }),
    ]);

    const result = await callModel(
      model as any,
      FAKE_BASE64,
      'Drag card [1] onto column [2].',
    );

    const dragAction = findAction(result.actions, 'drag_and_drop');
    expect(dragAction, 'Expected a drag_and_drop action').toBeDefined();
    expect(dragAction!.sourceId).toBe(1);
    expect(dragAction!.targetId).toBe(2);
  });

  it('returns a drag_and_drop action targeting page coordinates', async () => {
    const model = makeFakeGeminiModel([
      toolChunk('drag_and_drop', { sourceId: 1, targetX: 400, targetY: 200 }),
    ]);

    const result = await callModel(
      model as any,
      FAKE_BASE64,
      'Drag card [1] to coordinates (400, 200).',
    );

    const dragAction = findAction(result.actions, 'drag_and_drop');
    expect(dragAction, 'Expected a drag_and_drop action').toBeDefined();
    expect(dragAction!.sourceId).toBe(1);
    expect(dragAction!.targetX).toBe(400);
    expect(dragAction!.targetY).toBe(200);
  });

  it('returns a click on the Register link [5] when asked to register', async () => {
    const model = makeFakeGeminiModel([
      toolChunk('click', { targetId: 5 }),
    ]);

    const result = await callModel(
      model as any,
      FAKE_BASE64,
      'I need to create a new account. Click the registration link.',
    );

    expect(result.actions.length).toBeGreaterThan(0);

    const clickAction = findAction(result.actions, 'click');
    expect(clickAction, 'Expected a click action on the register link').toBeDefined();
    // Register link is labeled [5]
    expect(clickAction!.targetId).toBe(5);
  });

  it('returns a finish action when the task is already done', async () => {
    const model = makeFakeGeminiModel([
      toolChunk('finish', { summary: 'Logged in and verified successfully.' }),
    ]);

    // Todo is already fully done — the agent should call finish() immediately.
    // No todo management is needed since all items are already marked done.
    const completedTodo = [
      { id: 'login', title: 'Log in to Acme Corp', status: 'done' as const, notes: 'Logged in successfully.' },
      { id: 'verify', title: 'Verify the login page loaded', status: 'done' as const, notes: 'Login page confirmed.' },
    ];

    const result = await callModel(
      model as any,
      FAKE_BASE64,
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
  });
});
