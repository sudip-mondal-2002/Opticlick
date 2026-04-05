import { describe, it, expect } from 'vitest';
import {
  scrollDeltaIsSignificant,
  screenshotIsUnchanged,
  shouldPivot,
  extractSearchQuery,
  reconstructSearchUrl,
  isSemanticTarget,
  pickMostSemanticEntry,
  navigationSucceeded,
  computeScrollDelta,
  MAX_PIVOT_RETRIES,
  SCROLL_DELTA_THRESHOLD_PX,
  SCROLL_STEP_PX,
} from '@/utils/navigation-guard';
import type { ActionRecord } from '@/utils/navigation-guard';

// ─────────────────────────────────────────────────────────────────────────────
// computeScrollDelta — direction → (deltaX, deltaY)
// ─────────────────────────────────────────────────────────────────────────────

describe('computeScrollDelta', () => {
  it('direction "down" → positive deltaY, zero deltaX', () => {
    const { deltaX, deltaY } = computeScrollDelta('down');
    expect(deltaY).toBe(SCROLL_STEP_PX);
    expect(deltaX).toBe(0);
  });

  it('direction "up" → negative deltaY, zero deltaX', () => {
    const { deltaX, deltaY } = computeScrollDelta('up');
    expect(deltaY).toBe(-SCROLL_STEP_PX);
    expect(deltaX).toBe(0);
  });

  it('direction "right" → positive deltaX, zero deltaY', () => {
    const { deltaX, deltaY } = computeScrollDelta('right');
    expect(deltaX).toBe(SCROLL_STEP_PX);
    expect(deltaY).toBe(0);
  });

  it('direction "left" → negative deltaX, zero deltaY', () => {
    const { deltaX, deltaY } = computeScrollDelta('left');
    expect(deltaX).toBe(-SCROLL_STEP_PX);
    expect(deltaY).toBe(0);
  });

  it('up and down produce opposite deltaY values', () => {
    const up = computeScrollDelta('up');
    const down = computeScrollDelta('down');
    expect(down.deltaY).toBe(-up.deltaY);
    expect(down.deltaX).toBe(0);
    expect(up.deltaX).toBe(0);
  });

  it('left and right produce opposite deltaX values', () => {
    const left = computeScrollDelta('left');
    const right = computeScrollDelta('right');
    expect(right.deltaX).toBe(-left.deltaX);
    expect(right.deltaY).toBe(0);
    expect(left.deltaY).toBe(0);
  });

  it('never produces both deltaX and deltaY non-zero (axis-locked)', () => {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const { deltaX, deltaY } = computeScrollDelta(dir);
      expect(deltaX === 0 || deltaY === 0).toBe(true);
    }
  });

  it('uses SCROLL_STEP_PX magnitude for all four directions', () => {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const { deltaX, deltaY } = computeScrollDelta(dir);
      expect(Math.abs(deltaX) + Math.abs(deltaY)).toBe(SCROLL_STEP_PX);
    }
  });

  it('vertical directions produce zero deltaX', () => {
    expect(computeScrollDelta('up').deltaX).toBe(0);
    expect(computeScrollDelta('down').deltaX).toBe(0);
  });

  it('horizontal directions produce zero deltaY', () => {
    expect(computeScrollDelta('left').deltaY).toBe(0);
    expect(computeScrollDelta('right').deltaY).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scrollDeltaIsSignificant
// ─────────────────────────────────────────────────────────────────────────────

describe('scrollDeltaIsSignificant', () => {
  it('returns true when the page moved by more than the threshold', () => {
    expect(scrollDeltaIsSignificant(0, 200)).toBe(true);
  });

  it('returns true when scrolled upward past the threshold', () => {
    expect(scrollDeltaIsSignificant(500, 200)).toBe(true);
  });

  it('returns false when the delta equals zero (zero-delta scroll — no-op)', () => {
    // This is the core anti-loop check: if nothing moved, the step failed.
    expect(scrollDeltaIsSignificant(300, 300)).toBe(false);
  });

  it(`returns false when delta is below the default ${SCROLL_DELTA_THRESHOLD_PX}px threshold`, () => {
    expect(scrollDeltaIsSignificant(300, 320)).toBe(false); // only 20 px
  });

  it(`returns true when delta equals exactly the default threshold`, () => {
    expect(scrollDeltaIsSignificant(0, SCROLL_DELTA_THRESHOLD_PX)).toBe(true);
  });

  it('respects a custom threshold override', () => {
    // With a tighter 10 px threshold, 20 px should be significant.
    expect(scrollDeltaIsSignificant(300, 320, 10)).toBe(true);
    // With a looser 500 px threshold, 20 px should NOT be significant.
    expect(scrollDeltaIsSignificant(300, 320, 500)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// screenshotIsUnchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('screenshotIsUnchanged', () => {
  it('returns true for identical base-64 strings', () => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    expect(screenshotIsUnchanged(b64, b64)).toBe(true);
  });

  it('returns false when screenshots differ by even one character', () => {
    const a = 'AAAA';
    const b = 'AAAB';
    expect(screenshotIsUnchanged(a, b)).toBe(false);
  });

  it('returns false when screenshot lengths differ', () => {
    expect(screenshotIsUnchanged('AAAA', 'AAAAAAA')).toBe(false);
  });

  it('returns true for empty strings (edge case — both blank)', () => {
    expect(screenshotIsUnchanged('', '')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shouldPivot — anti-loop guard
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldPivot', () => {
  const click = (targetId: number): ActionRecord => ({ type: 'click', targetId });
  const scroll = (): ActionRecord => ({ type: 'scroll', targetId: undefined });

  it(`triggers pivot after ${MAX_PIVOT_RETRIES} identical (type, targetId) pairs`, () => {
    const history: ActionRecord[] = [click(5), click(5), click(5)];
    expect(shouldPivot(history, 'click', 5)).toBe(true);
  });

  it('does NOT trigger pivot with fewer retries than the threshold', () => {
    const history: ActionRecord[] = [click(5), click(5)]; // only 2 — threshold is 3
    expect(shouldPivot(history, 'click', 5)).toBe(false);
  });

  it('treats different targetIds as different actions', () => {
    // Clicking element 5 three times should pivot, but element 6 is only seen once.
    const history: ActionRecord[] = [click(5), click(5), click(5), click(6)];
    expect(shouldPivot(history, 'click', 6)).toBe(false);
    expect(shouldPivot(history, 'click', 5)).toBe(true);
  });

  it('handles page-level actions (targetId undefined) independently', () => {
    const history: ActionRecord[] = [scroll(), scroll(), scroll()];
    expect(shouldPivot(history, 'scroll', undefined)).toBe(true);
  });

  it('does not confuse scroll with click even when targetId matches', () => {
    // Three scroll actions (type:'scroll', targetId:undefined).
    // Asking shouldPivot for type:'click' must return false — different action type.
    const history: ActionRecord[] = [scroll(), scroll(), scroll()];
    expect(shouldPivot(history, 'click', undefined)).toBe(false); // different type
    expect(shouldPivot(history, 'click', 5)).toBe(false);          // different type AND targetId
    expect(shouldPivot(history, 'scroll', undefined)).toBe(true);  // matches exactly
  });

  it('respects a custom maxRetries override', () => {
    const history: ActionRecord[] = [click(3), click(3)]; // 2 repetitions
    expect(shouldPivot(history, 'click', 3, 2)).toBe(true);  // threshold = 2 → pivot
    expect(shouldPivot(history, 'click', 3, 3)).toBe(false); // threshold = 3 → not yet
  });

  it('returns false for an empty history', () => {
    expect(shouldPivot([], 'click', 1)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractSearchQuery
// ─────────────────────────────────────────────────────────────────────────────

describe('extractSearchQuery', () => {
  it('extracts the q param from a standard Google SERP URL', () => {
    expect(extractSearchQuery('https://www.google.com/search?q=hello+world')).toBe('hello world');
  });

  it('extracts the q param from a URL with extra parameters', () => {
    expect(
      extractSearchQuery('https://www.google.com/search?q=typescript+tips&hl=en&gl=us'),
    ).toBe('typescript tips');
  });

  it('returns null when the q param is absent', () => {
    expect(extractSearchQuery('https://www.google.com/maps')).toBeNull();
  });

  it('returns null for an unparseable URL string', () => {
    expect(extractSearchQuery('not a url at all')).toBeNull();
  });

  it('handles URL-encoded characters in the query', () => {
    expect(
      extractSearchQuery('https://www.google.com/search?q=best+AI+tools+2024'),
    ).toBe('best AI tools 2024');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reconstructSearchUrl — URL reconstruction (fallback navigation)
// ─────────────────────────────────────────────────────────────────────────────

describe('reconstructSearchUrl', () => {
  it('builds a valid Google search URL from a plain query', () => {
    expect(reconstructSearchUrl('hello world')).toBe(
      'https://www.google.com/search?q=hello%20world',
    );
  });

  it('encodes special characters in the query', () => {
    const url = reconstructSearchUrl('C++ programming & algorithms');
    expect(url).toContain('q=C%2B%2B');
    expect(url).toContain('%26');
    expect(url).toMatch(/^https:\/\/www\.google\.com\/search\?q=/);
  });

  it('produces a URL that is parseable and has the q param set correctly', () => {
    const query = 'openai gpt-4 pricing';
    const url = reconstructSearchUrl(query);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('q')).toBe(query);
  });

  it('round-trips: reconstructed URL can be re-extracted by extractSearchQuery', () => {
    const query = 'best coffee shops near me';
    const url = reconstructSearchUrl(query);
    expect(extractSearchQuery(url)).toBe(query);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isSemanticTarget — tag precision
// ─────────────────────────────────────────────────────────────────────────────

describe('isSemanticTarget', () => {
  it.each(['a', 'button', 'input', 'select', 'textarea'])(
    'returns true for semantic tag <%s>',
    (tag) => {
      expect(isSemanticTarget(tag)).toBe(true);
    },
  );

  it.each(['div', 'span', 'section', 'article', 'li', 'ul', 'p', 'h2'])(
    'returns false for generic container tag <%s>',
    (tag) => {
      expect(isSemanticTarget(tag)).toBe(false);
    },
  );

  it('is case-insensitive (handles uppercase from tagName)', () => {
    expect(isSemanticTarget('A')).toBe(true);
    expect(isSemanticTarget('BUTTON')).toBe(true);
    expect(isSemanticTarget('DIV')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// pickMostSemanticEntry — annotator tag precision
// ─────────────────────────────────────────────────────────────────────────────

describe('pickMostSemanticEntry', () => {
  it('prefers an <a> tag over a parent <div> in the same region', () => {
    // This simulates the annotator finding both a wrapper div and a nested anchor.
    // The agent MUST target the <a>, not the outer container.
    const entries = [
      { tag: 'div', id: 1, text: 'Click here' },
      { tag: 'a', id: 2, text: 'Click here' },
    ];
    expect(pickMostSemanticEntry(entries).tag).toBe('a');
  });

  it('prefers <button> over <div>', () => {
    const entries = [
      { tag: 'div', id: 10, text: 'Submit' },
      { tag: 'button', id: 11, text: 'Submit' },
    ];
    expect(pickMostSemanticEntry(entries).tag).toBe('button');
  });

  it('falls back to first entry when no semantic tag is present', () => {
    const entries = [
      { tag: 'div', id: 20, text: 'content' },
      { tag: 'span', id: 21, text: 'content' },
    ];
    expect(pickMostSemanticEntry(entries)).toEqual(entries[0]);
  });

  it('returns the only entry when the list has one element', () => {
    const entries = [{ tag: 'a', id: 5, text: 'link' }];
    expect(pickMostSemanticEntry(entries)).toEqual(entries[0]);
  });

  it('handles the first semantic tag in a mixed list regardless of position', () => {
    const entries = [
      { tag: 'div', id: 1, text: 'outer' },
      { tag: 'span', id: 2, text: 'mid' },
      { tag: 'button', id: 3, text: 'inner' },
    ];
    expect(pickMostSemanticEntry(entries).tag).toBe('button');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// navigationSucceeded — URL-change validation (Rule 1)
// ─────────────────────────────────────────────────────────────────────────────

describe('navigationSucceeded', () => {
  it('returns true when the URL changed after a click', () => {
    expect(
      navigationSucceeded('https://www.google.com/search?q=foo', 'https://example.com/result'),
    ).toBe(true);
  });

  it('returns false when the URL is identical (click had no navigation effect)', () => {
    // This is the "AI Overview" failure case: clicking a link inside the SGE box
    // did not actually navigate the page. The agent must pivot.
    const serpUrl = 'https://www.google.com/search?q=foo';
    expect(navigationSucceeded(serpUrl, serpUrl)).toBe(false);
  });

  it('returns true when only the hash fragment changed', () => {
    expect(
      navigationSucceeded('https://example.com/page', 'https://example.com/page#section'),
    ).toBe(true);
  });

  it('returns true when only the query params changed', () => {
    expect(
      navigationSucceeded(
        'https://www.google.com/search?q=foo',
        'https://www.google.com/search?q=bar',
      ),
    ).toBe(true);
  });
});
