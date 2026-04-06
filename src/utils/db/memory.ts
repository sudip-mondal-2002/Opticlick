import { openDB, MEMORY_STORE } from './core';

export interface MemoryEntry {
  /** Namespaced identifier, e.g. "github/username". */
  key: string;
  values: string[];
  category: string;
  sourceUrl?: string;
  createdAt: number;
  updatedAt: number;
}

/** Insert or merge a memory entry; new values are deduplicated into the existing array. */
export async function upsertMemory(
  key: string, values: string[], category = 'other', sourceUrl?: string,
): Promise<MemoryEntry> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE, 'readwrite');
    const store = tx.objectStore(MEMORY_STORE);
    const getReq = store.get(key);
    getReq.onsuccess = (e) => {
      const existing = (e.target as IDBRequest).result as MemoryEntry | undefined;
      const now = Date.now();
      const entry: MemoryEntry = existing
        ? { ...existing, values: [...new Set([...existing.values, ...values])], category, updatedAt: now, ...(sourceUrl !== undefined && { sourceUrl }) }
        : { key, values: [...new Set(values)], category, sourceUrl, createdAt: now, updatedAt: now };
      store.put(entry);
      tx.oncomplete = () => resolve(entry);
    };
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}

export async function getAllMemories(): Promise<MemoryEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE, 'readonly');
    const req = tx.objectStore(MEMORY_STORE).getAll();
    req.onsuccess = (e) =>
      resolve(((e.target as IDBRequest).result as MemoryEntry[]).sort((a, b) => b.updatedAt - a.updatedAt));
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function deleteMemory(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE, 'readwrite');
    tx.objectStore(MEMORY_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}
