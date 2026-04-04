/**
 * Integration tests for src/utils/dom-idle.ts
 *
 * waitForDOMIdle delegates to chrome.scripting.executeScript, which injects
 * a MutationObserver-based idle-detection script into the target tab.
 * We mock chrome.scripting.executeScript to avoid needing a real browser tab.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForDOMIdle } from '@/utils/dom-idle';

function installScriptingMock(impl?: () => Promise<unknown>) {
  const g = globalThis as Record<string, unknown>;
  const chrome = g.chrome as Record<string, Record<string, unknown>>;
  chrome.scripting = {
    executeScript: vi.fn(impl ?? (() => Promise.resolve([{ result: undefined }]))),
  };
}

beforeEach(() => {
  installScriptingMock();
});

describe('waitForDOMIdle', () => {
  it('calls chrome.scripting.executeScript with the correct tabId', async () => {
    await waitForDOMIdle(42);
    const executeScript = (
      globalThis as Record<string, Record<string, ReturnType<typeof vi.fn>>>
    ).chrome.scripting.executeScript;
    expect(executeScript).toHaveBeenCalledOnce();
    const [callArg] = executeScript.mock.calls[0] as [{ target: { tabId: number } }];
    expect(callArg.target.tabId).toBe(42);
  });

  it('resolves to undefined (void) on success', async () => {
    await expect(waitForDOMIdle(1)).resolves.toBeUndefined();
  });

  it('passes quietMs and timeoutMs as args to executeScript', async () => {
    await waitForDOMIdle(7, 300, 2000);
    const executeScript = (
      globalThis as Record<string, Record<string, ReturnType<typeof vi.fn>>>
    ).chrome.scripting.executeScript;
    const [callArg] = executeScript.mock.calls[0] as [{ args: number[] }];
    expect(callArg.args).toEqual([300, 2000]);
  });

  it('uses default quietMs=600 and timeoutMs=5000 when not provided', async () => {
    await waitForDOMIdle(5);
    const executeScript = (
      globalThis as Record<string, Record<string, ReturnType<typeof vi.fn>>>
    ).chrome.scripting.executeScript;
    const [callArg] = executeScript.mock.calls[0] as [{ args: number[] }];
    expect(callArg.args).toEqual([600, 5000]);
  });

  it('rejects when executeScript rejects', async () => {
    installScriptingMock(() => Promise.reject(new Error('tab not found')));
    await expect(waitForDOMIdle(99)).rejects.toThrow('tab not found');
  });

  it('injects a func (not a string) into the target', async () => {
    await waitForDOMIdle(3);
    const executeScript = (
      globalThis as Record<string, Record<string, ReturnType<typeof vi.fn>>>
    ).chrome.scripting.executeScript;
    const [callArg] = executeScript.mock.calls[0] as [{ func: unknown }];
    expect(typeof callArg.func).toBe('function');
  });
});
