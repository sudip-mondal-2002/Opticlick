import { describe, expect, it } from 'vitest';
import {
  inferDeterministicNavigation,
  inferDeterministicRelationshipClick,
  deterministicResearchPlan,
  nextDeterministicResearchUrl,
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

  it('navigates directly to a bare task URL', () => {
    expect(inferDeterministicNavigation(
      'Go to github.com/vercel/next.js. Tell me the star count.',
      'https://example.com',
      1,
    )).toBe('https://github.com/vercel/next.js');
  });

  it('routes named finance sites without a model call', () => {
    expect(inferDeterministicNavigation(
      'Get current prices from CoinMarketCap: Bitcoin and Ethereum.',
      'https://example.com',
      1,
    )).toBe('https://coinmarketcap.com/');
  });

  it('follows a requested creator relationship from page evidence', () => {
    const base = { tag: 'a', inputType: undefined, rect: { x: 0, y: 0, left: 0, top: 0, width: 1, height: 1 } };
    const entries: CoordinateEntry[] = [
      { ...base, id: 8, text: 'History', href: '#History' },
      { ...base, id: 9, text: 'Guido van Rossum', href: '/wiki/Guido_van_Rossum' },
    ];
    expect(inferDeterministicRelationshipClick(
      'Find the creator, then visit their page and name another project.',
      'Python was designed by Guido van Rossum and first released in 1991.',
      entries,
      2,
    )).toBe(9);
  });

  it('plans GitHub factual research on stable pages', () => {
    const task = 'Go to github.com/vercel/next.js. Tell me stars, forks, open issues, and most recent merged pull request.';
    expect(deterministicResearchPlan(task)).toEqual([
      'https://github.com/vercel/next.js',
      'https://github.com/vercel/next.js/issues',
      'https://github.com/vercel/next.js/pulls?q=is%3Apr+is%3Amerged+sort%3Aupdated-desc',
    ]);
    expect(nextDeterministicResearchUrl(task, [
      'https://github.com/vercel/next.js/',
      'https://github.com/vercel/next.js/issues',
    ]).next).toContain('/pulls?');
  });

  it('plans exact crypto and stock quote pages', () => {
    const task = 'Get from CoinMarketCap Bitcoin (BTC), Ethereum (ETH), and Yahoo Finance Tesla (TSLA), Microsoft (MSFT).';
    expect(deterministicResearchPlan(task)).toEqual([
      'https://coinmarketcap.com/currencies/bitcoin/',
      'https://coinmarketcap.com/currencies/ethereum/',
      'https://finance.yahoo.com/quote/TSLA/',
      'https://finance.yahoo.com/quote/MSFT/',
    ]);
  });
});
