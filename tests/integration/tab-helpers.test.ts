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
