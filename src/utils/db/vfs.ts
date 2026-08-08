import { openDB, VFS_STORE } from './core';
export const GLOBAL_SCOPE = 'global';
export const SESSION_SCOPE = 'session';

export interface VFSFile {
  id: string;
  sessionId: number;
  scope: 'session' | 'global';
  name: string;
  mimeType: string;
  data: string;
  size: number;
  createdAt: number;
}

export async function saveVFSFile(sessionId: number, name: string, base64Data: string, mimeType: string): Promise<VFSFile> {
  const db = await openDB();
  const file: VFSFile = {
  id: crypto.randomUUID(),
  sessionId,
  scope: SESSION_SCOPE,
  name,
  mimeType,
  data: base64Data,
  size: Math.round(base64Data.length * 0.75),
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
    const req = tx.objectStore(VFS_STORE).index('by-session').getAll(IDBKeyRange.only(sessionId));
    req.onsuccess = (e) => resolve((e.target as IDBRequest).result as VFSFile[]);
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}
export async function listGlobalVFSFiles(): Promise<VFSFile[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(VFS_STORE, 'readonly');
    const req = tx.objectStore(VFS_STORE)
      .index('by-scope')
      .getAll('global');

    req.onsuccess = (e) =>
      resolve((e.target as IDBRequest).result as VFSFile[]);

    req.onerror = (e) =>
      reject((e.target as IDBRequest).error);
  });
}



export async function listAccessibleVFSFiles(
  sessionId: number,
): Promise<VFSFile[]> {
  const [sessionFiles, globalFiles] = await Promise.all([
    listVFSFiles(sessionId),
    listGlobalVFSFiles(),
  ]);

  return [...globalFiles, ...sessionFiles];
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
export async function saveGlobalVFSFile(
  name: string,
  base64Data: string,
  mimeType: string,
): Promise<VFSFile> {
  const db = await openDB();

  const file: VFSFile = {
    id: crypto.randomUUID(),
    sessionId: 0,
    scope: 'global',
    name,
    mimeType,
    data: base64Data,
    size: Math.round(base64Data.length * 0.75),
    createdAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(VFS_STORE, 'readwrite');
    tx.objectStore(VFS_STORE).add(file);

    tx.oncomplete = () => resolve(file);
    tx.onerror = (e) =>
      reject((e.target as IDBTransaction).error);
  });
}

/** Write or overwrite a VFS file by name within a session (upsert semantics). */
export async function writeVFSFile(sessionId: number, name: string, base64Data: string, mimeType: string): Promise<VFSFile> {
  const existing = await listVFSFiles(sessionId);
  const collision = existing.find((f) => f.name === name);
  if (collision) await deleteVFSFile(collision.id);
  return saveVFSFile(sessionId, name, base64Data, mimeType);
}

export async function clearVFSFiles(sessionId: number, excludeNames: string[] = []): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VFS_STORE, 'readwrite');
    const req = tx.objectStore(VFS_STORE).index('by-session').openCursor(IDBKeyRange.only(sessionId));
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest).result as IDBCursorWithValue | null;
      if (cursor) {
        if (!excludeNames.includes((cursor.value as VFSFile).name)) cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}
