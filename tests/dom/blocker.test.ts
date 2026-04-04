/**
 * DOM tests for src/entrypoints/content/blocker.ts
 *
 * installBlocker() creates a fixed overlay div and registers capturing event listeners.
 * removeBlocker() tears everything down.
 *
 * The module-level `isBlocking` flag persists across imports, so each test
 * explicitly calls removeBlocker() in afterEach to reset state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installBlocker, removeBlocker } from '@/entrypoints/content/blocker';

const BLOCKER_ID = '__opticlick_blocker__';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

afterEach(() => {
  // Always clean up module-level isBlocking state
  removeBlocker();
  document.body.innerHTML = '';
});

describe('installBlocker', () => {
  it('appends the blocker div to the document body', async () => {
    await installBlocker();
    expect(document.getElementById(BLOCKER_ID)).not.toBeNull();
  });

  it('blocker div has a fixed position style', async () => {
    await installBlocker();
    const el = document.getElementById(BLOCKER_ID) as HTMLDivElement;
    expect(el.style.position).toBe('fixed');
  });

  it('blocker div has z-index 2147483646', async () => {
    await installBlocker();
    const el = document.getElementById(BLOCKER_ID) as HTMLDivElement;
    expect(el.style.zIndex).toBe('2147483646');
  });

  it('blocker div has pointer-events: none (overlay is non-interactive)', async () => {
    await installBlocker();
    const el = document.getElementById(BLOCKER_ID) as HTMLDivElement;
    expect(el.style.pointerEvents).toBe('none');
  });

  it('appends a banner child with the agent-running message', async () => {
    await installBlocker();
    const el = document.getElementById(BLOCKER_ID) as HTMLDivElement;
    expect(el.textContent).toContain('Opticlick Agent Running');
  });

  it('adds the active class to document.body', async () => {
    await installBlocker();
    expect(document.body.classList.contains(`${BLOCKER_ID}-active`)).toBe(true);
  });

  it('is idempotent — calling twice does not create two blockers', async () => {
    await installBlocker();
    await installBlocker();
    const blockers = document.querySelectorAll(`#${BLOCKER_ID}`);
    expect(blockers).toHaveLength(1);
  });

  it('blocks click events via capturing listener', async () => {
    await installBlocker();
    const handler = vi.fn();
    document.addEventListener('click', handler); // non-capturing listener
    const prevented: boolean[] = [];
    document.addEventListener(
      'click',
      (e) => {
        prevented.push(e.defaultPrevented);
      },
      { capture: true },
    );
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    // The blocker's capturing listener calls preventDefault before our non-capturing handler
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('removeBlocker', () => {
  it('removes the blocker div from the DOM', async () => {
    await installBlocker();
    removeBlocker();
    expect(document.getElementById(BLOCKER_ID)).toBeNull();
  });

  it('removes the active class from document.body', async () => {
    await installBlocker();
    removeBlocker();
    expect(document.body.classList.contains(`${BLOCKER_ID}-active`)).toBe(false);
  });

  it('is a no-op when the blocker was never installed', () => {
    expect(() => removeBlocker()).not.toThrow();
  });

  it('is idempotent — calling twice does not throw', async () => {
    await installBlocker();
    removeBlocker();
    expect(() => removeBlocker()).not.toThrow();
  });

  it('allows click events to pass through after removal', async () => {
    await installBlocker();
    removeBlocker();
    const handler = vi.fn();
    document.addEventListener('click', handler);
    document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(handler).toHaveBeenCalledOnce();
    document.removeEventListener('click', handler);
  });

  it('re-installation works after a remove cycle', async () => {
    await installBlocker();
    removeBlocker();
    await installBlocker();
    expect(document.getElementById(BLOCKER_ID)).not.toBeNull();
  });
});
