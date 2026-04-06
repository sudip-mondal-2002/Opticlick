import type { Session } from '../types';
import { openDB, SESSIONS_STORE } from './core';

export async function createSession(title: string): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    const now = Date.now();
    const req = tx.objectStore(SESSIONS_STORE).add(
      { title: title.slice(0, 80), createdAt: now, updatedAt: now } satisfies Session,
    );
    req.onsuccess = (e) => resolve((e.target as IDBRequest).result as number);
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}

export async function getSessions(): Promise<Session[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const req = tx.objectStore(SESSIONS_STORE).getAll();
    req.onsuccess = (e) =>
      resolve(((e.target as IDBRequest).result as Session[]).sort((a, b) => b.updatedAt - a.updatedAt));
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
