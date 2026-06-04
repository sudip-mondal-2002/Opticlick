/**
 * Chrome API shim — MUST be imported before anything else.
 *
 * Sets window.chrome to a complete mock so the sidepanel React app
 * and agent loop can run in a plain browser context.
 */

import { storageShim } from './storage';
import { tabsShim } from './tabs';
import { debuggerShim } from './debugger';
import { scriptingShim } from './scripting';
import { runtimeShim } from './runtime';

const chromeMock = {
  storage: storageShim,
  tabs: tabsShim,
  debugger: debuggerShim,
  scripting: scriptingShim,
  runtime: runtimeShim,

  // Downloads — no-op in sandbox
  downloads: {
    download: () => {},
    cancel: () => {},
    erase: () => {},
    search: (_q: object, cb?: (items: unknown[]) => void) => cb?.([]),
    removeFile: () => Promise.resolve(),
    onCreated: { addListener: () => {}, removeListener: () => {} },
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },

  // SidePanel — no-op (we render the sidepanel inline)
  sidePanel: {
    setPanelBehavior: () => Promise.resolve(),
    open: () => Promise.resolve(),
    setOptions: () => Promise.resolve(),
    getOptions: () => Promise.resolve({}),
  },

  // Windows — minimal
  windows: {
    getCurrent: (_opts: object, cb?: (w: object) => void) => cb?.({ id: 1 }),
    getAll: (_opts: object, cb?: (ws: object[]) => void) => cb?.([{ id: 1 }]),
  },
};

// Attach to window before any other module runs
(window as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;

export {}; // ensure this is treated as a module
