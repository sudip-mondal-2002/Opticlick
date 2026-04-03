import { describe, it, expect } from 'vitest';
import {
  createSession,
  saveVFSFile,
  getVFSFile,
  listVFSFiles,
  deleteVFSFile,
  writeVFSFile,
  clearVFSFiles,
} from '@/utils/db';

async function makeSession(title = 'Test') {
  return createSession(title);
}

describe('saveVFSFile', () => {
  it('returns a VFSFile with a UUID id', async () => {
    const sid = await makeSession();
    const file = await saveVFSFile(sid, 'test.txt', 'aGVsbG8=', 'text/plain');
    expect(file.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('size equals Math.round(base64Data.length * 0.75)', async () => {
    const sid = await makeSession();
    const b64 = 'aGVsbG8='; // 8 chars
    const file = await saveVFSFile(sid, 'f.txt', b64, 'text/plain');
    expect(file.size).toBe(Math.round(b64.length * 0.75));
  });

  it('stores all fields correctly', async () => {
    const sid = await makeSession();
    const before = Date.now();
    const file = await saveVFSFile(sid, 'img.png', 'abc', 'image/png');
    expect(file.sessionId).toBe(sid);
    expect(file.name).toBe('img.png');
    expect(file.mimeType).toBe('image/png');
    expect(file.data).toBe('abc');
    expect(file.createdAt).toBeGreaterThanOrEqual(before);
  });
});

describe('getVFSFile', () => {
  it('retrieves a file by id', async () => {
    const sid = await makeSession();
    const saved = await saveVFSFile(sid, 'hello.txt', 'aA==', 'text/plain');
    const fetched = await getVFSFile(saved.id);
    expect(fetched).toEqual(saved);
  });

  it('returns undefined for unknown id', async () => {
    const result = await getVFSFile('nonexistent-uuid');
    expect(result).toBeUndefined();
  });
});

describe('listVFSFiles', () => {
  it('returns empty array when no files for session', async () => {
    const sid = await makeSession();
    const files = await listVFSFiles(sid);
    expect(files).toEqual([]);
  });

  it('returns only files for the given sessionId', async () => {
    const sid1 = await makeSession('S1');
    const sid2 = await makeSession('S2');
    await saveVFSFile(sid1, 'a.txt', 'aA==', 'text/plain');
    await saveVFSFile(sid1, 'b.txt', 'bA==', 'text/plain');
    await saveVFSFile(sid2, 'c.txt', 'cA==', 'text/plain');
    const files1 = await listVFSFiles(sid1);
    expect(files1).toHaveLength(2);
    expect(files1.map((f) => f.name).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('does not return files from a different session', async () => {
    const sid1 = await makeSession('S1');
    const sid2 = await makeSession('S2');
    await saveVFSFile(sid2, 'foreign.txt', 'xA==', 'text/plain');
    const files = await listVFSFiles(sid1);
    expect(files).toEqual([]);
  });
});

describe('deleteVFSFile', () => {
  it('removes the file — subsequent getVFSFile returns undefined', async () => {
    const sid = await makeSession();
    const file = await saveVFSFile(sid, 'del.txt', 'dA==', 'text/plain');
    await deleteVFSFile(file.id);
    expect(await getVFSFile(file.id)).toBeUndefined();
  });

  it('is idempotent for a non-existent id', async () => {
    await expect(deleteVFSFile('ghost-id')).resolves.toBeUndefined();
  });
});

describe('writeVFSFile (upsert)', () => {
  it('creates a new file when no existing file with same name', async () => {
    const sid = await makeSession();
    const file = await writeVFSFile(sid, 'new.txt', 'bA==', 'text/plain');
    expect(file.name).toBe('new.txt');
    const listed = await listVFSFiles(sid);
    expect(listed).toHaveLength(1);
  });

  it('replaces existing file with same name (upsert)', async () => {
    const sid = await makeSession();
    await writeVFSFile(sid, 'data.json', 'e30=', 'application/json');
    const updated = await writeVFSFile(sid, 'data.json', 'e30=', 'application/json');
    const listed = await listVFSFiles(sid);
    // Only one file should remain
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(updated.id);
  });

  it('new file gets a new UUID after replacement and old record is deleted', async () => {
    const sid = await makeSession();
    const first = await writeVFSFile(sid, 'f.txt', 'dA==', 'text/plain');
    const second = await writeVFSFile(sid, 'f.txt', 'eA==', 'text/plain');
    expect(second.id).not.toBe(first.id);
    // The old record must be gone from the DB — not just shadowed
    expect(await getVFSFile(first.id)).toBeUndefined();
  });

  it('does not affect a file with the same name in a different session', async () => {
    const sid1 = await makeSession('S1');
    const sid2 = await makeSession('S2');
    const f1 = await writeVFSFile(sid1, 'shared.txt', 'aA==', 'text/plain');
    await writeVFSFile(sid2, 'shared.txt', 'bA==', 'text/plain');
    // sid1's file should be untouched
    const still = await getVFSFile(f1.id);
    expect(still).toBeDefined();
    expect(still!.data).toBe('aA==');
  });
});

describe('clearVFSFiles', () => {
  it('deletes all files for the session', async () => {
    const sid = await makeSession();
    await saveVFSFile(sid, 'a.txt', 'aA==', 'text/plain');
    await saveVFSFile(sid, 'b.txt', 'bA==', 'text/plain');
    await clearVFSFiles(sid);
    expect(await listVFSFiles(sid)).toEqual([]);
  });

  it('respects excludeNames — skips files whose name is in the list', async () => {
    const sid = await makeSession();
    await saveVFSFile(sid, '__todo.json', 'dA==', 'application/json');
    await saveVFSFile(sid, 'other.txt', 'eA==', 'text/plain');
    await clearVFSFiles(sid, ['__todo.json']);
    const remaining = await listVFSFiles(sid);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe('__todo.json');
  });

  it('deletes all others when excludeNames is partial', async () => {
    const sid = await makeSession();
    await saveVFSFile(sid, 'keep.txt', 'aA==', 'text/plain');
    await saveVFSFile(sid, 'del1.txt', 'bA==', 'text/plain');
    await saveVFSFile(sid, 'del2.txt', 'cA==', 'text/plain');
    await clearVFSFiles(sid, ['keep.txt']);
    const remaining = await listVFSFiles(sid);
    expect(remaining.map((f) => f.name)).toEqual(['keep.txt']);
  });

  it('does not delete files from a different session', async () => {
    const sid1 = await makeSession('S1');
    const sid2 = await makeSession('S2');
    await saveVFSFile(sid2, 'foreign.txt', 'xA==', 'text/plain');
    await clearVFSFiles(sid1);
    expect(await listVFSFiles(sid2)).toHaveLength(1);
  });

  it('handles empty excludeNames (deletes all)', async () => {
    const sid = await makeSession();
    await saveVFSFile(sid, 'x.txt', 'xA==', 'text/plain');
    await clearVFSFiles(sid, []);
    expect(await listVFSFiles(sid)).toEqual([]);
  });
});
