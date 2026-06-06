import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createSession,
  getSession,
  getSessions,
  touchSession,
  updateSessionMetadata,
  appendToSessionSearchText,
} from '@/utils/db';
import { openDB, CONV_STORE, CONV_BY_SESSION_INDEX } from '@/utils/db/core';

afterEach(() => {
  vi.useRealTimers();
});

describe('createSession', () => {
  it('returns a numeric id', async () => {
    const id = await createSession('Test session');
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('auto-increments ids', async () => {
    const id1 = await createSession('First');
    const id2 = await createSession('Second');
    expect(id2).toBeGreaterThan(id1);
  });

  it('truncates title to 80 characters', async () => {
    const longTitle = 'a'.repeat(100);
    await createSession(longTitle);
    const sessions = await getSessions();
    expect(sessions[0].title).toHaveLength(80);
  });

  it('stores createdAt and updatedAt timestamps', async () => {
    const before = Date.now();
    await createSession('Timestamped');
    const after = Date.now();
    const sessions = await getSessions();
    expect(sessions[0].createdAt).toBeGreaterThanOrEqual(before);
    expect(sessions[0].createdAt).toBeLessThanOrEqual(after);
    expect(sessions[0].updatedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('getSessions', () => {
  it('returns empty array when no sessions exist', async () => {
    const sessions = await getSessions();
    expect(sessions).toEqual([]);
  });

  it('returns all created sessions', async () => {
    await createSession('Alpha');
    await createSession('Beta');
    const sessions = await getSessions();
    expect(sessions).toHaveLength(2);
  });

  it('sorts by updatedAt descending', async () => {
    const id1 = await createSession('Older');
    // Manually touch id1 to make it newer — but first create id2
    const id2 = await createSession('Newer');
    await touchSession(id1); // id1 now has a newer updatedAt than id2
    const sessions = await getSessions();
    expect(sessions[0].id).toBe(id1);
    expect(sessions[1].id).toBe(id2);
  });
});

describe('touchSession', () => {
  it('updates updatedAt to a newer timestamp', async () => {
    const id = await createSession('Touch me');
    const [before] = await getSessions();
    const oldUpdatedAt = before.updatedAt;

    // Advance the system clock so Date.now() returns a strictly larger value.
    // This is deterministic and doesn't depend on real wall-clock timing.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(oldUpdatedAt + 1000);
    await touchSession(id);

    const [after] = await getSessions();
    expect(after.updatedAt).toBeGreaterThan(oldUpdatedAt);
  });

  it('does not change the title', async () => {
    const id = await createSession('Keep this title');
    await touchSession(id);
    const [session] = await getSessions();
    expect(session.title).toBe('Keep this title');
  });

  it('is a no-op for non-existent sessionId', async () => {
    await expect(touchSession(99999)).resolves.toBeUndefined();
  });
});

describe('createSession metadata', () => {
  it('stores modelId, startUrl, and searchText', async () => {
    const id = await createSession('Research task', {
      modelId: 'gemini-3.1-flash-lite-preview',
      startUrl: 'https://example.com',
    });
    const session = await getSession(id);
    expect(session?.modelId).toBe('gemini-3.1-flash-lite-preview');
    expect(session?.startUrl).toBe('https://example.com');
    expect(session?.searchText).toContain('research task');
    expect(session?.searchText).toContain('https://example.com');
  });
});

describe('updateSessionMetadata', () => {
  it('patches modelId and updates updatedAt', async () => {
    const id = await createSession('Patch me');
    const [before] = await getSessions();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(before.updatedAt + 5000);
    await updateSessionMetadata(id, { modelId: 'openai:gpt-4.1' });

    const session = await getSession(id);
    expect(session?.modelId).toBe('openai:gpt-4.1');
    expect(session?.updatedAt).toBeGreaterThan(before.updatedAt);
  });
});

describe('appendToSessionSearchText', () => {
  it('appends conversation snippets to searchText', async () => {
    const id = await createSession('Initial');
    await appendToSessionSearchText(id, 'competitor pricing data');
    const session = await getSession(id);
    expect(session?.searchText).toContain('competitor pricing data');
  });

  it('does not duplicate existing snippet', async () => {
    const id = await createSession('Initial');
    await appendToSessionSearchText(id, 'same phrase');
    await appendToSessionSearchText(id, 'same phrase');
    const session = await getSession(id);
    expect(session?.searchText?.match(/same phrase/g)?.length).toBe(1);
  });
});

describe('DB v5 conversations index', () => {
  it('creates by-session index on conversations store', async () => {
    const db = await openDB();
    const tx = db.transaction(CONV_STORE, 'readonly');
    const store = tx.objectStore(CONV_STORE);
    expect(store.indexNames.contains(CONV_BY_SESSION_INDEX)).toBe(true);
  });
});
