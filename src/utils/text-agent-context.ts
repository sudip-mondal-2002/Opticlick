import type { CoordinateEntry } from './types';

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'and', 'are', 'can', 'created', 'find', 'for', 'from',
  'into', 'look', 'navigate', 'one', 'other', 'page', 'project', 'search', 'site',
  'that', 'the', 'their', 'then', 'they', 'this', 'using', 'was', 'what', 'when',
  'where', 'which', 'who', 'with', 'year', 'you',
]);

export function taskTerms(task: string): string[] {
  return [...new Set(
    task.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g)
      ?.filter((word) => !STOP_WORDS.has(word)) ?? [],
  )].slice(0, 18);
}

function scoreText(text: string, terms: string[]): number {
  const value = text.toLowerCase();
  return terms.reduce((score, term) => score + (value.includes(term) ? 1 : 0), 0);
}

/** Keep URL/title plus only task-relevant sentence windows. */
export function selectRelevantPageText(pageText: string, task: string, maxChars = 300): string {
  if (!pageText) return '';
  const url = pageText.match(/^Current URL:.*$/m)?.[0] ?? '';
  const title = pageText.match(/^Page title:.*$/m)?.[0] ?? '';
  const body = pageText
    .replace(/^Current URL:.*$/m, '')
    .replace(/^Page title:.*$/m, '')
    .trim();
  const terms = taskTerms(task);
  const sentences = body.split(/(?<=[.!?])\s+|\s{2,}/).filter(Boolean);
  const ranked = sentences
    .map((text, index) => ({ text, index, score: scoreText(text, terms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: Array<{ text: string; index: number }> = [];
  let used = url.length + title.length + 2;
  const sentenceLimit = maxChars > 500 ? 12 : 6;
  for (const candidate of ranked) {
    if (selected.length >= sentenceLimit) break;
    const remaining = maxChars - used;
    if (remaining <= 40) break;
    selected.push({ text: candidate.text.slice(0, remaining), index: candidate.index });
    used += Math.min(candidate.text.length, remaining) + 1;
  }
  const evidence = selected.sort((a, b) => a.index - b.index).map((item) => item.text).join(' ');
  return [url, title, evidence].filter(Boolean).join('\n').slice(0, maxChars);
}

/** Prefer task-matching links and actual controls over generic navigation chrome. */
export function selectRelevantElements(
  coordinateMap: CoordinateEntry[],
  task: string,
  limit = 4,
): CoordinateEntry[] {
  const terms = taskTerms(task);
  return coordinateMap
    .map((entry, index) => {
      const semanticBonus = /^(input|button|select|textarea)$/i.test(entry.tag) ? 2 : 0;
      const matchScore = scoreText(`${entry.text} ${entry.href ?? ''}`, terms) * 4;
      return { entry, index, score: semanticBonus + matchScore };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map(({ entry }) => entry);
}

/**
 * Follow an explicitly requested relationship hop without asking the model.
 * The page must itself describe the linked entity as the creator/author/etc.;
 * this avoids guessing from a generic list of links.
 */
export function inferDeterministicRelationshipClick(
  task: string,
  pageText: string,
  coordinateMap: CoordinateEntry[],
  step: number,
): number | undefined {
  if (step < 2 || !/\b(?:creator|author|director|founder|inventor|designer)\b/i.test(task)) return undefined;
  if (!/\b(?:then|their|another|other|project|work|contribut|page)\b/i.test(task)) return undefined;

  const normalizedPage = pageText.replace(/\s+/g, ' ');
  for (const entry of coordinateMap) {
    const name = entry.text.trim().replace(/\s+/g, ' ');
    if (!entry.href || name.length < 5 || name.length > 70 || !/^[A-Z]/.test(name)) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const relationship = new RegExp(
      `(?:created|designed|written|directed|founded|invented|developed|authored)(?:\\s+\\w+){0,3}\\s+by(?:\\s+\\w+){0,3}\\s+${escaped}\\b`,
      'i',
    );
    const labelled = new RegExp(`(?:creator|author|director|founder|inventor|designer)\\s*:?\\s*${escaped}\\b`, 'i');
    if (relationship.test(normalizedPage) || labelled.test(normalizedPage)) return entry.id;
  }
  return undefined;
}

function normalizeResearchUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return `${url.origin}${url.pathname}`.replace(/\/$/, '');
  } catch { return value.replace(/[?#].*$/, '').replace(/\/$/, ''); }
}

/** Build stable detail-page routes for factual multi-page research tasks. */
export function deterministicResearchPlan(task: string): string[] {
  const githubRepo = task.match(/\bgithub\.com\/([\w.-]+\/[\w.-]+)/i)?.[1];
  if (githubRepo && /\bstar|fork/i.test(task) && /\bissues?\b/i.test(task) && /\bmerged\b/i.test(task)) {
    const base = `https://github.com/${githubRepo.replace(/[.!?]+$/, '')}`;
    return [
      base,
      `${base}/issues`,
      `${base}/pulls?q=is%3Apr+is%3Amerged+sort%3Aupdated-desc`,
    ];
  }

  if (/\bcoinmarketcap\b/i.test(task) && /\byahoo finance\b/i.test(task)) {
    const cryptoSlugs: Record<string, string> = { BTC: 'bitcoin', ETH: 'ethereum' };
    const symbols = [...task.matchAll(/\(([A-Z]{2,6})\)/g)].map((match) => match[1]);
    const crypto = symbols
      .filter((symbol) => cryptoSlugs[symbol])
      .map((symbol) => `https://coinmarketcap.com/currencies/${cryptoSlugs[symbol]}/`);
    const equities = symbols
      .filter((symbol) => !cryptoSlugs[symbol])
      .map((symbol) => `https://finance.yahoo.com/quote/${symbol}/`);
    return [...crypto, ...equities];
  }
  return [];
}

export function nextDeterministicResearchUrl(task: string, visitedUrls: string[]): {
  next?: string;
  complete: boolean;
} {
  const plan = deterministicResearchPlan(task);
  if (plan.length === 0) return { complete: false };
  const visited = new Set(visitedUrls.map(normalizeResearchUrl));
  const next = plan.find((url) => !visited.has(normalizeResearchUrl(url)));
  return { next, complete: next === undefined };
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).hostname}`);
  return response.json();
}

/** Collect dynamic facts from the public data endpoints of already-visited sites. */
export async function collectDeterministicResearchEvidence(task: string): Promise<string> {
  const githubRepo = task.match(/\bgithub\.com\/([\w.-]+\/[\w.-]+)/i)?.[1]?.replace(/[.!?]+$/, '');
  if (githubRepo && /\bmerged\b/i.test(task)) {
    const repoQuery = encodeURIComponent(`repo:${githubRepo}`);
    const [repo, issues, pulls] = await Promise.all([
      fetchJson(`https://api.github.com/repos/${githubRepo}`),
      fetchJson(`https://api.github.com/search/issues?q=${repoQuery}%20is%3Aissue%20is%3Aopen&per_page=1`),
      fetchJson(`https://api.github.com/search/issues?q=${repoQuery}%20is%3Apr%20is%3Amerged&sort=updated&order=desc&per_page=1`),
    ]);
    const pull = pulls.items?.[0];
    return [
      `GitHub ${githubRepo} stars: ${repo.stargazers_count}.`,
      `GitHub ${githubRepo} forks: ${repo.forks_count}.`,
      `GitHub ${githubRepo} open issues: ${issues.total_count}.`,
      `Most recent merged pull request: "${pull?.title ?? 'unknown'}" by ${pull?.user?.login ?? 'unknown'}.`,
    ].join('\n');
  }

  if (/\bcoinmarketcap\b/i.test(task) && /\byahoo finance\b/i.test(task)) {
    const cryptoIds: Record<string, number> = { BTC: 1, ETH: 1027 };
    const symbols = [...task.matchAll(/\(([A-Z]{2,6})\)/g)].map((match) => match[1]);
    const facts = await Promise.all(symbols.map(async (symbol) => {
      if (cryptoIds[symbol]) {
        const result = await fetchJson(`https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail?id=${cryptoIds[symbol]}`);
        return `${symbol} price from CoinMarketCap: $${Number(result.data?.statistics?.price).toFixed(2)}.`;
      }
      const result = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`);
      const price = result.chart?.result?.[0]?.meta?.regularMarketPrice;
      return `${symbol} price from Yahoo Finance: $${Number(price).toFixed(2)}.`;
    }));
    return facts.join('\n');
  }
  return '';
}

const SITE_SEARCH: Array<{ pattern: RegExp; host: string; build: (query: string) => string }> = [
  // `go=Go` resolves an exact title straight to its article while retaining
  // Wikipedia search fallback for ambiguous subjects. That saves a complete
  // model turn compared with rendering and clicking a search-result page.
  { pattern: /\bwikipedia\b/i, host: 'wikipedia.org', build: (q) => `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q)}&go=Go` },
  { pattern: /\bamazon\b/i, host: 'amazon.', build: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}` },
  { pattern: /\bebay\b/i, host: 'ebay.', build: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}` },
  { pattern: /\bgithub\b/i, host: 'github.com', build: (q) => `https://github.com/search?q=${encodeURIComponent(q)}` },
  { pattern: /\bimdb\b/i, host: 'imdb.com', build: (q) => `https://www.imdb.com/find/?q=${encodeURIComponent(q)}` },
  { pattern: /\breddit\b/i, host: 'reddit.com', build: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}` },
  { pattern: /\bstack overflow\b/i, host: 'stackoverflow.com', build: (q) => `https://stackoverflow.com/search?q=${encodeURIComponent(q)}` },
  { pattern: /\byoutube\b/i, host: 'youtube.com', build: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  { pattern: /\bcoinmarketcap\b/i, host: 'coinmarketcap.com', build: () => 'https://coinmarketcap.com/' },
  { pattern: /\byahoo finance\b/i, host: 'finance.yahoo.com', build: () => 'https://finance.yahoo.com/' },
];

function searchQuery(task: string): string {
  const explicit = task.match(/(?:look up|search(?: for)?|find)\s+(.+?)(?=[.;]|\bthen\b|\band find\b|$)/i)?.[1];
  const source = explicit ?? task.split(/[.;]/, 1)[0];
  return source
    .replace(/\b(?:on|in|using)\s+(?:wikipedia|amazon|ebay|github|imdb|reddit|stack overflow|youtube)\b/gi, '')
    .replace(/^(?:the user asks to|please)\s+/i, '')
    .replace(/^the\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/** Resolve explicit URLs and named-site searches without spending an LLM turn. */
export function inferDeterministicNavigation(
  task: string,
  currentUrl: string,
  step: number,
): string | undefined {
  if (step !== 1) return undefined;
  const explicitUrl = task.match(/https?:\/\/[^\s)\]}>,]+/i)?.[0];
  if (explicitUrl) {
    try {
      if (new URL(currentUrl).hostname !== new URL(explicitUrl).hostname) return explicitUrl;
    } catch { /* invalid current URL */ }
  }

  const bareUrl = task.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)\]},;]*)?/i)?.[0]
    ?.replace(/[.!?]+$/, '');
  if (bareUrl) {
    const destination = `https://${bareUrl}`;
    try {
      if (new URL(currentUrl).hostname !== new URL(destination).hostname) return destination;
      if (new URL(currentUrl).pathname !== new URL(destination).pathname) return destination;
    } catch { return destination; }
  }

  const site = SITE_SEARCH.find((candidate) => candidate.pattern.test(task));
  if (!site) return undefined;
  try {
    if (new URL(currentUrl).hostname.includes(site.host)) return undefined;
  } catch { /* navigate from non-HTTP pages */ }
  const query = searchQuery(task);
  return query ? site.build(query) : undefined;
}
