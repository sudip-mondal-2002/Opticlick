/**
 * IndexedDB helpers for conversation history persistence.
 */

const DB_NAME = 'OpticlickDB';
const DB_VERSION = 1;
const STORE_NAME = 'conversations';

interface ConversationTurn {
  id?: number;
  tabId: number;
  role: string;
  content: string;
  ts: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

export async function appendConversationTurn(
  tabId: number,
  role: string,
  content: string,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add({ tabId, role, content, ts: Date.now() } satisfies ConversationTurn);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}

export async function getConversationHistory(
  tabId: number,
): Promise<ConversationTurn[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = (e) =>
      resolve(
        ((e.target as IDBRequest).result as ConversationTurn[]).filter(
          (r) => r.tabId === tabId,
        ),
      );
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}
