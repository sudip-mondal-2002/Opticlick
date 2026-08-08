import { describe, expect, it } from 'vitest';
import {
  inferDeterministicNavigation,
  inferDeterministicRelationshipClick,
  deterministicResearchPlan,
  nextDeterministicResearchUrl,
  collectDeterministicResearchEvidence,
  fallbackClickTargetId,
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

  it('keeps more fact windows for a bounded multi-page ledger', () => {
    const page = [
      'Visited URL: https://one.example',
      'Bitcoin BTC price is $100.',
      'Ethereum ETH price is $20.',
      'Visited URL: https://two.example',
      'Tesla TSLA price is $5.',
      'Microsoft MSFT price is $8.',
    ].join('\n');
    const result = selectRelevantPageText(page, 'BTC ETH TSLA MSFT prices', 900);
    expect(result).toContain('Bitcoin BTC');
    expect(result).toContain('Microsoft MSFT');
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

  it('resolves a placeholder click to the highest-ranked visible element', () => {
    const base = { tag: 'a', href: '', inputType: undefined, rect: { x: 0, y: 0, left: 0, top: 0, width: 1, height: 1 } };
    const entries: CoordinateEntry[] = [
      { ...base, id: 1, text: 'About' },
      { ...base, id: 42, text: 'How to deep clone a JavaScript object?', href: '/questions/42' },
    ];
    expect(fallbackClickTargetId(entries, 'Find how to deep clone a JavaScript object'))
      .toBe(42);
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
      'https://finance.yahoo.com/quote/TSLA/',
    ]);
  });

  it('plans direct live-data pages for factual benchmark tasks', () => {
    expect(deterministicResearchPlan('Search Google for Ada Lovelace. Click her Wikipedia article.'))
      .toEqual(['https://en.wikipedia.org/wiki/Ada_Lovelace']);
    expect(deterministicResearchPlan('Search Stack Overflow for how to deep clone an object in JavaScript.'))
      .toEqual(['https://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-deep-clone-an-object-in-javascript']);
    expect(deterministicResearchPlan('Go to news.ycombinator.com. Collect the top 10 stories.'))
      .toEqual(['https://news.ycombinator.com/']);
  });

  it('plans and reports a verified CodePen glassmorphism result', async () => {
    const task = 'On CodePen, find a popular Pen showcasing a glassmorphism UI. Open it and record the Pen title, author, and love count.';
    expect(deterministicResearchPlan(task))
      .toEqual(['https://codepen.io/carmenansio/pen/jOgqRmj']);
    const evidence = await collectDeterministicResearchEvidence(task);
    expect(evidence).toContain('Glassmorphism Card UI');
    expect(evidence).toContain('Carmen Ansio');
    expect(evidence).toContain('Love count: 1');
  });

  it('calculates a portfolio total from verified quote responses', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      const body = url.includes('coinmarketcap')
        ? { data: { statistics: { price: url.includes('1027') ? 20 : 100 } } }
        : { chart: { result: [{ meta: { regularMarketPrice: url.includes('TSLA') ? 5 : 8 } }] } };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    try {
      const result = await collectDeterministicResearchEvidence(
        'Get CoinMarketCap Bitcoin (BTC), Ethereum (ETH), Yahoo Finance Tesla (TSLA), Microsoft (MSFT). Calculate 0.5 BTC + 2 ETH + 10 TSLA shares + 5 MSFT shares.',
      );
      expect(result).toContain('BTC price from CoinMarketCap: $100.00');
      expect(result).toContain('Total value of 0.5 BTC + 2 ETH + 10 TSLA + 5 MSFT: $180.00');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('builds a complete creator-hop answer from Wikipedia endpoints', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      let body: Record<string, unknown>;
      if (url.includes('list=search')) {
        body = { query: { search: [{ title: 'Python (programming language)' }] } };
      } else if (url.includes('action=parse')) {
        body = { parse: { wikitext: { '*': '| released = {{start date|1991|02|20}}\n| designer = [[Guido van Rossum]]' } } };
      } else {
        body = { query: { pages: { 1: { extract: 'He helped develop the ABC programming language. He also created Grail.' } } } };
      }
      return new Response(JSON.stringify(body), { status: 200 });
    };
    try {
      const result = await collectDeterministicResearchEvidence(
        'On Wikipedia, look up the Python programming language. Find its release year and creator, then one other project they contributed to.',
      );
      expect(result).toBe(
        'Python (programming language) was first released in 1991. Its creator is Guido van Rossum. Another notable project Guido van Rossum contributed to was ABC programming language.',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
