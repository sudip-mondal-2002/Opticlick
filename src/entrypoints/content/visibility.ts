export function getVisibleRect(el: Element): DOMRect | null {
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

export function isTopElementAt(el: Element, rect: DOMRect): boolean {
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
