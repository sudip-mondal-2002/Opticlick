import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForDOMIdle } from '@/utils/dom-idle';

describe('waitForDOMIdle inner MutationObserver', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    if (!globalThis.chrome) {
      globalThis.chrome = {} as any;
    }
    (globalThis.chrome as any).scripting = {};
  });

  afterEach(() => {
    if (globalThis.chrome) {
      delete (globalThis.chrome as any).scripting;
    }
  });

  it('resolves after quiet timeout when no mutations occur', async () => {
    let injectedFunc: (...args: any[]) => any = () => {};
    let args: any[] = [];

    (globalThis.chrome.scripting as any).executeScript = vi.fn(async (config: any) => {
      injectedFunc = config.func;
      args = config.args;
      await injectedFunc(...args);
      return [{ result: undefined }];
    });

    const start = Date.now();
    await waitForDOMIdle(1, 100, 1000);
    const duration = Date.now() - start;

    expect(duration).toBeGreaterThanOrEqual(90); // quietMs = 100
  });

  it('resets timer when a mutation occurs and then resolves', async () => {
    (globalThis.chrome.scripting as any).executeScript = vi.fn(async (config: any) => {
      const promise = config.func(...config.args);
      
      // Trigger a mutation after 50ms (before the 100ms quiet timer fires)
      setTimeout(() => {
        const div = document.createElement('div');
        document.body.appendChild(div);
      }, 50);

      await promise;
      return [{ result: undefined }];
    });

    const start = Date.now();
    await waitForDOMIdle(1, 100, 1000);
    const duration = Date.now() - start;

    // Mutation at 50ms + 100ms quietMs = ~150ms total wait
    expect(duration).toBeGreaterThanOrEqual(140);
  });

  it('resolves immediately when max timeout is reached, overriding quiet timer', async () => {
    (globalThis.chrome.scripting as any).executeScript = vi.fn(async (config: any) => {
      const promise = config.func(...config.args);
      
      // Continuously trigger mutations every 30ms so quiet timer never fires
      const interval = setInterval(() => {
        const div = document.createElement('div');
        document.body.appendChild(div);
      }, 30);

      await promise;
      clearInterval(interval);
      return [{ result: undefined }];
    });

    const start = Date.now();
    // quietMs = 200, but timeoutMs = 150
    await waitForDOMIdle(1, 200, 150);
    const duration = Date.now() - start;

    // Must resolve close to 150ms because max timeout fires
    expect(duration).toBeLessThan(300);
  });

  it('falls back to document.documentElement if document.body is null', async () => {
    (globalThis.chrome.scripting as any).executeScript = vi.fn(async (config: any) => {
      const originalBody = document.body;
      Object.defineProperty(document, 'body', {
        get() { return null; },
        configurable: true
      });
      try {
        await config.func(...config.args);
      } finally {
        Object.defineProperty(document, 'body', {
          get() { return originalBody; },
          configurable: true
        });
      }
      return [{ result: undefined }];
    });

    const start = Date.now();
    await waitForDOMIdle(1, 50, 500);
    const duration = Date.now() - start;
    expect(duration).toBeGreaterThanOrEqual(40);
  });
});
