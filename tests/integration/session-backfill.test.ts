import { describe, it, expect } from 'vitest';
import {
  createSession,
  getSession,
  appendConversationTurn,
  getSessions,
} from '@/utils/db';
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
});
