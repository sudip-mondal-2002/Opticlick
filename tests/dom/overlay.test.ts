/**
 * Tests for overlay.ts — runs in jsdom environment.
 *
 * overlay.ts imports getTheme() which calls chrome.storage.local.
 * The fake-browser-setup.ts wires fakeBrowser as globalThis.chrome,
 * providing a working chrome.storage.local implementation.
 *
 * jsdom doesn't implement Canvas 2D context — we stub getContext.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { destroyOverlay, drawOverlay } from '@/entrypoints/content/overlay';

const CANVAS_ID = '__opticlick_overlay__';

// Minimal canvas 2D context stub — jsdom throws on getContext('2d')
function stubCanvasContext(canvas: HTMLCanvasElement) {
  const ctx: Partial<CanvasRenderingContext2D> & { roundRect?: unknown } = {
    scale: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    rect: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    font: '',
    textBaseline: 'middle' as CanvasTextBaseline,
  };
  vi.spyOn(canvas, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
}

// Intercept createElement('canvas') to inject our stub
function interceptCanvasCreation() {
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...rest) => {
    const el = original(tag, ...(rest as []));
    if (tag === 'canvas') stubCanvasContext(el as HTMLCanvasElement);
    return el;
  });
}

// Give every element a non-zero rect so getVisibleRect passes
function makeVisibleElement(tag: string, text = 'click me') {
  const el = document.createElement(tag);
  el.textContent = text;
  // Make getBoundingClientRect return a realistic visible rect
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40,
    width: 100, height: 30, toJSON: () => ({}),
  } as DOMRect);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('destroyOverlay', () => {
  it('removes the canvas with id __opticlick_overlay__', () => {
    const canvas = document.createElement('canvas');
    canvas.id = CANVAS_ID;
    document.body.appendChild(canvas);
    destroyOverlay();
    expect(document.getElementById(CANVAS_ID)).toBeNull();
  });

  it('is a no-op when no canvas exists', () => {
    expect(() => destroyOverlay()).not.toThrow();
  });
});

describe('drawOverlay', () => {
  beforeEach(() => {
    interceptCanvasCreation();
    // jsdom doesn't implement elementFromPoint, assign directly
    document.elementFromPoint = vi.fn(() => {
      // Return the first button in body so the element "passes" the top-element check
      return document.querySelector('button') ?? document.body;
    });
  });

  it('appends a canvas element to document.body', async () => {
    await drawOverlay();
    expect(document.getElementById(CANVAS_ID)).not.toBeNull();
  });

  it('canvas has pointer-events:none in its inline style', async () => {
    await drawOverlay();
    const canvas = document.getElementById(CANVAS_ID) as HTMLCanvasElement;
    expect(canvas.style.pointerEvents).toBe('none');
  });

  it('canvas z-index is 2147483647', async () => {
    await drawOverlay();
    const canvas = document.getElementById(CANVAS_ID) as HTMLCanvasElement;
    expect(canvas.style.zIndex).toBe('2147483647');
  });

  it('returns an empty CoordinateEntry array when no interactables', async () => {
    const result = await drawOverlay();
    expect(result).toEqual([]);
  });

  it('returns a CoordinateEntry for each visible interactable', async () => {
    const btn = makeVisibleElement('button', 'Submit');
    document.elementFromPoint = vi.fn(() => btn);
    const result = await drawOverlay();
    expect(result.length).toBeGreaterThan(0);
  });

  it('CoordinateEntry has id, tag, text, rect', async () => {
    const btn = makeVisibleElement('button', 'OK');
    document.elementFromPoint = vi.fn(() => btn);
    const result = await drawOverlay();
    const entry = result.find((e) => e.tag === 'button');
    expect(entry).toBeDefined();
    expect(entry!.id).toBeGreaterThan(0);
    expect(entry!.tag).toBe('button');
    expect(typeof entry!.text).toBe('string');
    expect(entry!.rect).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      left: expect.any(Number),
      top: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
  });

  it('adds inputType for <input> elements', async () => {
    const input = document.createElement('input');
    input.type = 'file';
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 50, left: 0, top: 50, right: 200, bottom: 80,
      width: 200, height: 30, toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(input);
    document.elementFromPoint = vi.fn(() => input);
    const result = await drawOverlay();
    const entry = result.find((e) => e.tag === 'input');
    expect(entry?.inputType).toBe('file');
  });

  it('does not add inputType for non-input elements', async () => {
    const btn = makeVisibleElement('button', 'Click');
    document.elementFromPoint = vi.fn(() => btn);
    const result = await drawOverlay();
    const entry = result.find((e) => e.tag === 'button');
    expect(entry?.inputType).toBeUndefined();
  });

  it('destroys existing canvas before redrawing', async () => {
    // First draw
    await drawOverlay();
    // Second draw — should only be one canvas
    await drawOverlay();
    const canvases = document.querySelectorAll(`#${CANVAS_ID}`);
    expect(canvases).toHaveLength(1);
  });

  it('rect coordinates use Math.round values (integers)', async () => {
    const btn = makeVisibleElement('button', 'Round');
    vi.spyOn(btn, 'getBoundingClientRect').mockReturnValue({
      x: 10.4, y: 20.7, left: 10.4, top: 20.7, right: 110.4, bottom: 50.7,
      width: 100, height: 30, toJSON: () => ({}),
    } as DOMRect);
    document.elementFromPoint = vi.fn(() => btn);
    const result = await drawOverlay();
    const entry = result.find((e) => e.tag === 'button');
    expect(entry).toBeDefined();
    expect(Number.isInteger(entry!.rect.x)).toBe(true);
    expect(Number.isInteger(entry!.rect.y)).toBe(true);
    expect(Number.isInteger(entry!.rect.left)).toBe(true);
    expect(Number.isInteger(entry!.rect.top)).toBe(true);
  });
});
