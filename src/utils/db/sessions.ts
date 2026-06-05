import type { Session } from '../types';
import { buildSearchText, mergeSearchText } from '../session-search-text';
import { openDB, SESSIONS_STORE } from './core';

export interface CreateSessionOptions {
  modelId?: string;
  startUrl?: string;
}

export type SessionMetadataPatch = Partial<Pick<Session, 'modelId' | 'startUrl' | 'searchText'>>;

export async function createSession(title: string, opts?: CreateSessionOptions): Promise<number> {
  const db = await openDB();
  const trimmedTitle = title.slice(0, 80);
  const searchText = buildSearchText(trimmedTitle, opts?.startUrl ?? '');

  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    const now = Date.now();
    const session: Omit<Session, 'id'> = {
      title: trimmedTitle,
      createdAt: now,
      updatedAt: now,
      ...(opts?.modelId != null && { modelId: opts.modelId }),
      ...(opts?.startUrl != null && opts.startUrl !== '' && { startUrl: opts.startUrl }),
      ...(searchText && { searchText }),
    };
    const req = tx.objectStore(SESSIONS_STORE).add(session);
    req.onsuccess = (e) => resolve((e.target as IDBRequest).result as number);
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}

export async function getSession(sessionId: number): Promise<Session | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const req = tx.objectStore(SESSIONS_STORE).get(sessionId);
    req.onsuccess = (e) => resolve((e.target as IDBRequest).result as Session | undefined);
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

export async function updateSessionMetadata(sessionId: number, patch: SessionMetadataPatch): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    const store = tx.objectStore(SESSIONS_STORE);
    const getReq = store.get(sessionId);
    getReq.onsuccess = (e) => {
      const session = (e.target as IDBRequest).result as Session | undefined;
      if (!session) return;
      store.put({ ...session, ...patch, updatedAt: Date.now() });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}

export async function appendToSessionSearchText(sessionId: number, snippet: string): Promise<void> {
  if (!snippet.trim()) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    const store = tx.objectStore(SESSIONS_STORE);
    const getReq = store.get(sessionId);
    getReq.onsuccess = (e) => {
      const session = (e.target as IDBRequest).result as Session | undefined;
      if (!session) return;
      const searchText = mergeSearchText(session.searchText, snippet);
      if (searchText !== session.searchText) {
        store.put({ ...session, searchText, updatedAt: Date.now() });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
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
