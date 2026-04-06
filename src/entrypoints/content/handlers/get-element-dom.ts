/**
 * GET_ELEMENT_DOM handler — fetches the full outerHTML of the element
 * closest to the provided (x, y) coordinates.
 */

export function handleGetElementDom(
  msg: { x: number; y: number },
  sendResponse: (response: unknown) => void,
): void {
  const { x, y } = msg;

  // Collect all interactables and find the one closest to (x, y).
  // We deliberately avoid elementFromPoint because the blocker overlay
  // sits on top and would return the wrong element.
  const candidates = Array.from(document.querySelectorAll('*')) as HTMLElement[];
  let closest: HTMLElement | null = null;
  let minDist = Infinity;
  for (const el of candidates) {
    if (!(el instanceof HTMLElement)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dist = Math.hypot(cx - x, cy - y);
    if (dist < minDist) {
      minDist = dist;
      closest = el;
    }
  }

  if (!closest) {
    sendResponse({ success: false, error: 'No element found near coordinates' });
    return;
  }

  const MAX_CHARS = 40_000;
  const full = closest.outerHTML;
  const truncated = full.length > MAX_CHARS;
  sendResponse({
    success: true,
    outerHTML: truncated ? full.slice(0, MAX_CHARS) + '\n<!-- [truncated] -->' : full,
    tag: closest.tagName.toLowerCase(),
    truncated,
  });
}
