/**
 * IndexedDB helpers for session and conversation history persistence.
 */

import type { Session } from './types';

const DB_NAME = 'OpticlickDB';
const DB_VERSION = 2;
const STORE_NAME = 'conversations';
const SESSIONS_STORE = 'sessions';

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
