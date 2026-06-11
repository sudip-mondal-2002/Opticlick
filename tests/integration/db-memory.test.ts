import { describe, it, expect } from 'vitest';
import { upsertMemory, getAllMemories, deleteMemory } from '@/utils/db/memory';

describe('IndexedDB Memory CRUD', () => {
  it('inserts a new memory entry successfully', async () => {
    const entry = await upsertMemory('github/username', ['sudip-mondal-2002'], 'account', 'https://github.com');
    expect(entry.key).toBe('github/username');
    expect(entry.values).toEqual(['sudip-mondal-2002']);
    expect(entry.category).toBe('account');
    expect(entry.sourceUrl).toBe('https://github.com');
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.updatedAt).toBeGreaterThan(0);
  });

  it('merges and deduplicates values for an existing key', async () => {
    await upsertMemory('user/interests', ['coding'], 'preference');
    const updated = await upsertMemory('user/interests', ['coding', 'music', 'reading'], 'preference', 'https://example.com');

    expect(updated.key).toBe('user/interests');
    expect(updated.values).toEqual(['coding', 'music', 'reading']);
    expect(updated.sourceUrl).toBe('https://example.com');
  });

  it('returns all memories sorted by updatedAt descending', async () => {
    let now = 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

    await upsertMemory('key1', ['val1']);
    now = 2000;
    await upsertMemory('key2', ['val2']);

    const all = await getAllMemories();
    nowSpy.mockRestore();

    expect(all.length).toBeGreaterThanOrEqual(2);
    const index1 = all.findIndex(e => e.key === 'key1');
    const index2 = all.findIndex(e => e.key === 'key2');
    expect(index2).toBeLessThan(index1); // key2 created second, should be first in list
  });

  it('deletes a memory entry successfully', async () => {
    await upsertMemory('key-to-delete', ['value']);
    let all = await getAllMemories();
    expect(all.some(e => e.key === 'key-to-delete')).toBe(true);

    await deleteMemory('key-to-delete');
    all = await getAllMemories();
    expect(all.some(e => e.key === 'key-to-delete')).toBe(false);
  });
});
