/**
 * navigation-guard.ts
 *
 * Pure helper functions that enforce resilient navigation behaviour in the
 * agent loop. All functions are side-effect-free so they are trivially testable
 * without any chrome / DOM globals.
 *
 * Enforced rules (injected into the system prompt as "OPERATING RULES"):
 *   1. Always verify navigation success via URL change or DOM update.
 *   2. Do not repeat the same failed action more than MAX_PIVOT_RETRIES times;
 *      pivot to URL manipulation instead.
 *   3. Prefer organic search results over AI-generated summary links when the
 *      summary links are unresponsive.
 *   4. Call finish() (or sleep/wait) once the task is complete — never keep
 *      issuing actions after the goal has been met.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** How many identical failed actions are allowed before the agent must pivot. */
export const MAX_PIVOT_RETRIES = 3;

/**
 * Minimum absolute scroll-offset change (in CSS pixels) that counts as a
 * "successful" scroll. Smaller deltas are treated as no-ops.
 */
export const SCROLL_DELTA_THRESHOLD_PX = 50;

/**
 * CSS-pixel magnitude used for each mouseWheel scroll step.
 * Applied to deltaX or deltaY depending on direction.
 */
export const SCROLL_STEP_PX = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Scroll / DOM delta helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute CDP mouse-wheel delta values for a given scroll direction.
 *
 * Convention (matches DOM WheelEvent):
 *   deltaY > 0  → scroll down (window.scrollY increases)
 *   deltaY < 0  → scroll up   (window.scrollY decreases)
 *   deltaX > 0  → scroll right
 *   deltaX < 0  → scroll left
 *
 * @param direction One of 'up' | 'down' | 'left' | 'right'
 * @returns { deltaX, deltaY } ready for Input.dispatchMouseEvent
 */
export function computeScrollDelta(
  direction: 'up' | 'down' | 'left' | 'right',
): { deltaX: number; deltaY: number } {
  const isVertical = direction === 'up' || direction === 'down';
  const sign = direction === 'up' || direction === 'left' ? -1 : 1;
  return {
    deltaX: isVertical ? 0 : sign * SCROLL_STEP_PX,
    deltaY: isVertical ? sign * SCROLL_STEP_PX : 0,
  };
}

/**
 * Returns true when a scroll action moved the page by at least
 * SCROLL_DELTA_THRESHOLD_PX pixels, meaning the action had a real effect.
 *
 * @param beforeY  window.pageYOffset (or scrollY) before the action
 * @param afterY   window.pageYOffset (or scrollY) after the action
 * @param threshold  override the default pixel threshold (useful in tests)
 */
export function scrollDeltaIsSignificant(
  beforeY: number,
  afterY: number,
  threshold = SCROLL_DELTA_THRESHOLD_PX,
): boolean {
  return Math.abs(afterY - beforeY) >= threshold;
}

/**
 * Returns true when two base-64 screenshot strings are identical, i.e. the
 * page rendered the same frame before and after an action.
 * An identical screenshot after a click/scroll means the action had no effect.
 */
export function screenshotIsUnchanged(before: string, after: string): boolean {
  return before.length === after.length && before === after;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-loop / pivot helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal shape stored per agent turn for pivot tracking. */
export interface ActionRecord {
  type: string;
  /** Numeric mark ID, present for click/fetch_dom/scroll-with-target actions. */
  targetId?: number;
}

/**
 * Returns true when the agent should stop retrying the current action and
 * pivot to an alternative strategy (e.g. direct URL navigation).
 *
 * The pivot threshold is reached when the *same* (type, targetId) pair appears
 * >= maxRetries times in the recent action history.
 *
 * @param history    Ordered list of previous ActionRecords (most-recent last)
 * @param type       Action type of the action about to be attempted
 * @param targetId   Target element ID, or undefined for page-level actions
 * @param maxRetries Override the default MAX_PIVOT_RETRIES constant
 */
export function shouldPivot(
  history: ActionRecord[],
  type: string,
  targetId: number | undefined,
  maxRetries = MAX_PIVOT_RETRIES,
): boolean {
  const count = history.filter(
    (a) => a.type === type && a.targetId === targetId,
  ).length;
  return count >= maxRetries;
}

// ─────────────────────────────────────────────────────────────────────────────
// URL reconstruction helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the `q` (query) parameter from a Google SERP URL.
 * Returns null when the URL is unparseable or the parameter is absent.
 *
 * @example
 *   extractSearchQuery('https://www.google.com/search?q=hello+world') // 'hello world'
 */
export function extractSearchQuery(url: string): string | null {
  try {
    const u = new URL(url);
    return u.searchParams.get('q');
  } catch {
    return null;
  }
}

/**
 * Build a clean Google search URL from a plain query string.
 * Use this when the current UI is stuck and a direct navigate() is needed.
 *
 * @example
 *   reconstructSearchUrl('hello world') // 'https://www.google.com/search?q=hello+world'
 */
export function reconstructSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag precision helpers
// ─────────────────────────────────────────────────────────────────────────────

/** HTML tag names that are semantically interactive. */
const SEMANTIC_INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea']);

/**
 * Returns true when `tag` is a semantically meaningful interactive element,
 * i.e. NOT a generic container like `div` or `span`.
 * The annotator should always resolve to the most-specific interactive child.
 */
export function isSemanticTarget(tag: string): boolean {
  return SEMANTIC_INTERACTIVE_TAGS.has(tag.toLowerCase());
}

/**
 * Given a list of coordinate entries for the same screen region, return the
 * one with the most semantically precise tag. If none is semantic, returns
 * the first entry (fallback).
 *
 * Used by tests to verify that the annotator prefers `<a>` over a parent `<div>`.
 */
export function pickMostSemanticEntry<T extends { tag: string }>(entries: T[]): T {
  return entries.find((e) => isSemanticTarget(e.tag)) ?? entries[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation-success validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the agent's navigation attempt actually changed the page,
 * based on comparing the URL before and after the action.
 *
 * If the URLs are identical, the agent should NOT consider the navigation
 * successful and must fall back to an alternative strategy.
 */
export function navigationSucceeded(urlBefore: string, urlAfter: string): boolean {
  return urlBefore !== urlAfter;
}
