/**
 * DOM test environment setup.
 *
 * Patches jsdom's TextEncoder/TextDecoder with Node's native implementations
 * so WXT internals (which use esbuild) don't break on the Uint8Array instanceof check.
 *
 * Also provides a minimal chrome.storage.local stub (no WXT import needed).
 */
import { TextEncoder, TextDecoder } from 'util';
import { beforeEach, vi } from 'vitest';

// Fix jsdom's TextEncoder — jsdom's version doesn't produce native Uint8Arrays
Object.assign(globalThis, { TextEncoder, TextDecoder });

// Minimal chrome stub for DOM tests.
// overlay.ts calls chrome.storage.local.get('opticlickTheme') in getTheme().
function installChromeDOMStub() {
  const storage: Record<string, unknown> = {};
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(storage, items)),
      },
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
      },
    },
    runtime: {
      lastError: undefined,
    },
    debugger: {
      onDetach: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
}

installChromeDOMStub();
beforeEach(() => {
  vi.clearAllMocks();
  installChromeDOMStub();
});
