import { describe, it, expect } from 'vitest';
import {
  createSession,
  getSession,
  appendConversationTurn,
  getSessions,
} from '@/utils/db';
import { openDB } from '@/utils/db/core';
import { backfillSessionMetadata } from '@/utils/session-backfill';

describe('backfillSessionMetadata', () => {
  it('backfills startUrl and searchText from conversation history', async () => {
    const id = await createSession('Legacy session');
    await appendConversationTurn(
      id,
      'user',
      'User task: find hotels\n\n[CONTEXT: The task started on https://hotels.example. If you are on an unrelated page, navigate back.]',
    );
    await appendConversationTurn(id, 'model', 'Searching for hotels in Tokyo');

    const sessions = await getSessions();
    const updated = await backfillSessionMetadata(sessions);
    expect(updated).toBeGreaterThanOrEqual(1);

    const session = await getSession(id);
    expect(session?.startUrl).toBe('https://hotels.example');
    expect(session?.searchText).toContain('tokyo');
    expect(session?.searchText).toContain('hotels');
  });

  it('returns 0 when no sessions need backfill', async () => {
    await createSession('Complete', {
      modelId: 'gemini-3.1-flash-lite-preview',
      startUrl: 'https://done.com',
    });
    const sessions = await getSessions();
    const updated = await backfillSessionMetadata(sessions);
    expect(updated).toBe(0);
  });

  it('returns 0 when session needs backfill but history is empty', async () => {
    await createSession('Legacy empty');
    const sessions = await getSessions();
    const updated = await backfillSessionMetadata(sessions);
    expect(updated).toBe(0);
  });

  it('skips non-user/non-model turns (e.g. tool turns)', async () => {
    const id = await createSession('Tool only');
    await appendConversationTurn(id, 'tool', 'tool output', { toolCallId: '1', toolName: 'wait' });

    const sessions = await getSessions();
    const updated = await backfillSessionMetadata(sessions);
    expect(updated).toBe(0);

    const session = await getSession(id);
    expect(session?.startUrl).toBeUndefined();
  });

  it('ignores sessions without an ID', async () => {
    const sessions = [{ title: 'No ID', createdAt: 0, updatedAt: 0 }];
    const updated = await backfillSessionMetadata(sessions as any);
    expect(updated).toBe(0);
  });

  it('handles user/model turns that do not contain a start URL context', async () => {
    const id = await createSession('No context URL');
    await appendConversationTurn(id, 'user', 'Search for hotels');

    const sessions = await getSessions();
    const updated = await backfillSessionMetadata(sessions);
    expect(updated).toBe(1);

    const session = await getSession(id);
    expect(session?.startUrl).toBeUndefined();
    expect(session?.searchText).toContain('hotels');
  });

  it('does not overwrite searchText if session already has distinct custom searchText', async () => {
    const id = await createSession('Legacy', { startUrl: '' });
    
    // Manually set searchText to a distinct value
    const db = await openDB();
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const sessionObj = await new Promise<any>((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
    });
    sessionObj.searchText = 'custom-distinct-search-text';
    sessionObj.startUrl = '';
    await new Promise<void>((resolve) => {
      const req = store.put(sessionObj);
      req.onsuccess = () => resolve();
    });

    await appendConversationTurn(id, 'user', 'Search for hotels\n\n[CONTEXT: The task started on https://hotels.example. If you are on an unrelated page, navigate back.]');

    const sessions = await getSessions();
    const updated = await backfillSessionMetadata(sessions);
    expect(updated).toBe(1);

    const session = await getSession(id);
    expect(session?.startUrl).toBe('https://hotels.example');
    expect(session?.searchText).toBe('custom-distinct-search-text');
  });
});
