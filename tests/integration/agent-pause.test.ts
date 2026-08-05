import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAgentState, setAgentState } from '@/utils/agent-state';
import { stepSetupNode } from '@/entrypoints/background/nodes/setup';
import type { AgentState } from '@/entrypoints/background/agent-state';

describe('Agent Pause/Resume Integration Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setTimerTickMode('nextTimerAsync');

    // Mock chrome.tabs.sendMessage to avoid errors in sendToTab
    (globalThis.chrome.tabs as any) = {
      sendMessage: vi.fn((tabId, msg, options, cb) => {
        if (typeof options === 'function') {
          options(null);
        } else if (typeof cb === 'function') {
          cb(null);
        }
      }),
    };
    (globalThis.chrome.scripting as any) = {
      executeScript: vi.fn().mockResolvedValue([]),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs normally when status is running', async () => {
    await setAgentState({ status: 'running', step: 1, tabId: 42, sessionId: 123 });
    const graphState = {
      tabId: 42,
      sessionId: 123,
      step: 1,
      retryStep: false,
    } as unknown as AgentState;

    const result = await stepSetupNode(graphState);
    expect(result.stopped).toBeUndefined();
    expect(result.step).toBe(2);
  });

  it('stops immediately if status is not running or paused', async () => {
    await setAgentState({ status: 'stopped', step: 1, tabId: 42, sessionId: 123 });
    const graphState = {
      tabId: 42,
      sessionId: 123,
      step: 1,
      retryStep: false,
    } as unknown as AgentState;

    const result = await stepSetupNode(graphState);
    expect(result.stopped).toBe(true);
  });

  it('pauses and resumes when status changes from paused to running', async () => {
    await setAgentState({ status: 'paused', step: 1, tabId: 42, sessionId: 123 });
    const graphState = {
      tabId: 42,
      sessionId: 123,
      step: 1,
      retryStep: false,
    } as unknown as AgentState;

    // Trigger state transition to running after 200ms
    setTimeout(async () => {
      await setAgentState({ status: 'running' });
    }, 200);

    const result = await stepSetupNode(graphState);
    expect(result.stopped).toBeUndefined();
    expect(result.step).toBe(2);
    
    const finalState = await getAgentState();
    expect(finalState?.status).toBe('running');
  });

  it('stops when status changes from paused to stopped', async () => {
    await setAgentState({ status: 'paused', step: 1, tabId: 42, sessionId: 123 });
    const graphState = {
      tabId: 42,
      sessionId: 123,
      step: 1,
      retryStep: false,
    } as unknown as AgentState;

    // Trigger state transition to stopped after 200ms
    setTimeout(async () => {
      await setAgentState({ status: 'stopped' });
    }, 200);

    const result = await stepSetupNode(graphState);
    expect(result.stopped).toBe(true);
  });
});
