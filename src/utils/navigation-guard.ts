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

/** Window size for alternating loop detection. */
export const ALTERNATING_LOOP_WINDOW = 6;

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

/** Loop types that can be detected. */
export type LoopType = 'exact_repeat' | 'alternating' | 'scroll_boundary' | 'dom_unchanged';

/** Recovery hint injected into LLM context when a loop is detected. */
export interface LoopDetectedHint {
  type: LoopType;
  affectedAction: ActionRecord;
  suggestedStrategies: string[];
}

/** Suggested recovery strategies per loop type. */
export const LOOP_RECOVERY_STRATEGIES: Record<LoopType, string[]> = {
  exact_repeat: [
    "Try a different element. Use `fetch_dom` to inspect the element's current state.",
  ],
  alternating: [
    'You are oscillating between two actions. Step back and reconsider whether the current approach is valid.',
  ],
  scroll_boundary: [
    'The page is not scrolling further. This is likely the end of the content.',
  ],
  dom_unchanged: [
    'The page DOM did not change after your last action. The click may not have registered.',
  ],
};

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

/**
 * Detects alternating A→B→A→B loops within the last `windowSize` actions.
 * Returns true when every even-indexed action matches every other even-indexed
 * action and every odd-indexed action matches every other odd-indexed action.
 */
export function detectAlternatingLoop(
  history: ActionRecord[],
  windowSize = ALTERNATING_LOOP_WINDOW,
): boolean {
  if (history.length < windowSize) return false;
  const window = history.slice(-windowSize);
  for (let i = 0; i < windowSize - 2; i++) {
    if (
      window[i].type !== window[i + 2].type ||
      window[i].targetId !== window[i + 2].targetId
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Detects when the page is not scrolling (scroll boundary reached).
 * Returns true when the scroll delta is below the threshold.
 */
export function detectScrollBoundary(
  beforeY: number,
  afterY: number,
  threshold = SCROLL_DELTA_THRESHOLD_PX,
): boolean {
  return Math.abs(afterY - beforeY) < threshold;
}

/**
 * Detects when the DOM has not changed after an action.
 * Returns true when the before and after DOM hashes are identical.
 */
export function detectDomUnchanged(beforeHash: string, afterHash: string): boolean {
  return beforeHash === afterHash && beforeHash !== '';
}

/**
 * Builds a LoopDetectedHint for injection into the LLM context.
 */
export function buildLoopHint(
  type: LoopType,
  affectedAction: ActionRecord,
): LoopDetectedHint {
  return {
    type,
    affectedAction,
    suggestedStrategies: LOOP_RECOVERY_STRATEGIES[type],
  };
}

/**
 * Master loop detector — runs all detection strategies and returns the first
 * LoopDetectedHint found, or null if no loop is detected.
 */
export function detectLoop(
  history: ActionRecord[],
  currentAction: ActionRecord,
  domBefore?: string,
  domAfter?: string,
  scrollBeforeY?: number,
  scrollAfterY?: number,
): LoopDetectedHint | null {
  // 1. Alternating A→B→A→B (check before exact_repeat)
  if (detectAlternatingLoop(history)) {
    return buildLoopHint('alternating', currentAction);
  }

  // 2. Exact repeat
  if (shouldPivot(history, currentAction.type, currentAction.targetId)) {
    return buildLoopHint('exact_repeat', currentAction);
  }
  // 3. Scroll boundary
  if (
    scrollBeforeY !== undefined &&
    scrollAfterY !== undefined &&
    detectScrollBoundary(scrollBeforeY, scrollAfterY)
  ) {
    return buildLoopHint('scroll_boundary', currentAction);
  }

  // 4. DOM unchanged
  if (domBefore !== undefined && domAfter !== undefined && detectDomUnchanged(domBefore, domAfter)) {
    return buildLoopHint('dom_unchanged', currentAction);
  }

  return null;
}
