import { describe, it, expect } from 'vitest';
import type { Session } from '@/utils/types';
import {
  searchSessions,
  dateRangeToBounds,
  scoreSession,
  uniqueSessionModelIds,
} from '@/utils/session-search';

function makeSession(overrides: Partial<Session> & Pick<Session, 'title'>): Session {
  return {
    id: 1,
    createdAt: 1_000_000,
    updatedAt: 2_000_000,
    ...overrides,
  };
}

describe('searchSessions', () => {
  const sessions: Session[] = [
    makeSession({
      id: 1,
      title: 'Competitor analysis for Notion',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_100_000_000,
      modelId: 'gemini-3.1-flash-lite-preview',
      startUrl: 'https://notion.so',
      searchText: 'competitor analysis for notion https://notion.so pricing features',
    }),
    makeSession({
      id: 2,
      title: 'Book hotel in Tokyo',
      createdAt: 1_600_000_000_000,
      updatedAt: 1_600_500_000_000,
      modelId: 'openai:gpt-4.1',
      startUrl: 'https://booking.com',
      searchText: 'book hotel in tokyo booking.com',
    }),
    makeSession({
      id: 3,
      title: 'Weekly report',
      createdAt: 1_500_000_000_000,
      updatedAt: 1_500_100_000_000,
      modelId: 'gemini-3.1-flash-lite-preview',
    }),
  ];

  it('returns all sessions when query is empty', () => {
    expect(searchSessions(sessions, '')).toHaveLength(3);
  });

  it('filters by title (case-insensitive)', () => {
    const results = searchSessions(sessions, 'tokyo');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Book hotel in Tokyo');
  });

  it('filters by searchText / conversation content', () => {
    const results = searchSessions(sessions, 'pricing features');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  it('filters by startUrl', () => {
    const results = searchSessions(sessions, 'booking.com');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(2);
  });

  it('filters by modelId', () => {
    const results = searchSessions(sessions, '', { modelId: 'openai:gpt-4.1' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(2);
  });

  it('filters by createdAfter', () => {
    const results = searchSessions(sessions, '', { createdAfter: 1_550_000_000_000 });
    expect(results.map((s) => s.id)).toEqual([1, 2]);
  });

  it('filters by createdBefore', () => {
    const results = searchSessions(sessions, '', { createdBefore: 1_650_000_000_000 });
    expect(results.map((s) => s.id)).toEqual([2, 3]);
  });

  it('sorts by relevance when query is set', () => {
    const mixed: Session[] = [
      makeSession({ id: 10, title: 'Notion notes', updatedAt: 100, searchText: 'competitor' }),
      makeSession({ id: 11, title: 'Competitor deep dive', updatedAt: 50 }),
      makeSession({ id: 12, title: 'Other', updatedAt: 200, searchText: 'competitor analysis' }),
    ];
    const results = searchSessions(mixed, 'competitor', { sort: 'relevance' });
    expect(results[0].title).toBe('Competitor deep dive');
  });

  it('sorts by oldest', () => {
    const results = searchSessions(sessions, '', { sort: 'oldest' });
    expect(results.map((s) => s.id)).toEqual([3, 2, 1]);
  });

  it('sorts by newest by default', () => {
    const results = searchSessions(sessions, '');
    expect(results.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it('handles large session lists', () => {
    const large: Session[] = Array.from({ length: 500 }, (_, i) =>
      makeSession({
        id: i,
        title: i % 2 === 0 ? `Task even ${i}` : `Task odd ${i}`,
        updatedAt: i,
        createdAt: i,
      }),
    );
    const results = searchSessions(large, 'even 42');
    expect(results.some((s) => s.title === 'Task even 42')).toBe(true);
    expect(results.length).toBeLessThan(500);
  });
});

describe('scoreSession', () => {
  it('ranks title prefix matches highest', () => {
    const s = makeSession({ title: 'Competitor report', searchText: 'competitor' });
    expect(scoreSession(s, 'competitor')).toBe(100);
  });

  it('ranks title contains above searchText', () => {
    const titleMatch = makeSession({ title: 'My competitor list' });
    const textMatch = makeSession({ title: 'Research', searchText: 'competitor' });
    expect(scoreSession(titleMatch, 'competitor')).toBeGreaterThan(scoreSession(textMatch, 'competitor'));
  });

  it('returns 60 when query matches only the startUrl', () => {
    // title does not contain the query, startUrl does — covers the `return 60` branch.
    const s = makeSession({ title: 'My task', startUrl: 'https://notion.so/workspace' });
    expect(scoreSession(s, 'notion.so')).toBe(60);
  });

  it('returns 40 when query matches only the searchText', () => {
    // title and startUrl don't match, but searchText does — covers the `return 40` branch.
    const s = makeSession({ title: 'My task', searchText: 'pricing plans comparison' });
    expect(scoreSession(s, 'pricing')).toBe(40);
  });

  it('handles nullish startUrl and searchText gracefully', () => {
    // Neither startUrl nor searchText set — optional chaining and nullish coalescing should not throw.
    const s = makeSession({ title: 'Some title' });
    expect(scoreSession(s, 'notion')).toBe(0);
  });

  it('returns 0 for no match at all', () => {
    const s = makeSession({ title: 'Some title', searchText: 'some text', startUrl: 'https://url.com' });
    expect(scoreSession(s, 'completely-unrelated')).toBe(0);
  });
});

describe('dateRangeToBounds', () => {
  const now = new Date('2026-04-10T15:00:00Z').getTime();

  it('returns empty bounds for all time', () => {
    expect(dateRangeToBounds('all', now)).toEqual({});
  });

  it('returns today bounds', () => {
    const bounds = dateRangeToBounds('today', now);
    expect(bounds.createdAfter).toBeLessThanOrEqual(now);
    expect(bounds.createdBefore).toBe(now);
  });

  it('returns week bounds', () => {
    const bounds = dateRangeToBounds('week', now);
    expect(bounds.createdAfter).toBe(now - 7 * 24 * 60 * 60 * 1000);
  });

  it('returns month bounds', () => {
    const bounds = dateRangeToBounds('month', now);
    expect(bounds.createdAfter).toBe(now - 30 * 24 * 60 * 60 * 1000);
  });
});

describe('uniqueSessionModelIds', () => {
  it('returns sorted unique model ids', () => {
    const sessions: Session[] = [
      makeSession({ title: 'a', modelId: 'openai:gpt-4.1' }),
      makeSession({ title: 'b', modelId: 'gemini-3.1-flash-lite-preview' }),
      makeSession({ title: 'c', modelId: 'openai:gpt-4.1' }),
      makeSession({ title: 'd' }),
    ];
    expect(uniqueSessionModelIds(sessions)).toEqual([
      'gemini-3.1-flash-lite-preview',
      'openai:gpt-4.1',
    ]);
  });
});
