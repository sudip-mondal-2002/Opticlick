/**
 * Pure navigation-guard helpers for the agent loop.
 * All functions are side-effect-free and trivially unit-testable.
 */

/** Maximum identical failed actions before the agent must pivot. */
export const MAX_PIVOT_RETRIES = 3;

/** Minimum scroll offset change (px) that counts as a successful scroll. */
export const SCROLL_DELTA_THRESHOLD_PX = 50;

/** CSS-pixel magnitude used per mouse-wheel scroll step. */
export const SCROLL_STEP_PX = 500;

// ── Scroll helpers ────────────────────────────────────────────────────────────

/** Compute CDP mouse-wheel deltas for a given scroll direction. */
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

/** Returns true when the scroll moved the page by at least `threshold` pixels. */
export function scrollDeltaIsSignificant(
  beforeY: number,
  afterY: number,
  threshold = SCROLL_DELTA_THRESHOLD_PX,
): boolean {
  return Math.abs(afterY - beforeY) >= threshold;
}

// ── Anti-loop pivot ───────────────────────────────────────────────────────────

/** Minimal record stored per turn for pivot tracking. */
export interface ActionRecord {
  type: string;
  targetId?: number;
}

/**
 * Returns true when the same (type, targetId) pair has been attempted
 * >= maxRetries times — the agent must switch strategy.
 */
export function shouldPivot(
  history: ActionRecord[],
  type: string,
  targetId: number | undefined,
  maxRetries = MAX_PIVOT_RETRIES,
): boolean {
  return history.filter((a) => a.type === type && a.targetId === targetId).length >= maxRetries;
}
