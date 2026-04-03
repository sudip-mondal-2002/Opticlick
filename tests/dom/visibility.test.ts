/**
 * Tests for visibility.ts — runs in jsdom environment.
 *
 * jsdom's getBoundingClientRect always returns zeros, so we mock it per-element.
 * window.innerHeight/innerWidth default to 768/1024 in jsdom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getVisibleRect, isTopElementAt } from '@/entrypoints/content/visibility';

function makeEl(styles: Partial<CSSStyleDeclaration> = {}): HTMLElement {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(styles)) {
    (el.style as unknown as Record<string, string>)[k] = v as string;
  }
  document.body.appendChild(el);
  return el;
}

function mockRect(
  el: Element,
  rect: Partial<DOMRect & { width: number; height: number }>,
): void {
  const full: DOMRect = {
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: (rect.left ?? 0) + (rect.width ?? 100),
    bottom: (rect.top ?? 0) + (rect.height ?? 30),
    width: rect.width ?? 100,
    height: rect.height ?? 30,
    toJSON: () => ({}),
  };
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(full);
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// ── getVisibleRect ────────────────────────────────────────────────────────────

describe('getVisibleRect', () => {
  it('returns DOMRect for a normally visible element', () => {
    const el = makeEl();
    mockRect(el, { left: 10, top: 10, width: 100, height: 30 });
    expect(getVisibleRect(el)).not.toBeNull();
  });

  it('returns null when width <= 2', () => {
    const el = makeEl();
    mockRect(el, { left: 0, top: 0, width: 2, height: 30 });
    expect(getVisibleRect(el)).toBeNull();
  });

  it('returns null when height <= 2', () => {
    const el = makeEl();
    mockRect(el, { left: 0, top: 0, width: 100, height: 2 });
    expect(getVisibleRect(el)).toBeNull();
  });

  it('returns null when bottom < 0 (scrolled above viewport)', () => {
    const el = makeEl();
    mockRect(el, { left: 0, top: -50, width: 100, height: 30 }); // bottom = -20
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: -50, left: 0, top: -50, right: 100, bottom: -20,
      width: 100, height: 30, toJSON: () => ({}),
    });
    expect(getVisibleRect(el)).toBeNull();
  });

  it('returns null when right < 0', () => {
    const el = makeEl();
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      x: -200, y: 0, left: -200, top: 0, right: -100, bottom: 30,
      width: 100, height: 30, toJSON: () => ({}),
    });
    expect(getVisibleRect(el)).toBeNull();
  });

  it('returns null when top > window.innerHeight', () => {
    const el = makeEl();
    const h = window.innerHeight;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: h + 10, left: 0, top: h + 10, right: 100, bottom: h + 40,
      width: 100, height: 30, toJSON: () => ({}),
    });
    expect(getVisibleRect(el)).toBeNull();
  });

  it('returns null when left > window.innerWidth', () => {
    const el = makeEl();
    const w = window.innerWidth;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      x: w + 10, y: 0, left: w + 10, top: 0, right: w + 110, bottom: 30,
      width: 100, height: 30, toJSON: () => ({}),
    });
    expect(getVisibleRect(el)).toBeNull();
  });

  it('returns rect for element partially cut off at the bottom', () => {
    const el = makeEl();
    const h = window.innerHeight;
    // top is 10px above viewport bottom — element overlaps viewport, so visible
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: h - 10, left: 0, top: h - 10, right: 100, bottom: h + 50,
      width: 100, height: 60, toJSON: () => ({}),
    });
    expect(getVisibleRect(el)).not.toBeNull();
  });

  it('returns rect for element partially cut off at the right side', () => {
    const el = makeEl();
    const w = window.innerWidth;
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      x: w - 20, y: 0, left: w - 20, top: 0, right: w + 80, bottom: 30,
      width: 100, height: 30, toJSON: () => ({}),
    });
    expect(getVisibleRect(el)).not.toBeNull();
  });

  it('returns null for display:none element', () => {
    const el = makeEl({ display: 'none' });
    mockRect(el, { left: 0, top: 0, width: 100, height: 30 });
    expect(getVisibleRect(el)).toBeNull();
  });

  it('returns null for visibility:hidden element', () => {
    const el = makeEl({ visibility: 'hidden' });
    mockRect(el, { left: 0, top: 0, width: 100, height: 30 });
    expect(getVisibleRect(el)).toBeNull();
  });

  it('returns null for opacity:0 element', () => {
    const el = makeEl({ opacity: '0' });
    mockRect(el, { left: 0, top: 0, width: 100, height: 30 });
    expect(getVisibleRect(el)).toBeNull();
  });
});

// ── isTopElementAt ────────────────────────────────────────────────────────────

describe('isTopElementAt', () => {
  function makeRect(left = 10, top = 10, width = 100, height = 40): DOMRect {
    return {
      x: left, y: top, left, top,
      right: left + width, bottom: top + height,
      width, height, toJSON: () => ({}),
    };
  }

  it('returns true when elementFromPoint returns the same element', () => {
    const el = makeEl();
    const rect = makeRect();
    document.elementFromPoint = vi.fn(() => el);
    expect(isTopElementAt(el, rect)).toBe(true);
  });

  it('returns true when elementFromPoint returns a descendant (el.contains(top))', () => {
    const parent = makeEl();
    const child = document.createElement('span');
    parent.appendChild(child);
    const rect = makeRect();
    document.elementFromPoint = vi.fn(() => child);
    expect(isTopElementAt(parent, rect)).toBe(true);
  });

  it('returns true when elementFromPoint returns an ancestor (top.contains(el))', () => {
    const parent = makeEl();
    const child = document.createElement('span');
    parent.appendChild(child);
    const rect = makeRect();
    document.elementFromPoint = vi.fn(() => parent);
    expect(isTopElementAt(child, rect)).toBe(true);
  });

  it('returns false when none of the three points match', () => {
    const el = makeEl();
    const other = makeEl();
    const rect = makeRect();
    document.elementFromPoint = vi.fn(() => other);
    expect(isTopElementAt(el, rect)).toBe(false);
  });

  it('returns true if any single point matches (not requiring all three)', () => {
    const el = makeEl();
    const other = makeEl();
    const rect = makeRect();
    let callCount = 0;
    document.elementFromPoint = vi.fn(() => {
      callCount++;
      // Only the first call (center) returns the element
      return callCount === 1 ? el : other;
    });
    expect(isTopElementAt(el, rect)).toBe(true);
  });

  it('returns false when elementFromPoint returns null for all points', () => {
    const el = makeEl();
    const rect = makeRect();
    document.elementFromPoint = vi.fn(() => null);
    expect(isTopElementAt(el, rect)).toBe(false);
  });

  it('treats a throwing elementFromPoint as no match and continues to next point', () => {
    const el = makeEl();
    const rect = makeRect();
    // First two points throw (cross-origin frame), third returns the element — should be true
    let callCount = 0;
    document.elementFromPoint = vi.fn(() => {
      callCount++;
      if (callCount < 3) throw new Error('Restricted');
      return el;
    });
    expect(isTopElementAt(el, rect)).toBe(true);
  });

  it('returns false when all three elementFromPoint calls throw', () => {
    const el = makeEl();
    const rect = makeRect();
    document.elementFromPoint = vi.fn(() => { throw new Error('Restricted'); });
    expect(isTopElementAt(el, rect)).toBe(false);
  });
});
