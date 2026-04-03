import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSession, getSessions, touchSession } from '@/utils/db';

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
