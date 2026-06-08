import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openDB, DB_NAME } from '@/utils/db/core';
import {
  createSession,
  updateSessionMetadata,
  appendToSessionSearchText,
  touchSession,
  appendConversationTurn,
  getConversationHistory
} from '@/utils/db';
import { CONV_BY_SESSION_INDEX, CONV_STORE } from '@/utils/db/core';

describe('IndexedDB Error Paths and Fallbacks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('covers openDB error branch', async () => {
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      const req = {} as any;
      setTimeout(() => {
        const err = new Error('Mock IndexedDB open failure');
        req.error = err;
        if (req.onerror) req.onerror({ target: req } as any);
      }, 0);
      return req;
    });

    await expect(openDB()).rejects.toThrow('Mock IndexedDB open failure');
    openSpy.mockRestore();
  });

  it('covers getConversationHistory fallback when index is missing', async () => {
    const originalOpen = indexedDB.open.bind(indexedDB);
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
      const req = originalOpen(name, version);
      req.addEventListener('success', (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        const originalTx = db.transaction.bind(db);
        vi.spyOn(db, 'transaction').mockImplementation((storeNames, mode) => {
          const tx = originalTx(storeNames, mode);
          const originalStore = tx.objectStore.bind(tx);
          tx.objectStore = (storeName) => {
            const store = originalStore(storeName);
            if (storeName === CONV_STORE) {
              store.indexNames.contains = (indexName) => {
                if (indexName === CONV_BY_SESSION_INDEX) return false;
                return true;
              };
            }
            return store;
          };
          return tx;
        });
      });
      return req;
    });

    const id = await createSession('FallbackIndex');
    await appendConversationTurn(id, 'user', 'hi index fallback');
    const history = await getConversationHistory(id);
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe('hi index fallback');

    openSpy.mockRestore();
  });

  it('covers appendConversationTurn transaction error branch', async () => {
    const originalOpen = indexedDB.open.bind(indexedDB);
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
      const req = originalOpen(name, version);
      req.addEventListener('success', (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        vi.spyOn(db, 'transaction').mockImplementation(() => {
          const tx = {
            objectStore: () => ({
              add: () => ({}),
            }),
          } as any;
          setTimeout(() => {
            tx.error = new Error('Mock transaction failure');
            if (tx.onerror) tx.onerror({ target: tx } as any);
          }, 0);
          return tx;
        });
      });
      return req;
    });

    await expect(appendConversationTurn(999, 'user', 'fail')).rejects.toThrow('Mock transaction failure');
    openSpy.mockRestore();
  });

  it('covers getConversationHistory request error branch', async () => {
    const originalOpen = indexedDB.open.bind(indexedDB);
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
      const req = originalOpen(name, version);
      req.addEventListener('success', (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        vi.spyOn(db, 'transaction').mockImplementation(() => {
          const request = {} as any;
          const tx = {
            objectStore: () => ({
              indexNames: {
                contains: () => true,
              },
              index: () => ({
                getAll: () => request,
              }),
            }),
          } as any;
          setTimeout(() => {
            request.error = new Error('Mock request failure');
            if (request.onerror) request.onerror({ target: request } as any);
          }, 0);
          return tx;
        });
      });
      return req;
    });

    await expect(getConversationHistory(999)).rejects.toThrow('Mock request failure');
    openSpy.mockRestore();
  });

  it('covers getConversationHistory request error branch for index missing fallback', async () => {
    const originalOpen = indexedDB.open.bind(indexedDB);
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
      const req = originalOpen(name, version);
      req.addEventListener('success', (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        vi.spyOn(db, 'transaction').mockImplementation(() => {
          const request = {} as any;
          const tx = {
            objectStore: () => ({
              indexNames: {
                contains: () => false,
              },
              getAll: () => request,
            }),
          } as any;
          setTimeout(() => {
            request.error = new Error('Mock fallback request failure');
            if (request.onerror) request.onerror({ target: request } as any);
          }, 0);
          return tx;
        });
      });
      return req;
    });

    await expect(getConversationHistory(999)).rejects.toThrow('Mock fallback request failure');
    openSpy.mockRestore();
  });

  it('covers updateSessionMetadata, appendToSessionSearchText, and touchSession when session is not found', async () => {
    await expect(updateSessionMetadata(999999, { modelId: 'nonexistent' })).resolves.not.toThrow();
    await expect(appendToSessionSearchText(999999, 'snippet')).resolves.not.toThrow();
    await expect(touchSession(999999)).resolves.not.toThrow();
  });

  it('covers database upgradeneeded branch for version < 5', async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
    });

    const db1 = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        db.createObjectStore(CONV_STORE, { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
      req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
    });
    db1.close();

    const db2 = await openDB();
    expect(db2.objectStoreNames.contains(CONV_STORE)).toBe(true);
    db2.close();
  });

  it('covers upgradeneeded when CONV_STORE already exists (takes the else branch for existing store)', async () => {
    // Wipe the DB so we get a clean v1 state without CONV_STORE's by-session index
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
    });

    // Create a v1 DB with SESSIONS, CONV, VFS, and MEMORY but without the by-session index on CONV
    const db1 = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore(CONV_STORE, { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('vfs_files', { keyPath: 'id' });
        db.createObjectStore('memory', { keyPath: 'key' });
      };
      req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
      req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
    });
    db1.close();

    // Now upgrade to v5 — CONV_STORE already exists, so it takes the `else` branch.
    // The by-session index does NOT exist yet, so it should be created.
    const db2 = await openDB();
    expect(db2.objectStoreNames.contains(CONV_STORE)).toBe(true);
    db2.close();
  });
});

// ── Memory CRUD onerror paths ─────────────────────────────────────────────────

import { upsertMemory, getAllMemories, deleteMemory } from '@/utils/db/memory';
import { getSession, getSessions } from '@/utils/db/sessions';
import { saveVFSFile, getVFSFile, listVFSFiles, deleteVFSFile } from '@/utils/db/vfs';

/** Helper: wrap an indexedDB.open spy that patches the returned db's transaction method
 *  to inject an error into the specified callback kind ('onerror' | 'req.onerror'). */
function spyDbTransactionError(errorMsg: string, target: 'tx' | 'req') {
  const originalOpen = indexedDB.open.bind(indexedDB);
  return vi.spyOn(indexedDB, 'open').mockImplementation((name, version) => {
    const req = originalOpen(name, version);
    req.addEventListener('success', (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      vi.spyOn(db, 'transaction').mockImplementation(() => {
        const request = {} as any;
        const tx: any = {
          objectStore: () => ({
            indexNames: { contains: () => true },
            index: () => ({ getAll: () => request }),
            get: () => request,
            getAll: () => request,
            add: () => request,
            put: () => request,
            delete: () => request,
            openCursor: () => request,
          }),
        };
        setTimeout(() => {
          const err = new Error(errorMsg);
          if (target === 'tx') {
            tx.error = err;
            if (tx.onerror) tx.onerror({ target: tx } as any);
          } else {
            request.error = err;
            if (request.onerror) request.onerror({ target: request } as any);
          }
        }, 0);
        return tx;
      });
    });
    return req;
  });
}

describe('Memory CRUD — onerror branches', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('rejects upsertMemory when the transaction errors', async () => {
    const spy = spyDbTransactionError('upsert tx fail', 'tx');
    await expect(upsertMemory('k', ['v'])).rejects.toThrow('upsert tx fail');
    spy.mockRestore();
  });

  it('rejects getAllMemories when the request errors', async () => {
    const spy = spyDbTransactionError('getAll req fail', 'req');
    await expect(getAllMemories()).rejects.toThrow('getAll req fail');
    spy.mockRestore();
  });

  it('rejects deleteMemory when the transaction errors', async () => {
    const spy = spyDbTransactionError('delete tx fail', 'tx');
    await expect(deleteMemory('k')).rejects.toThrow('delete tx fail');
    spy.mockRestore();
  });
});

describe('Sessions CRUD — onerror branches', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('rejects createSession when the transaction errors', async () => {
    const spy = spyDbTransactionError('create tx fail', 'tx');
    await expect(createSession('title')).rejects.toThrow('create tx fail');
    spy.mockRestore();
  });

  it('rejects getSession when the transaction errors', async () => {
    const spy = spyDbTransactionError('get tx fail', 'tx');
    await expect(getSession(1)).rejects.toThrow('get tx fail');
    spy.mockRestore();
  });

  it('rejects getSessions when the request errors', async () => {
    const spy = spyDbTransactionError('getSessions req fail', 'req');
    await expect(getSessions()).rejects.toThrow('getSessions req fail');
    spy.mockRestore();
  });
});

describe('VFS CRUD — onerror branches', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('rejects saveVFSFile when the transaction errors', async () => {
    const spy = spyDbTransactionError('saveVFS tx fail', 'tx');
    await expect(saveVFSFile(1, 'f.txt', 'abc', 'text/plain')).rejects.toThrow('saveVFS tx fail');
    spy.mockRestore();
  });

  it('rejects getVFSFile when the request errors', async () => {
    const spy = spyDbTransactionError('getVFS req fail', 'req');
    await expect(getVFSFile('some-id')).rejects.toThrow('getVFS req fail');
    spy.mockRestore();
  });

  it('rejects listVFSFiles when the request errors', async () => {
    const spy = spyDbTransactionError('listVFS req fail', 'req');
    await expect(listVFSFiles(1)).rejects.toThrow('listVFS req fail');
    spy.mockRestore();
  });

  it('rejects deleteVFSFile when the transaction errors', async () => {
    const spy = spyDbTransactionError('deleteVFS tx fail', 'tx');
    await expect(deleteVFSFile('some-id')).rejects.toThrow('deleteVFS tx fail');
    spy.mockRestore();
  });
});

