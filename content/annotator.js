/**
 * annotator.js — Opticlick Content Script
 *
 * Responsibilities:
 *  1. Discover all interactable elements (including inside open Shadow DOMs).
 *  2. Filter out occluded / invisible elements via elementFromPoint checks.
 *  3. Render a single unified <canvas> overlay with numbered bounding boxes.
 *  4. Block all user input while the agent loop is active.
 *  5. Return the coordinate map back to the background service worker.
 *  6. Destroy the canvas on command (post-screenshot).
 */

(() => {
  // ── Constants ──────────────────────────────────────────────────────────────

  const CANVAS_ID   = '__opticlick_overlay__';
  const BLOCKER_ID  = '__opticlick_blocker__';

  // Interactive ARIA roles that imply clickability
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'radio', 'checkbox', 'tab', 'treeitem', 'gridcell',
    'combobox', 'listbox', 'slider', 'spinbutton', 'switch',
    'textbox', 'searchbox', 'columnheader', 'rowheader',
  ]);

  // Semantic tags that are inherently interactable
  const INTERACTIVE_TAGS = new Set([
    'a', 'button', 'input', 'select', 'textarea', 'label',
    'summary', 'details', 'video', 'audio',
  ]);

  // ── State ──────────────────────────────────────────────────────────────────

  let coordinateMap = [];   // [{ id, tag, text, rect: {x,y,w,h} }]
  let isBlocking    = false;

  // ── Shadow DOM piercing element collector ──────────────────────────────────

  /**
   * Recursively walk the DOM (and any open Shadow Roots) to collect
   * all potentially interactable leaf nodes.
   */
  function collectInteractables(root, results = []) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      null,
    );

    let node;
    while ((node = walker.nextNode())) {
      if (isInteractable(node)) {
        results.push(node);
      }
      // Pierce open shadow roots
      if (node.shadowRoot) {
        collectInteractables(node.shadowRoot, results);
      }
    }
    return results;
  }

  function isInteractable(el) {
    const tag  = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();

    if (INTERACTIVE_TAGS.has(tag)) {
      // Skip disabled inputs
      if (el.disabled) return false;
      // Skip hidden inputs
      if (tag === 'input' && el.type === 'hidden') return false;
      return true;
    }

    if (INTERACTIVE_ROLES.has(role)) return true;

    // tabIndex >= 0 makes arbitrary elements keyboard-focusable / clickable
    if (el.hasAttribute('tabindex') && parseInt(el.getAttribute('tabindex'), 10) >= 0) return true;

    // cursor: pointer heuristic (computed style)
    try {
      const style = window.getComputedStyle(el);
      if (style.cursor === 'pointer') return true;
    } catch (_) { /* cross-origin frame guard */ }

    // onclick / event handler attributes
    if (el.onclick || el.hasAttribute('onclick') || el.hasAttribute('ng-click')
        || el.hasAttribute('@click') || el.hasAttribute('v-on:click')) return true;

    return false;
  }

  // ── Visibility & Occlusion filter ──────────────────────────────────────────

  function getVisibleRect(el) {
    let rect;
    try {
      rect = el.getBoundingClientRect();
    } catch (_) {
      return null;
    }

    if (rect.width <= 2 || rect.height <= 2) return null;
    if (rect.bottom < 0 || rect.right < 0) return null;
    if (rect.top  > window.innerHeight || rect.left > window.innerWidth) return null;

    // Visibility / display checks
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
        return null;
      }
    } catch (_) { /* ignore */ }

    return rect;
  }

  /**
   * Sample several points within the element's bounding rect to verify it
   * is not fully occluded by a higher z-index sibling.
   */
  function isTopElementAt(el, rect) {
    const points = [
      [rect.left  + rect.width  * 0.5, rect.top + rect.height * 0.5],  // centre
      [rect.left  + 4,                 rect.top + 4],                   // top-left
      [rect.right - 4,                 rect.bottom - 4],                // bottom-right
    ];

    for (const [x, y] of points) {
      try {
        const top = document.elementFromPoint(x, y);
        if (!top) continue;
        if (el === top || el.contains(top) || top.contains(el)) return true;
      } catch (_) { /* cross-origin */ }
    }
    return false;
  }

  // ── Text label helper ──────────────────────────────────────────────────────

  function getLabel(el) {
    const tag = el.tagName.toLowerCase();

    // Prefer accessible name sources
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim().slice(0, 40);

    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const ref = document.getElementById(ariaLabelledBy);
      if (ref) return ref.textContent.trim().slice(0, 40);
    }

    if (tag === 'input') {
      return (el.placeholder || el.name || el.type || 'input').slice(0, 40);
    }

    const text = el.textContent.trim().replace(/\s+/g, ' ');
    if (text) return text.slice(0, 40);

    return tag;
  }

  // ── Canvas overlay ─────────────────────────────────────────────────────────

  function drawOverlay() {
    destroyOverlay(); // Ensure no duplicate

    const dpr    = window.devicePixelRatio || 1;
    const width  = window.innerWidth;
    const height = window.innerHeight;

    // ── Phase 1: collect & filter BEFORE canvas exists ────────────────────────
    // elementFromPoint must run with no canvas in the DOM. Even with
    // pointer-events:none, a fixed full-viewport canvas sits at the top of the
    // stacking context and causes elementFromPoint to return the canvas instead
    // of the underlying element, making every isTopElementAt check fail.
    const root = document.body || document.documentElement;
    const interactables = collectInteractables(root);

    console.log(`[Opticlick] collectInteractables found ${interactables.length} candidates (frame: ${window === window.top ? 'TOP' : 'IFRAME'}, URL: ${location.href.slice(0, 80)})`);

    const visibleItems = [];
    let nextId       = 1;
    let filteredRect = 0;
    let filteredTop  = 0;

    for (const el of interactables) {
      const rect = getVisibleRect(el);
      if (!rect) { filteredRect++; continue; }
      if (!isTopElementAt(el, rect)) { filteredTop++; continue; }
      visibleItems.push({ el, rect, id: nextId++ });
    }

    console.log(`[Opticlick] Filter results — visible: ${visibleItems.length}, filtered-rect: ${filteredRect}, filtered-occlusion: ${filteredTop}`);

    // ── Phase 2: attach canvas, then draw boxes ───────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.id            = CANVAS_ID;
    canvas.width         = Math.round(width  * dpr);
    canvas.height        = Math.round(height * dpr);
    canvas.style.cssText = `
      position: fixed;
      top: 0; left: 0;
      width: ${width}px;
      height: ${height}px;
      z-index: 2147483647;
      pointer-events: none;
    `;

    (document.body || document.documentElement).appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    coordinateMap = [];

    for (const { el, rect, id } of visibleItems) {
      const x = rect.left;
      const y = rect.top;
      const w = rect.width;
      const h = rect.height;

      // Bounding box
      ctx.strokeStyle = '#6c63ff';
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      // Light fill tint
      ctx.fillStyle = 'rgba(108, 99, 255, 0.08)';
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);

      // ID badge
      const label  = String(id);
      const badgeW = Math.max(label.length * 7 + 8, 20);
      const badgeH = 16;
      const badgeX = x;
      const badgeY = y - badgeH - 1;

      ctx.fillStyle = '#6c63ff';
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(badgeX, Math.max(0, badgeY), badgeW, badgeH, 3)
        : ctx.rect(badgeX, Math.max(0, badgeY), badgeW, badgeH);
      ctx.fill();

      ctx.fillStyle    = '#ffffff';
      ctx.font         = 'bold 10px -apple-system, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, badgeX + 4, Math.max(badgeH / 2, badgeY + badgeH / 2));

      coordinateMap.push({
        id,
        tag:  el.tagName.toLowerCase(),
        text: getLabel(el),
        rect: {
          x:      Math.round(x + w / 2),
          y:      Math.round(y + h / 2),
          left:   Math.round(x),
          top:    Math.round(y),
          width:  Math.round(w),
          height: Math.round(h),
        },
      });
    }

    return coordinateMap;
  }

  function destroyOverlay() {
    const existing = document.getElementById(CANVAS_ID);
    if (existing) existing.remove();
  }

  // ── User interaction blocker ───────────────────────────────────────────────

  const BLOCKED_EVENTS = ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress',
                          'scroll', 'wheel', 'touchstart', 'touchend', 'touchmove', 'input',
                          'change', 'focus', 'blur', 'contextmenu', 'dblclick', 'pointerdown',
                          'pointerup', 'pointermove'];

  function blockHandler(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function installBlocker() {
    if (isBlocking) return;
    isBlocking = true;

    for (const evt of BLOCKED_EVENTS) {
      document.addEventListener(evt, blockHandler, { capture: true, passive: false });
    }

    // Full-screen orange overlay so the user clearly sees the tab is locked
    const blocker = document.createElement('div');
    blocker.id = BLOCKER_ID;
    blocker.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
      background: rgba(255, 140, 0, 0.18);
      border: 4px solid rgba(255, 140, 0, 0.7);
      cursor: not-allowed;
      box-sizing: border-box;
    `;

    // Pulsing banner at the top
    const banner = document.createElement('div');
    banner.style.cssText = `
      position: absolute;
      top: 0; left: 0; right: 0;
      padding: 10px 0;
      background: rgba(255, 100, 0, 0.92);
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

    // Inject keyframes for the pulse animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes __opticlick_pulse__ {
        0%, 100% { opacity: 1; }
        50%      { opacity: 0.6; }
      }
      #${BLOCKER_ID} ~ *, #${BLOCKER_ID} ~ *::before, #${BLOCKER_ID} ~ *::after {
        cursor: not-allowed !important;
      }
      body.${BLOCKER_ID}-active, body.${BLOCKER_ID}-active * {
        cursor: not-allowed !important;
      }
    `;
    blocker.appendChild(style);

    (document.body || document.documentElement).appendChild(blocker);
    document.body.classList.add(`${BLOCKER_ID}-active`);
  }

  function removeBlocker() {
    if (!isBlocking) return;
    isBlocking = false;

    for (const evt of BLOCKED_EVENTS) {
      document.removeEventListener(evt, blockHandler, { capture: true });
    }

    const blocker = document.getElementById(BLOCKER_ID);
    if (blocker) blocker.remove();
    document.body?.classList.remove(`${BLOCKER_ID}-active`);
  }

  // ── Message handler ────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {

      case 'DRAW_MARKS': {
        const map = drawOverlay();
        sendResponse({ success: true, coordinateMap: map, dpr: window.devicePixelRatio || 1 });
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

    // Return true to keep channel open for async sendResponse
    return true;
  });

})();
