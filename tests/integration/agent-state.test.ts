import { describe, it, expect } from 'vitest';
import { getAgentState, setAgentState, clearAgentState } from '@/utils/agent-state';
import type { AgentState } from '@/utils/types';

describe('getAgentState', () => {
  it('returns null when storage is empty', async () => {
    const state = await getAgentState();
    expect(state).toBeNull();
  });

  it('returns stored AgentState after setAgentState', async () => {
    await setAgentState({ status: 'running', step: 1, tabId: 42 });
    const state = await getAgentState();
    expect(state).toMatchObject({ status: 'running', step: 1, tabId: 42 });
  });
});

describe('setAgentState', () => {
  it('creates state from scratch when storage is empty', async () => {
    const state = await setAgentState({ status: 'idle', step: 0 });
    expect(state.status).toBe('idle');
    expect(state.step).toBe(0);
  });

  it('returns the merged state', async () => {
    const state = await setAgentState({ status: 'running', step: 3 });
    expect(state).toMatchObject({ status: 'running', step: 3 });
  });

  it('merges patch with existing state — does not discard unpatched keys', async () => {
    await setAgentState({ status: 'running', step: 1, tabId: 10, prompt: 'do stuff' });
    // Only patch the step
    const merged = await setAgentState({ step: 2 });
    expect(merged.status).toBe('running');
    expect(merged.tabId).toBe(10);
    expect(merged.prompt).toBe('do stuff');
    expect(merged.step).toBe(2);
  });

  it('persists state so getAgentState returns it', async () => {
    await setAgentState({ status: 'done', step: 5 });
    const fetched = await getAgentState();
    expect(fetched?.status).toBe('done');
    expect(fetched?.step).toBe(5);
  });
});

describe('clearAgentState', () => {
  it('subsequent getAgentState returns null', async () => {
    await setAgentState({ status: 'running', step: 1 });
    await clearAgentState();
    expect(await getAgentState()).toBeNull();
  });

  it('does not remove unrelated storage keys', async () => {
    await chrome.storage.session.set({ unrelatedKey: 'keep me', agentState: { status: 'idle', step: 0 } });
    await clearAgentState();
    const result = await chrome.storage.session.get('unrelatedKey');
    expect(result.unrelatedKey).toBe('keep me');
  });

  it('removes agentState, coordinateMap, and agentLog keys', async () => {
    // Set all three keys
    await chrome.storage.session.set({
      agentState: { status: 'running', step: 1 } satisfies AgentState,
      coordinateMap: [{ id: 1, tag: 'button', text: 'Submit', rect: { x: 0, y: 0, left: 0, top: 0, width: 10, height: 10 } }],
      agentLog: [{ message: 'test', level: 'info', ts: Date.now() }],
    });
    await clearAgentState();
    const result = await chrome.storage.session.get(['agentState', 'coordinateMap', 'agentLog']);
    expect(result.agentState).toBeUndefined();
    expect(result.coordinateMap).toBeUndefined();
    expect(result.agentLog).toBeUndefined();
  });
});
