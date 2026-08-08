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
  for (const candidate of ranked) {
    if (selected.length >= 3) break;
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
