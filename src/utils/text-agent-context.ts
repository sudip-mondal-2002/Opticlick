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
export function selectRelevantPageText(pageText: string, task: string, maxChars = 700): string {
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
    if (selected.length >= 6) break;
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
  limit = 10,
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

const SITE_SEARCH: Array<{ pattern: RegExp; host: string; build: (query: string) => string }> = [
  { pattern: /\bwikipedia\b/i, host: 'wikipedia.org', build: (q) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}` },
  { pattern: /\bamazon\b/i, host: 'amazon.', build: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}` },
  { pattern: /\bebay\b/i, host: 'ebay.', build: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}` },
  { pattern: /\bgithub\b/i, host: 'github.com', build: (q) => `https://github.com/search?q=${encodeURIComponent(q)}` },
  { pattern: /\bimdb\b/i, host: 'imdb.com', build: (q) => `https://www.imdb.com/find/?q=${encodeURIComponent(q)}` },
  { pattern: /\breddit\b/i, host: 'reddit.com', build: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}` },
  { pattern: /\bstack overflow\b/i, host: 'stackoverflow.com', build: (q) => `https://stackoverflow.com/search?q=${encodeURIComponent(q)}` },
  { pattern: /\byoutube\b/i, host: 'youtube.com', build: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
];

function searchQuery(task: string): string {
  const explicit = task.match(/(?:look up|search(?: for)?|find)\s+(.+?)(?=[.;]|\bthen\b|\band find\b|$)/i)?.[1];
  const source = explicit ?? task.split(/[.;]/, 1)[0];
  return source
    .replace(/\b(?:on|in|using)\s+(?:wikipedia|amazon|ebay|github|imdb|reddit|stack overflow|youtube)\b/gi, '')
    .replace(/^(?:the user asks to|please)\s+/i, '')
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

  const site = SITE_SEARCH.find((candidate) => candidate.pattern.test(task));
  if (!site) return undefined;
  try {
    if (new URL(currentUrl).hostname.includes(site.host)) return undefined;
  } catch { /* navigate from non-HTTP pages */ }
  const query = searchQuery(task);
  return query ? site.build(query) : undefined;
}
