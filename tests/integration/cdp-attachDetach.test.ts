import { describe, it, expect, beforeEach } from 'vitest';
import {
  attachDebugger,
  detachDebugger,
  _resetAttachedDebuggers,
} from '@/utils/cdp';
import { getMockDebugger } from '../setup/chrome-mocks';

beforeEach(() => {
  _resetAttachedDebuggers();
});

describe('attachDebugger', () => {
  it('calls chrome.debugger.attach on first call', async () => {
    await attachDebugger(1);
    expect(getMockDebugger().attach).toHaveBeenCalledWith({ tabId: 1 }, '1.3');
  });

  it('skips attach if tabId is already attached', async () => {
    await attachDebugger(1);
    await attachDebugger(1);
    expect(getMockDebugger().attach).toHaveBeenCalledOnce();
  });

  it('attaches separate tabIds independently', async () => {
    await attachDebugger(1);
    await attachDebugger(2);
    expect(getMockDebugger().attach).toHaveBeenCalledTimes(2);
  });
});

describe('detachDebugger', () => {
  it('calls chrome.debugger.detach and removes from Set', async () => {
    await attachDebugger(10);
    await detachDebugger(10);
    expect(getMockDebugger().detach).toHaveBeenCalledWith({ tabId: 10 });
    // Re-attaching should call attach again (proves it was removed from Set)
    await attachDebugger(10);
    expect(getMockDebugger().attach).toHaveBeenCalledTimes(2);
  });

  it('is a no-op if tabId is not in the attached Set', async () => {
    await detachDebugger(99);
    expect(getMockDebugger().detach).not.toHaveBeenCalled();
  });

  it('removes tabId from Set even when chrome.debugger.detach throws (tab closed)', async () => {
    await attachDebugger(20);
    getMockDebugger().detach.mockRejectedValueOnce(new Error('tab closed'));
    await detachDebugger(20); // should not throw
    // Re-attaching should not skip (was removed from Set)
    await attachDebugger(20);
    expect(getMockDebugger().attach).toHaveBeenCalledTimes(2);
  });
});

describe('onDetach listener (module-level)', () => {
  it('listener registered by the module removes tabId from the attached Set', async () => {
    // The module registers a listener on chrome.debugger.onDetach at import time.
    // We simulate Chrome firing the onDetach event.
    await attachDebugger(30);
    getMockDebugger().onDetach._fire({ tabId: 30 });
    // Re-attaching should call attach again (proves Set was cleared)
    await attachDebugger(30);
    expect(getMockDebugger().attach).toHaveBeenCalledTimes(2);
  });
});
