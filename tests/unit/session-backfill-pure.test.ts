import { describe, it, expect } from 'vitest';
import type { Session } from '@/utils/types';

// Mirror backfill eligibility logic for unit testing without IndexedDB
function sessionNeedsBackfill(session: Session): boolean {
  return session.id != null && (!session.searchText || !session.startUrl);
}

describe('session backfill eligibility', () => {
  it('needs backfill when searchText missing', () => {
    expect(sessionNeedsBackfill({ id: 1, title: 't', createdAt: 0, updatedAt: 0 })).toBe(true);
  });

  it('needs backfill when startUrl missing', () => {
    expect(
      sessionNeedsBackfill({
        id: 1,
        title: 't',
        createdAt: 0,
        updatedAt: 0,
        searchText: 't',
      }),
    ).toBe(true);
  });

  it('does not need backfill when metadata complete', () => {
    expect(
      sessionNeedsBackfill({
        id: 1,
        title: 't',
        createdAt: 0,
        updatedAt: 0,
        searchText: 't',
        startUrl: 'https://example.com',
      }),
    ).toBe(false);
  });
});
