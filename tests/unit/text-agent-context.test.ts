import { describe, expect, it } from 'vitest';
import {
  inferDeterministicNavigation,
  selectRelevantElements,
  selectRelevantPageText,
} from '@/utils/text-agent-context';
import type { CoordinateEntry } from '@/utils/types';

describe('text agent context', () => {
  it('keeps URL/title and ranks task-relevant facts', () => {
    const page = 'Current URL: https://example.com\nPage title: Python\nNoise about menus. Python was first released in 1991. It was created by Guido van Rossum. Footer links.';
    const result = selectRelevantPageText(page, 'Find the Python release year and creator', 220);
    expect(result).toContain('Current URL: https://example.com');
    expect(result).toContain('1991');
    expect(result).toContain('Guido van Rossum');
    expect(result.length).toBeLessThanOrEqual(220);
  });

  it('prefers matching links and controls', () => {
    const base = { tag: 'a', href: '', inputType: undefined, rect: { x: 0, y: 0, left: 0, top: 0, width: 1, height: 1 } };
    const entries: CoordinateEntry[] = [
      { ...base, id: 1, text: 'About' },
      { ...base, id: 2, text: 'Guido van Rossum', href: '/wiki/Guido_van_Rossum' },
      { ...base, id: 3, tag: 'input', text: 'Search' },
    ];
    const result = selectRelevantElements(entries, 'Find Guido van Rossum', 2);
    expect(result.map((entry) => entry.id)).toEqual([2, 3]);
  });

  it('builds a direct Wikipedia article lookup on step one', () => {
    const url = inferDeterministicNavigation(
      'On Wikipedia, look up the Python programming language. Then find its creator.',
      'https://opticlick.example/',
      1,
    );
    expect(url).toBe('https://en.wikipedia.org/wiki/Special:Search?search=Python%20programming%20language&go=Go');
  });

  it('does not repeat deterministic navigation after step one', () => {
    expect(inferDeterministicNavigation('Search Wikipedia for Python', 'https://example.com', 2)).toBeUndefined();
  });
});
