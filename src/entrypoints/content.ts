/**
 * Content Script — Opticlick Annotator
 *
 * 1. Discover all interactable elements (including open Shadow DOMs).
 * 2. Filter occluded / invisible elements via elementFromPoint.
 * 3. Render a unified <canvas> overlay with numbered bounding boxes.
 * 4. Block user input while agent is running.
 * 5. Return coordinate map to background service worker.
 */

import type { CoordinateEntry } from '@/utils/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',

  main() {
    // ── Theme colours (sky-blue, no purple) ──────────────────────────────────

    const MARK_STROKE = '#0284c7';              // sky-600
    const MARK_FILL = 'rgba(2, 132, 199, 0.07)'; // sky-600 @ 7%
    const BADGE_BG = '#0284c7';                 // sky-600
    const BADGE_TEXT = '#ffffff';
    const BLOCKER_BG = 'rgba(14, 165, 233, 0.14)';   // sky-500 @ 14%
    const BLOCKER_BORDER = 'rgba(14, 165, 233, 0.6)'; // sky-500 @ 60%
    const BANNER_BG = 'rgba(2, 132, 199, 0.92)';     // sky-600 @ 92%

    // ── Constants ────────────────────────────────────────────────────────────

    const CANVAS_ID = '__opticlick_overlay__';
    const BLOCKER_ID = '__opticlick_blocker__';

    const INTERACTIVE_ROLES = new Set([
      'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
      'option', 'radio', 'checkbox', 'tab', 'treeitem', 'gridcell',
      'combobox', 'listbox', 'slider', 'spinbutton', 'switch',
      'textbox', 'searchbox', 'columnheader', 'rowheader',
    ]);

    const INTERACTIVE_TAGS = new Set([
      'a', 'button', 'input', 'select', 'textarea', 'label',
      'summary', 'details', 'video', 'audio',
    ]);

    // ── State ────────────────────────────────────────────────────────────────

    let coordinateMap: CoordinateEntry[] = [];
    let isBlocking = false;

    // ── Shadow DOM piercing collector ─────────────────────────────────────────

    function collectInteractables(root: Node, results: Element[] = []): Element[] {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const el = node as Element;
        if (isInteractable(el)) results.push(el);
        if ((el as HTMLElement).shadowRoot) {
          collectInteractables((el as HTMLElement).shadowRoot!, results);
        }
      }
      return results;
    }

    function isInteractable(el: Element): boolean {
      const tag = el.tagName.toLowerCase();
      const role = (el.getAttribute('role') ?? '').toLowerCase();

      if (INTERACTIVE_TAGS.has(tag)) {
        if ((el as HTMLInputElement).disabled) return false;
        if (tag === 'input' && (el as HTMLInputElement).type === 'hidden') return false;
        return true;
      }

      if (INTERACTIVE_ROLES.has(role)) return true;

      if (
        el.hasAttribute('tabindex') &&
        parseInt(el.getAttribute('tabindex')!, 10) >= 0
      )
        return true;

      try {
        if (window.getComputedStyle(el).cursor === 'pointer') return true;
      } catch { /* cross-origin */ }

      if (
        (el as HTMLElement).onclick ||
        el.hasAttribute('onclick') ||
        el.hasAttribute('ng-click') ||
        el.hasAttribute('@click') ||
        el.hasAttribute('v-on:click')
      )
        return true;

      return false;
    }

    // ── Visibility & Occlusion ───────────────────────────────────────────────

    function getVisibleRect(el: Element): DOMRect | null {
      let rect: DOMRect;
      try {
        rect = el.getBoundingClientRect();
      } catch {
        return null;
      }

      if (rect.width <= 2 || rect.height <= 2) return null;
      if (rect.bottom < 0 || rect.right < 0) return null;
      if (rect.top > window.innerHeight || rect.left > window.innerWidth) return null;

      try {
        const style = window.getComputedStyle(el);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          parseFloat(style.opacity) === 0
        )
          return null;
      } catch { /* ignore */ }

      return rect;
    }

    function isTopElementAt(el: Element, rect: DOMRect): boolean {
      const points: [number, number][] = [
        [rect.left + rect.width * 0.5, rect.top + rect.height * 0.5],
        [rect.left + 4, rect.top + 4],
        [rect.right - 4, rect.bottom - 4],
      ];

      for (const [x, y] of points) {
        try {
          const top = document.elementFromPoint(x, y);
          if (!top) continue;
          if (el === top || el.contains(top) || top.contains(el)) return true;
        } catch { /* cross-origin */ }
      }
      return false;
    }

    // ── Text label helper ────────────────────────────────────────────────────

    function getLabel(el: Element): string {
      const tag = el.tagName.toLowerCase();

      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel.trim().slice(0, 40);

      const ariaLabelledBy = el.getAttribute('aria-labelledby');
      if (ariaLabelledBy) {
        const ref = document.getElementById(ariaLabelledBy);
        if (ref) return ref.textContent!.trim().slice(0, 40);
      }

      if (tag === 'input') {
        return (
          (el as HTMLInputElement).placeholder ||
          (el as HTMLInputElement).name ||
          (el as HTMLInputElement).type ||
          'input'
        ).slice(0, 40);
      }

      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      if (text) return text.slice(0, 40);

      return tag;
    }

    // ── Canvas overlay ───────────────────────────────────────────────────────

    function drawOverlay(): CoordinateEntry[] {
      destroyOverlay();

      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;

      const root = document.body || document.documentElement;
      const interactables = collectInteractables(root);

      console.log(
        `[Opticlick] collectInteractables found ${interactables.length} candidates (frame: ${window === window.top ? 'TOP' : 'IFRAME'}, URL: ${location.href.slice(0, 80)})`,
      );

      const visibleItems: { el: Element; rect: DOMRect; id: number }[] = [];
      let nextId = 1;

      for (const el of interactables) {
        const rect = getVisibleRect(el);
        if (!rect) continue;
        if (!isTopElementAt(el, rect)) continue;
        visibleItems.push({ el, rect, id: nextId++ });
      }

      console.log(`[Opticlick] Visible elements: ${visibleItems.length}`);

      const canvas = document.createElement('canvas');
      canvas.id = CANVAS_ID;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: ${width}px;
        height: ${height}px;
        z-index: 2147483647;
        pointer-events: none;
      `;

      (document.body || document.documentElement).appendChild(canvas);

      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);

      coordinateMap = [];

      for (const { el, rect, id } of visibleItems) {
        const x = rect.left;
        const y = rect.top;
        const w = rect.width;
        const h = rect.height;

        // Bounding box — sky blue
        ctx.strokeStyle = MARK_STROKE;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

        // Light fill tint
        ctx.fillStyle = MARK_FILL;
        ctx.fillRect(x + 1, y + 1, w - 2, h - 2);

        // ID badge
        const label = String(id);
        const badgeW = Math.max(label.length * 7 + 8, 20);
        const badgeH = 16;
        const badgeX = x;
        const badgeY = y - badgeH - 1;

        ctx.fillStyle = BADGE_BG;
        ctx.beginPath();
        if (ctx.roundRect) {
          ctx.roundRect(badgeX, Math.max(0, badgeY), badgeW, badgeH, 3);
        } else {
          ctx.rect(badgeX, Math.max(0, badgeY), badgeW, badgeH);
        }
        ctx.fill();

        ctx.fillStyle = BADGE_TEXT;
        ctx.font = 'bold 10px -apple-system, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, badgeX + 4, Math.max(badgeH / 2, badgeY + badgeH / 2));

        coordinateMap.push({
          id,
          tag: el.tagName.toLowerCase(),
          text: getLabel(el),
          rect: {
            x: Math.round(x + w / 2),
            y: Math.round(y + h / 2),
            left: Math.round(x),
            top: Math.round(y),
            width: Math.round(w),
            height: Math.round(h),
          },
        });
      }

      return coordinateMap;
    }

    function destroyOverlay(): void {
      const existing = document.getElementById(CANVAS_ID);
      if (existing) existing.remove();
    }

    // ── User interaction blocker ─────────────────────────────────────────────

    const BLOCKED_EVENTS = [
      'click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress',
      'scroll', 'wheel', 'touchstart', 'touchend', 'touchmove', 'input',
      'change', 'focus', 'blur', 'contextmenu', 'dblclick', 'pointerdown',
      'pointerup', 'pointermove',
    ] as const;

    function blockHandler(e: Event): void {
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    function installBlocker(): void {
      if (isBlocking) return;
      isBlocking = true;

      for (const evt of BLOCKED_EVENTS) {
        document.addEventListener(evt, blockHandler, { capture: true, passive: false });
      }

      const blocker = document.createElement('div');
      blocker.id = BLOCKER_ID;
      blocker.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: none;
        background: ${BLOCKER_BG};
        border: 4px solid ${BLOCKER_BORDER};
        cursor: not-allowed;
        box-sizing: border-box;
      `;

      const banner = document.createElement('div');
      banner.style.cssText = `
        position: absolute;
        top: 0; left: 0; right: 0;
        padding: 10px 0;
        background: ${BANNER_BG};
        color: #fff;
        font: bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        text-align: center;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        pointer-events: none;
        animation: __opticlick_pulse__ 1.5s ease-in-out infinite;
      `;
      banner.textContent = 'Opticlick Agent Running — Tab Locked';
      blocker.appendChild(banner);

      const style = document.createElement('style');
      style.textContent = `
        @keyframes __opticlick_pulse__ {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.6; }
        }
        body.${BLOCKER_ID}-active, body.${BLOCKER_ID}-active * {
          cursor: not-allowed !important;
        }
      `;
      blocker.appendChild(style);

      (document.body || document.documentElement).appendChild(blocker);
      document.body?.classList.add(`${BLOCKER_ID}-active`);
    }

    function removeBlocker(): void {
      if (!isBlocking) return;
      isBlocking = false;

      for (const evt of BLOCKED_EVENTS) {
        document.removeEventListener(evt, blockHandler, { capture: true });
      }

      const blocker = document.getElementById(BLOCKER_ID);
      if (blocker) blocker.remove();
      document.body?.classList.remove(`${BLOCKER_ID}-active`);
    }

    // ── Message handler ──────────────────────────────────────────────────────

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      switch (msg.type) {
        case 'DRAW_MARKS': {
          const map = drawOverlay();
          sendResponse({
            success: true,
            coordinateMap: map,
            dpr: window.devicePixelRatio || 1,
          });
          break;
        }

        case 'DESTROY_MARKS': {
          destroyOverlay();
          sendResponse({ success: true });
          break;
        }

        case 'BLOCK_INPUT': {
          installBlocker();
          sendResponse({ success: true });
          break;
        }

        case 'UNBLOCK_INPUT': {
          removeBlocker();
          sendResponse({ success: true });
          break;
        }

        case 'PING': {
          sendResponse({ alive: true });
          break;
        }

        default:
          break;
      }

      return true;
    });
  },
});
