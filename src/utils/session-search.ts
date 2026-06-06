import type { Session } from './types';

export type DateRangePreset = 'today' | 'week' | 'month' | 'all';
export type SessionSort = 'relevance' | 'newest' | 'oldest';

export interface SessionSearchFilters {
  createdAfter?: number;
  createdBefore?: number;
  modelId?: string;
  sort?: SessionSort;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Map a date-range preset to inclusive createdAt bounds. */
export function dateRangeToBounds(preset: DateRangePreset, now = Date.now()): Pick<SessionSearchFilters, 'createdAfter' | 'createdBefore'> {
  if (preset === 'all') return {};

  const end = now;
  if (preset === 'today') {
    return { createdAfter: startOfDay(now), createdBefore: end };
  }
  if (preset === 'week') {
    return { createdAfter: now - 7 * 24 * 60 * 60 * 1000, createdBefore: end };
  }
  return { createdAfter: now - 30 * 24 * 60 * 60 * 1000, createdBefore: end };
}

function sessionMatchesQuery(session: Session, q: string): boolean {
  const title = session.title.toLowerCase();
  const searchText = (session.searchText ?? title).toLowerCase();
  const startUrl = session.startUrl?.toLowerCase() ?? '';
  return title.includes(q) || searchText.includes(q) || startUrl.includes(q);
}

/** Relevance score for sorting when a text query is active. Higher is better. */
export function scoreSession(session: Session, q: string): number {
  const title = session.title.toLowerCase();
  if (title.startsWith(q)) return 100;
  if (title.includes(q)) return 80;
  if (session.startUrl?.toLowerCase().includes(q)) return 60;
  if ((session.searchText ?? '').includes(q)) return 40;
  return 0;
}

function sortSessions(sessions: Session[], q: string, sort: SessionSort | undefined): Session[] {
  const effectiveSort = q ? (sort ?? 'relevance') : (sort ?? 'newest');

  return [...sessions].sort((a, b) => {
    if (effectiveSort === 'relevance') {
      const diff = scoreSession(b, q) - scoreSession(a, q);
      if (diff !== 0) return diff;
      return b.updatedAt - a.updatedAt;
    }
    if (effectiveSort === 'oldest') return a.updatedAt - b.updatedAt;
    return b.updatedAt - a.updatedAt;
  });
}

/** Filter and sort sessions in memory. */
export function searchSessions(
  sessions: Session[],
  query: string,
  filters: SessionSearchFilters = {},
): Session[] {
  let results = [...sessions];

  const { createdAfter, createdBefore } = filters;
  if (createdAfter != null) {
    results = results.filter((s) => s.createdAt >= createdAfter);
  }
  if (createdBefore != null) {
    results = results.filter((s) => s.createdAt <= createdBefore);
  }
  if (filters.modelId) {
    results = results.filter((s) => s.modelId === filters.modelId);
  }

  const q = query.trim().toLowerCase();
  if (q) {
    results = results.filter((s) => sessionMatchesQuery(s, q));
  }

  return sortSessions(results, q, filters.sort);
}

/** Unique non-empty model IDs from sessions, sorted alphabetically by label if provided. */
export function uniqueSessionModelIds(sessions: Session[]): string[] {
  const ids = new Set<string>();
  for (const s of sessions) {
    if (s.modelId) ids.add(s.modelId);
  }
  return [...ids].sort();
}
