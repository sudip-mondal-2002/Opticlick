import { describe, it, expect } from 'vitest';
import {
  scrollDeltaIsSignificant,
  shouldPivot,
  computeScrollDelta,
  MAX_PIVOT_RETRIES,
  SCROLL_DELTA_THRESHOLD_PX,
  SCROLL_STEP_PX,
} from '@/utils/navigation-guard';
import type { ActionRecord } from '@/utils/navigation-guard';

// ── computeScrollDelta ────────────────────────────────────────────────────────

describe('computeScrollDelta', () => {
  it('direction "down" → positive deltaY, zero deltaX', () => {
    const { deltaX, deltaY } = computeScrollDelta('down');
    expect(deltaY).toBe(SCROLL_STEP_PX);
    expect(deltaX).toBe(0);
  });

  it('direction "up" → negative deltaY, zero deltaX', () => {
    const { deltaX, deltaY } = computeScrollDelta('up');
    expect(deltaY).toBe(-SCROLL_STEP_PX);
    expect(deltaX).toBe(0);
  });

  it('direction "right" → positive deltaX, zero deltaY', () => {
    const { deltaX, deltaY } = computeScrollDelta('right');
    expect(deltaX).toBe(SCROLL_STEP_PX);
    expect(deltaY).toBe(0);
  });

  it('direction "left" → negative deltaX, zero deltaY', () => {
    const { deltaX, deltaY } = computeScrollDelta('left');
    expect(deltaX).toBe(-SCROLL_STEP_PX);
    expect(deltaY).toBe(0);
  });

  it('up and down produce opposite deltaY values', () => {
    const up = computeScrollDelta('up');
    const down = computeScrollDelta('down');
    expect(down.deltaY).toBe(-up.deltaY);
  });

  it('uses SCROLL_STEP_PX magnitude for all four directions', () => {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const { deltaX, deltaY } = computeScrollDelta(dir);
      expect(Math.abs(deltaX) + Math.abs(deltaY)).toBe(SCROLL_STEP_PX);
    }
  });

  it('never produces both deltaX and deltaY non-zero (axis-locked)', () => {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const { deltaX, deltaY } = computeScrollDelta(dir);
      expect(deltaX === 0 || deltaY === 0).toBe(true);
    }
  });
});

// ── scrollDeltaIsSignificant ──────────────────────────────────────────────────

describe('scrollDeltaIsSignificant', () => {
  it('returns true when the page moved by more than the threshold', () => {
    expect(scrollDeltaIsSignificant(0, 200)).toBe(true);
  });

  it('returns true when scrolled upward past the threshold', () => {
    expect(scrollDeltaIsSignificant(500, 200)).toBe(true);
  });

  it('returns false when delta is below the default threshold', () => {
    expect(scrollDeltaIsSignificant(0, SCROLL_DELTA_THRESHOLD_PX - 1)).toBe(false);
  });

  it('returns true when delta equals the default threshold', () => {
    expect(scrollDeltaIsSignificant(0, SCROLL_DELTA_THRESHOLD_PX)).toBe(true);
  });

  it('returns false for zero delta (no movement)', () => {
    expect(scrollDeltaIsSignificant(300, 300)).toBe(false);
  });

  it('respects a custom threshold override', () => {
    expect(scrollDeltaIsSignificant(300, 320, 10)).toBe(true);
    expect(scrollDeltaIsSignificant(300, 320, 500)).toBe(false);
  });
});

// ── shouldPivot ───────────────────────────────────────────────────────────────

describe('shouldPivot', () => {
  const click = (targetId: number): ActionRecord => ({ type: 'click', targetId });
  const scroll = (): ActionRecord => ({ type: 'scroll', targetId: undefined });

  it(`triggers pivot after ${MAX_PIVOT_RETRIES} identical (type, targetId) pairs`, () => {
    expect(shouldPivot([click(5), click(5), click(5)], 'click', 5)).toBe(true);
  });

  it('does NOT trigger pivot with fewer retries than the threshold', () => {
    expect(shouldPivot([click(5), click(5)], 'click', 5)).toBe(false);
  });

  it('treats different targetIds as different actions', () => {
    const history: ActionRecord[] = [click(5), click(5), click(5), click(6)];
    expect(shouldPivot(history, 'click', 6)).toBe(false);
    expect(shouldPivot(history, 'click', 5)).toBe(true);
  });

  it('handles page-level actions (targetId undefined) independently', () => {
    expect(shouldPivot([scroll(), scroll(), scroll()], 'scroll', undefined)).toBe(true);
  });

  it('does not confuse scroll with click', () => {
    const history: ActionRecord[] = [scroll(), scroll(), scroll()];
    expect(shouldPivot(history, 'click', undefined)).toBe(false);
    expect(shouldPivot(history, 'scroll', undefined)).toBe(true);
  });

  it('respects a custom maxRetries override', () => {
    const history: ActionRecord[] = [click(3), click(3)];
    expect(shouldPivot(history, 'click', 3, 2)).toBe(true);
    expect(shouldPivot(history, 'click', 3, 3)).toBe(false);
  });

  it('returns false for an empty history', () => {
    expect(shouldPivot([], 'click', 1)).toBe(false);
  });
});
