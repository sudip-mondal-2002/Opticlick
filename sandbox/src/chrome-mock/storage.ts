/**
 * chrome.storage shim
 * - storage.local → localStorage (JSON-serialised per key)
 * - storage.session → in-memory Map (cleared on page reload)
 * - storage.onChanged → custom EventEmitter
 */

type StorageArea = 'local' | 'session';

const sessionStore = new Map<string, unknown>();
const changeListeners: Array<(changes: Record<string, chrome.storage.StorageChange>, area: StorageArea) => void> = [];

function fireChange(changes: Record<string, unknown>, area: StorageArea) {
  const changeObj: Record<string, chrome.storage.StorageChange> = {};
  for (const [k, newValue] of Object.entries(changes)) {
    changeObj[k] = { newValue } as chrome.storage.StorageChange;
  }
  changeListeners.forEach(l => l(changeObj, area));
}

function makeArea(area: StorageArea): chrome.storage.LocalStorageArea {
  const isLocal = area === 'local';
  return {
    get(keys?: string | string[] | Record<string, unknown> | null, callback?: (items: Record<string, unknown>) => void): Promise<Record<string, unknown>> {
      const result: Record<string, unknown> = {};
      const resolve = (res: Record<string, unknown>) => { callback?.(res); return res; };

      if (keys == null) {
        // Return all
        if (isLocal) {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k === null) continue;
            const raw = localStorage.getItem(k);
            if (raw !== null) {
              try { result[k] = JSON.parse(raw); } catch { result[k] = raw; }
            }
          }
        } else {
          sessionStore.forEach((v, k) => { result[k] = v; });
        }
        return Promise.resolve(resolve(result));
      }

      const keyList = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const defaults = typeof keys === 'object' && !Array.isArray(keys) ? keys as Record<string, unknown> : {};

      for (const k of keyList) {
        if (isLocal) {
          const raw = localStorage.getItem(k);
          result[k] = raw != null ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : (defaults[k] ?? undefined);
        } else {
          result[k] = sessionStore.has(k) ? sessionStore.get(k) : (defaults[k] ?? undefined);
        }
      }
      return Promise.resolve(resolve(result));
    },

    set(items: Record<string, unknown>, callback?: () => void): Promise<void> {
      if (isLocal) {
        for (const [k, v] of Object.entries(items)) localStorage.setItem(k, JSON.stringify(v));
      } else {
        for (const [k, v] of Object.entries(items)) sessionStore.set(k, v);
      }
      fireChange(items, area);
      callback?.();
      return Promise.resolve();
    },

    remove(keys: string | string[], callback?: () => void): Promise<void> {
      const ks = Array.isArray(keys) ? keys : [keys];
      if (isLocal) {
        ks.forEach(k => localStorage.removeItem(k));
      } else {
        ks.forEach(k => sessionStore.delete(k));
      }
      callback?.();
      return Promise.resolve();
    },

    clear(callback?: () => void): Promise<void> {
      if (isLocal) localStorage.clear();
      else sessionStore.clear();
      callback?.();
      return Promise.resolve();
    },

    // Required by type but not used
    getBytesInUse: () => Promise.resolve(0),
    setAccessLevel: () => Promise.resolve(),
    onChanged: { addListener: () => {}, removeListener: () => {}, hasListener: () => false } as any,
  } as unknown as chrome.storage.LocalStorageArea;
}

export const storageShim = {
  local: makeArea('local'),
  session: makeArea('session'),
  sync: makeArea('local'), // treat sync as local for sandbox
  onChanged: {
    addListener(cb: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) {
      changeListeners.push(cb as any);
    },
    removeListener(cb: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void) {
      const i = changeListeners.indexOf(cb as any);
      if (i !== -1) changeListeners.splice(i, 1);
    },
    hasListener: () => false,
  },
};
