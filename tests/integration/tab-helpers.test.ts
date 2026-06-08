import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  retryTabUpdate,
  sendToTab,
  isTabInjectable,
  waitForInjectableTab,
  waitForTabLoad,
  ensureContentScript,
} from '@/utils/tab-helpers';

describe('tab-helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const g = globalThis as any;
    g.chrome = {
      ...g.chrome,
      runtime: { ...g.chrome?.runtime, lastError: undefined },
      tabs: {
        update: vi.fn(),
        get: vi.fn().mockResolvedValue({ id: 1, url: 'chrome://newtab', status: 'loading' }),
        sendMessage: vi.fn(),
        onUpdated: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      scripting: {
        executeScript: vi.fn(),
      },
    };
  });

  describe('retryTabUpdate', () => {
    it('succeeds on first attempt', async () => {
      const tab = { id: 1, url: 'https://foo.com' } as any;
      vi.mocked(chrome.tabs.update).mockResolvedValueOnce(tab);

      const result = await retryTabUpdate(1, { url: 'https://foo.com' });
      expect(result).toEqual(tab);
      expect(chrome.tabs.update).toHaveBeenCalledOnce();
    });

    it('retries when Chrome rejects with "Tabs cannot be edited right now" and eventually succeeds', async () => {
      vi.mocked(chrome.tabs.update)
        .mockRejectedValueOnce(new Error('Tabs cannot be edited right now'))
        .mockResolvedValueOnce({ id: 1, url: 'https://bar.com' } as any);

      const result = await retryTabUpdate(1, { url: 'https://bar.com' }, 3, 10);
      expect(result.url).toBe('https://bar.com');
      expect(chrome.tabs.update).toHaveBeenCalledTimes(2);
    });

    it('throws other errors immediately without retrying', async () => {
      vi.mocked(chrome.tabs.update).mockRejectedValueOnce(new Error('Tab not found'));

      await expect(retryTabUpdate(1, { url: 'https://bar.com' }, 3, 10)).rejects.toThrow('Tab not found');
      expect(chrome.tabs.update).toHaveBeenCalledOnce();
    });

    it('throws after exhausting max attempts', async () => {
      vi.mocked(chrome.tabs.update).mockRejectedValue(new Error('Tabs cannot be edited right now'));

      await expect(retryTabUpdate(1, { url: 'https://bar.com' }, 3, 10)).rejects.toThrow('Tabs cannot be edited right now');
      expect(chrome.tabs.update).toHaveBeenCalledTimes(3);
    });
  });

  describe('sendToTab', () => {
    it('resolves with response on success', async () => {
      vi.mocked(chrome.tabs.sendMessage).mockImplementation((id, msg, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        callback('ok');
      });

      await expect(sendToTab(1, { type: 'TEST' })).resolves.toBe('ok');
    });

    it('rejects with lastError message on failure', async () => {
      vi.mocked(chrome.tabs.sendMessage).mockImplementation((id, msg, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        chrome.runtime.lastError = { message: 'Receiving end does not exist' };
        callback(undefined);
      });

      await expect(sendToTab(1, { type: 'TEST' })).rejects.toThrow('Receiving end does not exist');
    });
  });

  describe('isTabInjectable', () => {
    it('returns true for web URLs', async () => {
      vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ id: 1, url: 'https://example.com' } as any);
      expect(await isTabInjectable(1)).toBe(true);
    });

    it('returns false for chrome:// URLs', async () => {
      vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ id: 1, url: 'chrome://settings' } as any);
      expect(await isTabInjectable(1)).toBe(false);
    });
  });

  describe('waitForInjectableTab', () => {
    it('resolves immediately if tab is already injectable', async () => {
      vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ id: 1, url: 'https://example.com' } as any);
      await expect(waitForInjectableTab(1, 100)).resolves.toBeUndefined();
    });

    it('resolves when tab navigates to an injectable page', async () => {
      vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ id: 1, url: 'chrome://newtab' } as any);

      let listener: any;
      vi.mocked(chrome.tabs.onUpdated.addListener).mockImplementation((l) => {
        listener = l;
      });

      const promise = waitForInjectableTab(1, 1000);
      
      // Fire updated event
      setTimeout(() => {
        listener(1, { status: 'complete' }, { id: 1, url: 'https://example.com' });
      }, 20);

      await expect(promise).resolves.toBeUndefined();
      expect(chrome.tabs.onUpdated.removeListener).toHaveBeenCalledOnce();
    });

    it('rejects when timing out', async () => {
      vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ id: 1, url: 'chrome://newtab' } as any);
      await expect(waitForInjectableTab(1, 20)).rejects.toThrow('Timed out waiting for tab');
    });

    it('ignores updates for a different tabId and only resolves once the correct tab fires', async () => {
      // Covers the `updatedTabId !== tabId` early-return branch in the onUpdated listener.
      vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ id: 1, url: 'chrome://newtab' } as any);

      let listener: any;
      vi.mocked(chrome.tabs.onUpdated.addListener).mockImplementation((l) => {
        listener = l;
      });

      const promise = waitForInjectableTab(1, 1000);

      setTimeout(() => {
        // Fire for a DIFFERENT tab first — should be ignored
        listener(999, { status: 'complete' }, { id: 999, url: 'https://other.com' });
        // Then fire for the correct tab
        listener(1, { status: 'complete' }, { id: 1, url: 'https://example.com' });
      }, 20);

      await expect(promise).resolves.toBeUndefined();
    });

    it('guards against done() being called more than once (resolved flag)', async () => {
      // Covers the `if (resolved) return` guard — firing the onUpdated listener twice for the
      // same tab should only call removeListener once (proves the flag stops double resolution).
      vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ id: 1, url: 'chrome://newtab' } as any);

      let listener: any;
      vi.mocked(chrome.tabs.onUpdated.addListener).mockImplementation((l) => {
        listener = l;
      });

      const promise = waitForInjectableTab(1, 1000);

      setTimeout(() => {
        listener(1, { status: 'complete' }, { id: 1, url: 'https://example.com' });
        // Fire again immediately — should be a no-op
        listener(1, { status: 'complete' }, { id: 1, url: 'https://example.com' });
      }, 20);

      await expect(promise).resolves.toBeUndefined();
      // removeListener must only be called once despite double-fire
      expect(chrome.tabs.onUpdated.removeListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('waitForTabLoad', () => {
    it('resolves immediately if tab is complete and expectNavigation is false', async () => {
      vi.mocked(chrome.tabs.get).mockResolvedValueOnce({ id: 1, status: 'complete' } as any);
      await expect(waitForTabLoad(1, 100, false)).resolves.toBeUndefined();
    });

    it('resolves when tab completes loading', async () => {
      let listener: any;
      vi.mocked(chrome.tabs.onUpdated.addListener).mockImplementation((l) => {
        listener = l;
      });

      const promise = waitForTabLoad(1, 1000, true);

      setTimeout(() => {
        // Fire loading status first (if expectNavigation: true)
        listener(1, { status: 'loading' });
        // Fire complete status next
        listener(1, { status: 'complete' });
      }, 20);

      await expect(promise).resolves.toBeUndefined();
    });

    it('ignores onUpdated events for a different tabId', async () => {
      // Covers the `updatedTabId !== tabId` early-return branch in waitForTabLoad's listener.
      let listener: any;
      vi.mocked(chrome.tabs.onUpdated.addListener).mockImplementation((l) => {
        listener = l;
      });

      const promise = waitForTabLoad(1, 1000, true);

      setTimeout(() => {
        // Fire for wrong tab — should be ignored
        listener(999, { status: 'complete' });
        // Fire the real loading + complete sequence
        listener(1, { status: 'loading' });
        listener(1, { status: 'complete' });
      }, 20);

      await expect(promise).resolves.toBeUndefined();
    });

    it('resolves via the catch path when chrome.tabs.get rejects', async () => {
      // Covers `.catch(done)` in waitForTabLoad when not expecting navigation.
      // If the initial chrome.tabs.get call rejects, `done` is called immediately.
      // Reject the initial get() so the catch branch calls done() and resolves the promise
      vi.mocked(chrome.tabs.get).mockRejectedValueOnce(new Error('Tab gone'));

      await expect(waitForTabLoad(1, 1000, false)).resolves.toBeUndefined();
    });
  });

  describe('ensureContentScript', () => {
    it('does not inject if content script already responds to ping', async () => {
      vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 1, url: 'https://example.com' } as any);
      vi.mocked(chrome.tabs.sendMessage).mockImplementation((id, msg, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        callback({ pong: true });
      });

      await ensureContentScript(1);
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    });

    it('injects content script if ping rejects/fails', async () => {
      vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 1, url: 'https://example.com' } as any);
      vi.mocked(chrome.tabs.sendMessage).mockImplementation((id, msg, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        chrome.runtime.lastError = { message: 'Could not establish connection' };
        callback(undefined);
      });
      vi.mocked(chrome.scripting.executeScript).mockResolvedValueOnce([{ result: undefined }] as any);

      await ensureContentScript(1);
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
        target: { tabId: 1, allFrames: true },
        files: ['content-scripts/content.js'],
      });
    });
  });
});
