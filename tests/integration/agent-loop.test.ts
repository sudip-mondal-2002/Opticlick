import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runAgentLoop } from '@/entrypoints/background/loop';
import { createAnyModel } from '@/utils/llm';
import { makeFakeGeminiModel, toolChunk } from '../setup/gemini-mock';
import { getAgentState } from '@/utils/agent-state';
import { getMockDebugger } from '../setup/chrome-mocks';
import { getSessions, getConversationHistory } from '@/utils/db';

vi.mock('@/utils/llm', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/utils/llm')>();
  return {
    ...original,
    createAnyModel: vi.fn(),
  };
});

vi.mock('@/utils/sleep', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

describe('runAgentLoop logic-based E2E flow tests', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset fakeBrowser local/session storage
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    await chrome.storage.local.set({ geminiApiKey: 'mock-gemini-key' });

    // Set up chrome tabs/scripting mocks
    const chromeMock = globalThis.chrome as any;
    chromeMock.tabs = {
      get: vi.fn(async (id: number) => ({ id, url: 'https://example.com', status: 'complete' })),
      query: vi.fn(async () => [{ id: 1 }]),
      update: vi.fn(async (id: number, props: any) => ({ id, ...props })),
      sendMessage: vi.fn((tabId, msg, options, cb) => {
        const callback = typeof options === 'function' ? options : cb;
        if (msg.type === 'DRAW_MARKS') {
          const response = {
            coordinateMap: [{ id: 1, tag: 'button', text: 'Submit', rect: { x: 125, y: 210, left: 100, top: 200, width: 50, height: 20 } }]
          };
          if (callback) callback(response);
        } else {
          if (callback) callback({ success: true });
        }
      }),
      onUpdated: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onCreated: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    };
    chromeMock.scripting = {
      executeScript: vi.fn(async () => [{ result: undefined }]),
    };

    // Configure debugger mock for captureScreenshot
    const dbg = getMockDebugger();
    dbg.sendCommand.mockImplementation(async (_targetInfo, method) => {
      if (method === 'Page.captureScreenshot') {
        return { data: 'a'.repeat(6000) };
      }
      return {};
    });
  });

  it('runs a single-step E2E task that finishes immediately', async () => {
    const model = makeFakeGeminiModel([
      toolChunk('finish', { summary: 'Task complete successfully!' }),
    ]);
    vi.mocked(createAnyModel).mockReturnValue(model as any);

    await runAgentLoop(1, 'Verify that we can finish');

    // Verify agent state is set to done
    const state = await getAgentState();
    expect(state?.status).toBe('done');
    expect(state?.step).toBe(1);

    // Verify session was created
    const sessions = await getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe('Verify that we can finish');

    // Verify history recorded the finish output
    const history = await getConversationHistory(sessions[0].id!);
    expect(history.some(t => t.content.includes('Task complete'))).toBe(true);
  });

  it('runs a two-step E2E task that clicks a button, then finishes', async () => {
    const boundModel = {
      stream: vi.fn()
        .mockImplementationOnce(async function* () {
          yield toolChunk('click', { targetId: 1 });
        })
        .mockImplementationOnce(async function* () {
          yield toolChunk('finish', { summary: 'Clicked and completed' });
        }),
    };
    const model = {
      bindTools: vi.fn(() => boundModel),
    };

    vi.mocked(createAnyModel).mockReturnValue(model as any);

    await runAgentLoop(1, 'Click the submit button and finish');

    const state = await getAgentState();
    expect(state?.status).toBe('done');
    expect(state?.step).toBe(2);

    // Verify the debugger command was sent to scale and click coordinates
    // Element [1] is at (100, 200, width: 50, height: 20) -> Center is (125, 210)
    const dbg = getMockDebugger();
    const mousePressCall = dbg.sendCommand.mock.calls.find(
      c => c[1] === 'Input.dispatchMouseEvent' && (c[2] as any).type === 'mousePressed'
    );
    expect(mousePressCall).toBeDefined();
    expect((mousePressCall![2] as any).x).toBe(125);
    expect((mousePressCall![2] as any).y).toBe(210);

    const sessions = await getSessions();
    const history = await getConversationHistory(sessions[0].id!);
    expect(history.some(t => t.toolName === 'click')).toBe(true);
    expect(history.some(t => t.content.includes('Task complete: Clicked and completed'))).toBe(true);
  });
});
