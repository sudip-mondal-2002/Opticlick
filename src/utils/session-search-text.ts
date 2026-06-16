/** Max length for denormalized session search text stored in IndexedDB. */
export const SESSION_SEARCH_TEXT_MAX = 4096;

/** Build normalized lowercase search text from arbitrary snippets. */
export function buildSearchText(...parts: string[]): string {
  return parts
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SESSION_SEARCH_TEXT_MAX);
}

/** Append a snippet to existing search text without duplicating content. */
export function mergeSearchText(existing: string | undefined, snippet: string): string {
  const normalized = snippet.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return existing ?? '';
  const base = existing ?? '';
  if (base.includes(normalized)) return base.slice(0, SESSION_SEARCH_TEXT_MAX);
  return buildSearchText(base, normalized);
}

/** Extract start URL from an anchored prompt or conversation turn. */
export function parseStartUrlFromContent(content: string): string | undefined {
  const match = content.match(/\[CONTEXT: The task started on (.+?)\. If you are on an unrelated page, navigate back\.\]/);
  return match?.[1]?.trim() || undefined;
}
