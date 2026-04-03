import { vi, beforeEach } from 'vitest';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MockDownloads {
  download: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  removeFile: ReturnType<typeof vi.fn>;
  erase: ReturnType<typeof vi.fn>;
  onChanged: {
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    _listeners: Array<(delta: unknown) => void>;
    /** Fire a download change event to all registered listeners (test helper). */
    _fire: (delta: unknown) => void;
  };
}

export interface MockDebugger {
  attach: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  sendCommand: ReturnType<typeof vi.fn>;
  onDetach: {
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
    _listeners: Array<(target: { tabId?: number }) => void>;
    _fire: (target: { tabId?: number }) => void;
  };
  onEvent: {
    addListener: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
  };
}

// ── Stable mocks (created once at module load) ────────────────────────────────
//
// These objects are created once and kept stable across tests so that any
// module-level code that registers listeners at import time (e.g. cdp.ts
// registering chrome.debugger.onDetach.addListener) continues to hold valid
// references. Mock call history is cleared in beforeEach.
//
// The onChanged / onDetach _listeners arrays are also cleared in beforeEach
// to prevent test-registered listeners from leaking between tests.
// The module-level listeners from cdp.ts are exempt because they are
// registered BEFORE beforeEach runs; they survive the array clear because
// they are added AFTER the array is cleared (on the next module import).
// Actually: since the module is cached, module-level registrations happen only
// once. To avoid clearing them, we DON'T clear the onDetach._listeners in
// beforeEach — only the onChanged._listeners (which are all test-scoped).

const _downloadsListeners: Array<(delta: unknown) => void> = [];
const _onDetachListeners: Array<(target: { tabId?: number }) => void> = [];

export const _mockDownloads: MockDownloads = {
  download: vi.fn(),
  search: vi.fn(),
  removeFile: vi.fn().mockResolvedValue(undefined),
  erase: vi.fn().mockResolvedValue(undefined),
  onChanged: {
    addListener: vi.fn((cb: (delta: unknown) => void) => _downloadsListeners.push(cb)),
    removeListener: vi.fn((cb: (delta: unknown) => void) => {
      const i = _downloadsListeners.indexOf(cb);
      if (i >= 0) _downloadsListeners.splice(i, 1);
    }),
    _listeners: _downloadsListeners,
    _fire(delta: unknown) {
      for (const l of [..._downloadsListeners]) l(delta);
    },
  },
};

export const _mockDebugger: MockDebugger = {
  attach: vi.fn().mockResolvedValue(undefined),
  detach: vi.fn().mockResolvedValue(undefined),
  sendCommand: vi.fn().mockResolvedValue({}),
  onDetach: {
    addListener: vi.fn((cb: (target: { tabId?: number }) => void) =>
      _onDetachListeners.push(cb),
    ),
    removeListener: vi.fn((cb: (target: { tabId?: number }) => void) => {
      const i = _onDetachListeners.indexOf(cb);
      if (i >= 0) _onDetachListeners.splice(i, 1);
    }),
    _listeners: _onDetachListeners,
    _fire(target: { tabId?: number }) {
      for (const l of [..._onDetachListeners]) l(target);
    },
  },
  onEvent: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
};

// Install into globalThis.chrome at module load so cdp.ts sees debugger.onDetach
// when it registers the module-level listener.
function installMocks() {
  const g = globalThis as Record<string, unknown>;
  const existing = (g.chrome ?? {}) as Record<string, unknown>;
  g.chrome = {
    ...existing,
    downloads: _mockDownloads,
    debugger: _mockDebugger,
    runtime: {
      ...((existing.runtime as Record<string, unknown>) ?? {}),
      lastError: undefined as { message: string } | undefined,
    },
  };
}

installMocks();

// Accessor functions for test files
export function getMockDownloads(): MockDownloads {
  return _mockDownloads;
}
export function getMockDebugger(): MockDebugger {
  return _mockDebugger;
}

// ── Reset between tests ───────────────────────────────────────────────────────

beforeEach(() => {
  // Clear download event listeners (all registered during tests, not at module load)
  _downloadsListeners.length = 0;
  // DO NOT clear _onDetachListeners — cdp.ts registers there at module load time

  // Reset all mock call histories and restore default implementations
  vi.clearAllMocks();

  // Restore default implementations
  _mockDownloads.removeFile.mockResolvedValue(undefined);
  _mockDownloads.erase.mockResolvedValue(undefined);
  _mockDebugger.attach.mockResolvedValue(undefined);
  _mockDebugger.detach.mockResolvedValue(undefined);
  _mockDebugger.sendCommand.mockResolvedValue({});

  // Re-wire addListener for the fresh listeners array
  _mockDownloads.onChanged.addListener.mockImplementation(
    (cb: (delta: unknown) => void) => _downloadsListeners.push(cb),
  );
  _mockDownloads.onChanged.removeListener.mockImplementation(
    (cb: (delta: unknown) => void) => {
      const i = _downloadsListeners.indexOf(cb);
      if (i >= 0) _downloadsListeners.splice(i, 1);
    },
  );

  // Clear runtime.lastError
  const g = globalThis as Record<string, unknown>;
  const chrome = g.chrome as Record<string, unknown>;
  (chrome.runtime as Record<string, unknown>).lastError = undefined;

  // Re-install chrome to pick up any changes fake-browser-setup made
  installMocks();
});
