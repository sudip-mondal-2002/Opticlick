/** Shared IndexedDB handle — open once, reuse across all stores. */

export const DB_NAME = 'OpticlickDB';
export const DB_VERSION = 5;
export const SESSIONS_STORE = 'sessions';
export const CONV_STORE = 'conversations';
export const CONV_BY_SESSION_INDEX = 'by-session';
export const VFS_STORE = 'vfs_files';
export const MEMORY_STORE = 'memory';

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      const tx = (e.target as IDBOpenDBRequest).transaction;
      if (!tx) return;
      const oldVersion = e.oldVersion;

      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'id', autoIncrement: true });
      }

      let convStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(CONV_STORE)) {
        convStore = db.createObjectStore(CONV_STORE, { keyPath: 'id', autoIncrement: true });
      } else if (oldVersion < 5) {
        convStore = tx.objectStore(CONV_STORE);
      } else {
        convStore = tx.objectStore(CONV_STORE);
      }

      if (!convStore.indexNames.contains(CONV_BY_SESSION_INDEX)) {
        convStore.createIndex(CONV_BY_SESSION_INDEX, 'sessionId', { unique: false });
      }

      if (!db.objectStoreNames.contains(VFS_STORE)) {
        const vfsStore = db.createObjectStore(VFS_STORE, { keyPath: 'id' });
        vfsStore.createIndex('by-session', 'sessionId', { unique: false });
      }
      if (!db.objectStoreNames.contains(MEMORY_STORE)) {
        db.createObjectStore(MEMORY_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}
