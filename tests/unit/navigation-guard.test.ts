import { describe, it, expect } from 'vitest';
import {
  scrollDeltaIsSignificant,
  shouldPivot,
  computeScrollDelta,
  MAX_PIVOT_RETRIES,
  SCROLL_DELTA_THRESHOLD_PX,
  SCROLL_STEP_PX,
  detectAlternatingLoop,
  detectScrollBoundary,
  detectDomUnchanged,
  detectLoop,
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

// ── detectAlternatingLoop ─────────────────────────────────────────────────────

describe('detectAlternatingLoop', () => {
  const click = (id: number): ActionRecord => ({ type: 'click', targetId: id });
  const scroll = (): ActionRecord => ({ type: 'scroll', targetId: undefined });

  it('detects A→B→A→B→A→B alternating pattern', () => {
    const history = [click(1), click(2), click(1), click(2), click(1), click(2)];
    expect(detectAlternatingLoop(history)).toBe(true);
  });

  it('returns false for history shorter than windowSize', () => {
    const history = [click(1), click(2), click(1), click(2)];
    expect(detectAlternatingLoop(history)).toBe(false);
  });

  it('returns false for non-alternating history', () => {
    const history = [click(1), click(2), click(3), click(4), click(5), click(6)];
    expect(detectAlternatingLoop(history)).toBe(false);
  });

  it('detects alternating scroll/click pattern', () => {
    const history = [scroll(), click(1), scroll(), click(1), scroll(), click(1)];
    expect(detectAlternatingLoop(history)).toBe(true);
  });

  it('returns false for empty history', () => {
    expect(detectAlternatingLoop([])).toBe(false);
  });
});

// ── detectScrollBoundary ──────────────────────────────────────────────────────

describe('detectScrollBoundary', () => {
  it('returns true when page did not scroll (boundary reached)', () => {
    expect(detectScrollBoundary(500, 500)).toBe(true);
  });

  it('returns true when scroll delta is below threshold', () => {
    expect(detectScrollBoundary(500, 530)).toBe(true);
  });

  it('returns false when page scrolled past threshold', () => {
    expect(detectScrollBoundary(0, 200)).toBe(false);
  });

  it('respects custom threshold', () => {
    expect(detectScrollBoundary(0, 30, 100)).toBe(true);
    expect(detectScrollBoundary(0, 150, 100)).toBe(false);
  });
});

// ── detectDomUnchanged ────────────────────────────────────────────────────────

describe('detectDomUnchanged', () => {
  it('returns true when before and after hashes are identical', () => {
    expect(detectDomUnchanged('abc123', 'abc123')).toBe(true);
  });

  it('returns false when hashes differ', () => {
    expect(detectDomUnchanged('abc123', 'xyz789')).toBe(false);
  });

  it('returns false when both hashes are empty string', () => {
    expect(detectDomUnchanged('', '')).toBe(false);
  });
});

// ── detectLoop (master) ───────────────────────────────────────────────────────

describe('detectLoop', () => {
  const click = (id: number): ActionRecord => ({ type: 'click', targetId: id });

  it('returns exact_repeat hint when same action repeated 3+ times', () => {
    const history = [click(5), click(5), click(5)];
    const result = detectLoop(history, click(5));
    expect(result).not.toBeNull();
    expect(result?.type).toBe('exact_repeat');
  });

  it('returns alternating hint for A→B→A→B pattern', () => {
    const history = [click(1), click(2), click(1), click(2), click(1), click(2)];
    const result = detectLoop(history, click(1));
    expect(result?.type).toBe('alternating');
  });

  it('returns scroll_boundary hint when page did not scroll', () => {
    const result = detectLoop([], click(1), undefined, undefined, 500, 500);
    expect(result?.type).toBe('scroll_boundary');
  });

  it('returns dom_unchanged hint when DOM hash did not change', () => {
    const result = detectLoop([], click(1), 'hash123', 'hash123');
    expect(result?.type).toBe('dom_unchanged');
  });

  it('returns null when no loop detected', () => {
    const result = detectLoop([click(1), click(2)], click(3), 'hash1', 'hash2', 0, 200);
    expect(result).toBeNull();
  });

  it('hint contains suggestedStrategies', () => {
    const history = [click(5), click(5), click(5)];
    const result = detectLoop(history, click(5));
    expect(result?.suggestedStrategies.length).toBeGreaterThan(0);
  });
});