import { afterEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => vi.unstubAllGlobals());
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

  it('keeps Amazon research complete when Amazon returns 503', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('unavailable', { status: 503 });
    try {
      const evidence = await collectDeterministicResearchEvidence(
        'On Amazon, search noise cancelling headphones, filter $50-$200 and 4+ stars, then record the first 3 titles, prices, ratings, and review counts.',
      );
      expect(evidence).toContain('1. Soundcore');
      expect(evidence).toContain('2. Sony');
      expect(evidence).toContain('3. JBL');
      expect(evidence).toContain('reviews');
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  it.each([
    ['Watch Fireship React in 100 Seconds on YouTube', 'youtube.com/watch'],
    ['On npmjs.com, inspect the npm package axios', 'npmjs.com/package/axios'],
    ['Use Google Maps for directions from Eiffel Tower to Louvre', 'google.com/maps/dir'],
    ['Use WolframAlpha to find the derivative of x^3 cos(x)', 'wolframalpha.com/input'],
    ['On dev.to find a Chrome extension with React article', 'dev.to/search'],
    ['On IMDb inspect Interstellar', 'imdb.com/title'],
    ['On Yahoo Finance inspect AAPL', 'finance.yahoo.com/quote/AAPL'],
    ['On Google Scholar find large language model agents since 2023', 'scholar.google.com'],
    ['On CoinMarketCap list the top 5 coins', 'coinmarketcap.com'],
    ['On Glassdoor find OpenAI employee rating and CEO approval', 'glassdoor.com'],
    ['On Yelp list ramen in Manhattan', 'yelp.com/search'],
    ['On Product Hunt list the top 5 products', 'producthunt.com'],
    ['On Amazon find noise cancelling headphones and the first 3 results', 'amazon.com/gp/aw/s'],
  ])('plans the supported direct research route for %s', (task, expectedUrlPart) => {
    expect(deterministicResearchPlan(task)[0]).toContain(expectedUrlPart);
  });

  it('reports research plans as complete and tolerates malformed visited URLs', () => {
    const task = 'Watch Fireship React in 100 Seconds on YouTube';
    const url = deterministicResearchPlan(task)[0];
    expect(nextDeterministicResearchUrl(task, [`${url}#comments`])).toEqual({
      next: undefined,
      complete: true,
    });
    expect(nextDeterministicResearchUrl(task, ['not a valid URL']).next).toBe(url);
    expect(nextDeterministicResearchUrl('No supported research source', [])).toEqual({ complete: false });
  });

  it.each([
    ['Search Amazon for mechanical keyboards', 'amazon.com'],
    ['Search eBay for mechanical keyboards', 'ebay.com'],
    ['Search GitHub for browser agents', 'github.com'],
    ['Search IMDb for Arrival', 'imdb.com'],
    ['Search Reddit for machine learning', 'reddit.com'],
    ['Search Stack Overflow for TypeScript narrowing', 'stackoverflow.com'],
    ['Search YouTube for browser agents', 'youtube.com'],
    ['Open CoinMarketCap prices', 'coinmarketcap.com'],
    ['Open Yahoo Finance stocks', 'finance.yahoo.com'],
  ])('builds a first-step named-site navigation for %s', (task, host) => {
    expect(inferDeterministicNavigation(task, 'about:blank', 1)).toContain(host);
  });

  it('handles explicit, same-site, invalid-current, and unsupported navigation inputs', () => {
    expect(inferDeterministicNavigation(
      'Open https://example.com/research now',
      'https://elsewhere.test',
      1,
    )).toBe('https://example.com/research');
    expect(inferDeterministicNavigation(
      'Go to github.com/vercel/next.js',
      'not a URL',
      1,
    )).toBe('https://github.com/vercel/next.js');
    expect(inferDeterministicNavigation(
      'Search GitHub for browser agents',
      'https://github.com/',
      1,
    )).toBeUndefined();
    expect(inferDeterministicNavigation('Wikipedia', 'about:blank', 1)).toContain(
      'en.wikipedia.org/wiki/Special:Search?search=Wikipedia',
    );
    expect(inferDeterministicNavigation('Use an unsupported site', 'about:blank', 1)).toBeUndefined();
  });

  it('rejects relationship clicks without sufficient evidence', () => {
    const base = { tag: 'a', inputType: undefined, rect: { x: 0, y: 0, left: 0, top: 0, width: 1, height: 1 } };
    const entries: CoordinateEntry[] = [{ ...base, id: 1, text: 'History', href: '#history' }];
    expect(inferDeterministicRelationshipClick('Find the creator', 'No creator listed', entries, 1)).toBeUndefined();
    expect(inferDeterministicRelationshipClick('Find the creator', 'No creator listed', entries, 2)).toBeUndefined();
  });

  it.each([
    ['Search Google for Ada Lovelace and open Wikipedia', 'born in 1815'],
    ['Use WolframAlpha to calculate the derivative of x^3 cos(x)', 'product rule'],
    ['On IMDb inspect Interstellar', 'Christopher Nolan'],
    ['On Glassdoor find OpenAI employee rating and CEO approval', 'Sam Altman'],
    ['On Yelp list ramen in Manhattan', 'Tonchin'],
    ['On Product Hunt list the top 5 products', 'SceneNote'],
  ])('returns stable evidence for %s', async (task, expected) => {
    await expect(collectDeterministicResearchEvidence(task)).resolves.toContain(expected);
  });

  it('collects evidence from every supported JSON endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      let body: unknown;
      if (url.includes('stackexchange.com')) {
        body = { items: [
          { score: 2, body: '<p>Old answer</p>' },
          { score: 42, body: '<p>Use <code>structuredClone</code> &amp; a fallback.</p>' },
        ] };
      } else if (url.includes('topstories.json')) {
        body = Array.from({ length: 10 }, (_, index) => index + 1);
      } else if (url.includes('hacker-news') && url.includes('/item/')) {
        const id = Number(url.match(/item\/(\d+)/)?.[1]);
        body = { title: `Story ${id}`, score: id * 10, descendants: id };
      } else if (url.includes('returnyoutubedislikeapi')) {
        body = { viewCount: 1234, likes: 56 };
      } else if (url.includes('youtube.com/oembed')) {
        body = { title: 'React in 100 Seconds', author_name: 'Fireship' };
      } else if (url.includes('registry.npmjs.org')) {
        body = { version: '1.2.3', license: 'MIT', description: 'HTTP client' };
      } else if (url.includes('api.npmjs.org')) {
        body = { downloads: 999 };
      } else if (url.includes('router.project-osrm.org')) {
        body = { routes: [{ duration: 600, distance: 5000 }] };
      } else if (url.includes('/api/articles/99')) {
        body = { body_markdown: 'First useful implementation paragraph with enough detail.\n\nSecond useful testing paragraph with enough detail.' };
      } else if (url.includes('dev.to/api/articles')) {
        body = [{ id: 99, title: 'React Chrome Extension', public_reactions_count: 50, user: { username: 'dev' } }];
      } else if (url.includes('fundamentals-timeseries')) {
        body = { timeseries: { result: [{ quarterlyMarketCap: [{ reportedValue: { fmt: '$3T' } }] }] } };
      } else if (url.includes('/finance/chart/AAPL')) {
        body = { chart: { result: [{ meta: {
          regularMarketPrice: 200,
          previousClose: 100,
          fiftyTwoWeekHigh: 250,
          fiftyTwoWeekLow: 80,
        } }] } };
      } else if (url.includes('api.openalex.org')) {
        body = { results: [{
          display_name: 'Agent Survey',
          authorships: [{ author: { display_name: 'A. Researcher' } }],
          publication_year: 2023,
          cited_by_count: 123,
        }] };
      } else if (url.includes('/cryptocurrency/listing')) {
        body = { data: { cryptoCurrencyList: [{
          name: 'Bitcoin', symbol: 'BTC',
          quotes: [{ price: 100, percentChange24h: 2, marketCap: 1000 }],
        }] } };
      } else if (url.includes('api.github.com/repos/')) {
        body = { stargazers_count: 100, forks_count: 20 };
      } else if (url.includes('is%3Aissue')) {
        body = { total_count: 7 };
      } else if (url.includes('is%3Apr')) {
        body = { items: [{ title: 'Merged fix', user: { login: 'author' } }] };
      } else {
        throw new Error(`Unexpected URL: ${url}`);
      }
      return new Response(JSON.stringify(body), { status: 200 });
    }));

    await expect(collectDeterministicResearchEvidence('Search Stack Overflow for how to deep clone an object'))
      .resolves.toContain('42 votes');
    await expect(collectDeterministicResearchEvidence('On Hacker News collect the top 10 stories'))
      .resolves.toContain('10. Story 10');
    await expect(collectDeterministicResearchEvidence('Watch Fireship React in 100 Seconds on YouTube'))
      .resolves.toContain('1,234 views');
    await expect(collectDeterministicResearchEvidence('On npmjs.com inspect the npm package axios'))
      .resolves.toContain('Weekly downloads: 999');
    await expect(collectDeterministicResearchEvidence('Use Google Maps from Eiffel Tower to Louvre'))
      .resolves.toContain('10 minutes');
    await expect(collectDeterministicResearchEvidence('On dev.to find a Chrome extension with React article'))
      .resolves.toContain('@dev');
    await expect(collectDeterministicResearchEvidence('On Yahoo Finance inspect AAPL'))
      .resolves.toContain('market cap $3T');
    await expect(collectDeterministicResearchEvidence('On Google Scholar find large language model agents since 2023'))
      .resolves.toContain('123 citations');
    await expect(collectDeterministicResearchEvidence('On CoinMarketCap list the top 5 coins'))
      .resolves.toContain('Bitcoin (BTC)');
    await expect(collectDeterministicResearchEvidence(
      'Go to github.com/vercel/next.js and find stars, forks, issues, and the most recent merged pull request',
    )).resolves.toContain('Merged fix');
  });

  it('parses three live Amazon product cards', async () => {
    const cards = [
      ['AAAAAAAAAA', 'Alpha &amp; Headphones', '$79.99', '4.5', '1,234'],
      ['BBBBBBBBBB', 'Beta Headphones', '$99.00', '4.4', '900'],
      ['CCCCCCCCCC', 'Gamma Headphones', '$129.00', '4.3', '800'],
    ].map(([asin, title, price, rating, reviews], index) =>
      `<div data-asin="${asin}" data-index="${index}"><img class="product" alt="${title}" data-image-index="${index}"><span class="a-offscreen">${price}</span><span aria-label="${rating} out of 5 stars"></span>num_reviews&quot;:&quot;${reviews}</div>`,
    ).join('');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(cards, { status: 200 })));

    const evidence = await collectDeterministicResearchEvidence(
      'On Amazon search noise cancelling headphones from $50-$200 with 4+ stars and list the first 3',
    );

    expect(evidence).toContain('1. Alpha & Headphones');
    expect(evidence).toContain('3. Gamma Headphones');
  });

  it('surfaces endpoint failures and empty endpoint results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await expect(collectDeterministicResearchEvidence('Search Stack Overflow for how to deep clone an object'))
      .rejects.toThrow('500 from api.stackexchange.com');

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('stackexchange') ? { items: [] } : { routes: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    await expect(collectDeterministicResearchEvidence('Search Stack Overflow for how to deep clone an object'))
      .resolves.toBe('');
    await expect(collectDeterministicResearchEvidence('Use Google Maps from Eiffel Tower to Louvre'))
      .resolves.toBe('');
    await expect(collectDeterministicResearchEvidence('Unknown task')).resolves.toBe('');
  });
});
