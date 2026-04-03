import { describe, it, expect } from 'vitest';
import { createSession, saveVFSFile } from '@/utils/db';
import { loadTodoFromVFS, saveTodoToVFS } from '@/utils/todo';
import type { TodoItem } from '@/utils/types';

const SAMPLE_ITEMS: TodoItem[] = [
  { id: 'step-1', title: 'Navigate to login', status: 'pending' },
  { id: 'step-2', title: 'Enter credentials', status: 'in_progress', notes: 'use test account' },
  { id: 'step-3', title: 'Submit form', status: 'done' },
];

describe('saveTodoToVFS + loadTodoFromVFS', () => {
  it('round-trips: save then load returns identical items', async () => {
    const sid = await createSession('RT');
    await saveTodoToVFS(sid, SAMPLE_ITEMS);
    const loaded = await loadTodoFromVFS(sid);
    expect(loaded).toEqual(SAMPLE_ITEMS);
  });

  it('loadTodoFromVFS returns null when no todo file exists', async () => {
    const sid = await createSession('Empty');
    const result = await loadTodoFromVFS(sid);
    expect(result).toBeNull();
  });

  it('loadTodoFromVFS returns null when the stored file has invalid JSON', async () => {
    const sid = await createSession('Bad JSON');
    // Write a file with invalid JSON, base64-encoded
    const invalidBase64 = btoa('not valid json {{{');
    await saveVFSFile(sid, '__todo.json', invalidBase64, 'application/json');
    const result = await loadTodoFromVFS(sid);
    expect(result).toBeNull();
  });

  it('second saveTodoToVFS overwrites the first (upsert)', async () => {
    const sid = await createSession('Overwrite');
    await saveTodoToVFS(sid, SAMPLE_ITEMS);
    const updated: TodoItem[] = [{ id: 'step-1', title: 'Updated', status: 'done' }];
    await saveTodoToVFS(sid, updated);
    const loaded = await loadTodoFromVFS(sid);
    expect(loaded).toEqual(updated);
  });

  it('Unicode titles survive the base64 round-trip', async () => {
    const sid = await createSession('Unicode');
    const unicodeItems: TodoItem[] = [
      { id: 'u1', title: 'Cliquez sur le bouton ✓ 日本語', status: 'pending' },
    ];
    await saveTodoToVFS(sid, unicodeItems);
    const loaded = await loadTodoFromVFS(sid);
    expect(loaded![0].title).toBe('Cliquez sur le bouton ✓ 日本語');
  });

  it('preserves all status values through serialization', async () => {
    const sid = await createSession('Statuses');
    const items: TodoItem[] = [
      { id: 'a', title: 'A', status: 'pending' },
      { id: 'b', title: 'B', status: 'in_progress' },
      { id: 'c', title: 'C', status: 'done' },
      { id: 'd', title: 'D', status: 'skipped' },
    ];
    await saveTodoToVFS(sid, items);
    const loaded = await loadTodoFromVFS(sid);
    expect(loaded!.map((i) => i.status)).toEqual(['pending', 'in_progress', 'done', 'skipped']);
  });
});
