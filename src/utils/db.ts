/**
 * IndexedDB helpers for session and conversation history persistence.
 */

import type { Session } from './types';

const DB_NAME = 'OpticlickDB';
const DB_VERSION = 4;
const STORE_NAME = 'conversations';
const SESSIONS_STORE = 'sessions';
const VFS_STORE = 'vfs_files';
const MEMORY_STORE = 'memory';

interface ConversationTurn {
  id?: number;
  sessionId: number;
  role: string;
  content: string;
  ts: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
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

export async function createSession(title: string): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    const store = tx.objectStore(SESSIONS_STORE);
    const now = Date.now();
    const req = store.add({ title: title.slice(0, 80), createdAt: now, updatedAt: now } satisfies Session);
    req.onsuccess = (e) => resolve((e.target as IDBRequest).result as number);
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}

export async function getSessions(): Promise<Session[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const store = tx.objectStore(SESSIONS_STORE);
    const req = store.getAll();
    req.onsuccess = (e) => {
      const sessions = (e.target as IDBRequest).result as Session[];
      resolve(sessions.sort((a, b) => b.updatedAt - a.updatedAt));
    };
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function touchSession(sessionId: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    const store = tx.objectStore(SESSIONS_STORE);
    const getReq = store.get(sessionId);
    getReq.onsuccess = (e) => {
      const session = (e.target as IDBRequest).result as Session;
      if (session) store.put({ ...session, updatedAt: Date.now() });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}

export async function appendConversationTurn(
  sessionId: number,
  role: string,
  content: string,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add({ sessionId, role, content, ts: Date.now() } satisfies ConversationTurn);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}

export async function getConversationHistory(
  sessionId: number,
): Promise<ConversationTurn[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = (e) =>
      resolve(
        ((e.target as IDBRequest).result as ConversationTurn[]).filter(
          (r) => r.sessionId === sessionId,
        ),
      );
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

// ─── Virtual Filesystem (VFS) ────────────────────────────────────────────────

export interface VFSFile {
  id: string;
  sessionId: number;
  name: string;
  mimeType: string;
  /** Base64-encoded file data (no data-URL prefix). */
  data: string;
  size: number;
  createdAt: number;
}

export async function saveVFSFile(
  sessionId: number,
  name: string,
  base64Data: string,
  mimeType: string,
): Promise<VFSFile> {
  const db = await openDB();
  const file: VFSFile = {
    id: crypto.randomUUID(),
    sessionId,
    name,
    mimeType,
    data: base64Data,
    size: Math.round(base64Data.length * 0.75), // approx decoded bytes
    createdAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VFS_STORE, 'readwrite');
    tx.objectStore(VFS_STORE).add(file);
    tx.oncomplete = () => resolve(file);
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}

export async function getVFSFile(id: string): Promise<VFSFile | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VFS_STORE, 'readonly');
    const req = tx.objectStore(VFS_STORE).get(id);
    req.onsuccess = (e) => resolve((e.target as IDBRequest).result as VFSFile | undefined);
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function listVFSFiles(sessionId: number): Promise<VFSFile[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VFS_STORE, 'readonly');
    const index = tx.objectStore(VFS_STORE).index('by-session');
    const req = index.getAll(IDBKeyRange.only(sessionId));
    req.onsuccess = (e) => resolve((e.target as IDBRequest).result as VFSFile[]);
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function deleteVFSFile(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VFS_STORE, 'readwrite');
    tx.objectStore(VFS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}

/** Write or overwrite a VFS file by name within a session (upsert semantics). */
export async function writeVFSFile(
  sessionId: number,
  name: string,
  base64Data: string,
  mimeType: string,
): Promise<VFSFile> {
  // Delete any existing file with the same name so names stay unique
  const existing = await listVFSFiles(sessionId);
  const collision = existing.find((f) => f.name === name);
  if (collision) await deleteVFSFile(collision.id);
  return saveVFSFile(sessionId, name, base64Data, mimeType);
}

export async function clearVFSFiles(sessionId: number, excludeNames: string[] = []): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VFS_STORE, 'readwrite');
    const index = tx.objectStore(VFS_STORE).index('by-session');
    const req = index.openCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest).result as IDBCursorWithValue | null;
      if (cursor) {
        const file = cursor.value as VFSFile;
        if (!excludeNames.includes(file.name)) cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}

// ─── Persistent Memory ──────────────────────────────────────────────────────

export interface MemoryEntry {
  /** Namespaced identifier, e.g. "github/username" or "google/email". */
  key: string;
  /** One or more values — supports multi-account scenarios. */
  values: string[];
  /** Broad category: account, preference, fact, other. */
  category: string;
  /** URL where this information was discovered. */
  sourceUrl?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Insert or merge a memory entry.
 * If the key already exists, new values are merged (deduplicated) into the
 * existing array and metadata is updated.
 */
export async function upsertMemory(
  key: string,
  values: string[],
  category = 'other',
  sourceUrl?: string,
): Promise<MemoryEntry> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE, 'readwrite');
    const store = tx.objectStore(MEMORY_STORE);
    const getReq = store.get(key);
    getReq.onsuccess = (e) => {
      const existing = (e.target as IDBRequest).result as MemoryEntry | undefined;
      const now = Date.now();
      let entry: MemoryEntry;
      if (existing) {
        // Merge values, deduplicate
        const merged = [...new Set([...existing.values, ...values])];
        entry = {
          ...existing,
          values: merged,
          category,
          updatedAt: now,
          ...(sourceUrl !== undefined && { sourceUrl }),
        };
      } else {
        entry = {
          key,
          values: [...new Set(values)],
          category,
          sourceUrl,
          createdAt: now,
          updatedAt: now,
        };
      }
      store.put(entry);
      tx.oncomplete = () => resolve(entry);
    };
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}

export async function getMemory(key: string): Promise<MemoryEntry | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE, 'readonly');
    const req = tx.objectStore(MEMORY_STORE).get(key);
    req.onsuccess = (e) => resolve((e.target as IDBRequest).result as MemoryEntry | undefined);
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function getAllMemories(): Promise<MemoryEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMORY_STORE, 'readonly');
    const req = tx.objectStore(MEMORY_STORE).getAll();
    req.onsuccess = (e) => {
      const entries = (e.target as IDBRequest).result as MemoryEntry[];
      resolve(entries.sort((a, b) => b.updatedAt - a.updatedAt));
    };
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
