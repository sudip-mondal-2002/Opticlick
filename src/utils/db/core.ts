/** Shared IndexedDB handle — open once, reuse across all stores. */

export const DB_NAME = 'OpticlickDB';
export const DB_VERSION = 6;
export const SESSIONS_STORE = 'sessions';
export const CONV_STORE = 'conversations';
export const CONV_BY_SESSION_INDEX = 'by-session';
export const VFS_STORE = 'vfs_files';
export const MEMORY_STORE = 'memory';

export interface OpenDBOptions {
  mode?: 'auto-delete' | 'reject';
}

export function openDB(options?: OpenDBOptions): Promise<IDBDatabase> {
  const mode = options?.mode ?? (import.meta.env?.MODE === 'development' ? 'auto-delete' : 'reject');
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      const tx = (e.target as IDBOpenDBRequest).transaction;
      if (!tx) return;

      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'id', autoIncrement: true });
      }

      let convStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(CONV_STORE)) {
        convStore = db.createObjectStore(CONV_STORE, { keyPath: 'id', autoIncrement: true });
      } else {
        convStore = tx.objectStore(CONV_STORE);
      }

      if (!convStore.indexNames.contains(CONV_BY_SESSION_INDEX)) {
        convStore.createIndex(CONV_BY_SESSION_INDEX, 'sessionId', { unique: false });
      }

      let vfsStore: IDBObjectStore;

if (!db.objectStoreNames.contains(VFS_STORE)) {
  vfsStore = db.createObjectStore(VFS_STORE, { keyPath: 'id' });
} else {
  vfsStore = tx.objectStore(VFS_STORE);
}

if (!vfsStore.indexNames.contains('by-session')) {
  vfsStore.createIndex('by-session', 'sessionId', { unique: false });
}

if (!vfsStore.indexNames.contains('by-scope')) {
  vfsStore.createIndex('by-scope', 'scope', { unique: false });
}
      if (!db.objectStoreNames.contains(MEMORY_STORE)) {
        db.createObjectStore(MEMORY_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => {
      const error = (e.target as IDBOpenDBRequest).error;
      if (error && error.name === 'VersionError') {
        if (mode === 'reject') {
          reject(error);
        } else {
          console.warn(`[openDB] Version mismatch (requested ${DB_VERSION}). Deleting database ${DB_NAME} and retrying...`);
          const deleteReq = indexedDB.deleteDatabase(DB_NAME);
          deleteReq.onsuccess = () => {
            openDB(options).then(resolve).catch(reject);
          };
          deleteReq.onerror = () => {
            reject(error);
          };
          deleteReq.onblocked = () => {
            console.warn('[openDB] Database deletion is blocked by another open connection.');
            reject(error);
          };
        }
      } else {
        reject(error);
      }
    };
  });
}
