import type { CoordinateEntry } from '@/utils/types';
import { collectInteractables, getLabel } from './interactables';
import { getVisibleRect, isTopElementAt } from './visibility';
import { getTheme } from './theme';

const CANVAS_ID = '__opticlick_overlay__';

export function destroyOverlay(): void {
  document.getElementById(CANVAS_ID)?.remove();
}

export async function drawOverlay(): Promise<CoordinateEntry[]> {
  destroyOverlay();

  const theme = await getTheme();
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

  const coordinateMap: CoordinateEntry[] = [];

  for (const { el, rect, id } of visibleItems) {
    const x = rect.left;
    const y = rect.top;
    const w = rect.width;
    const h = rect.height;

    ctx.strokeStyle = theme.markStroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.fillStyle = theme.markFill;
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);

    const label = String(id);
    const badgeW = Math.max(label.length * 7 + 8, 20);
    const badgeH = 16;
    const badgeX = x;
    const badgeY = y - badgeH - 1;

    ctx.fillStyle = theme.badgeBg;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(badgeX, Math.max(0, badgeY), badgeW, badgeH, 3);
    } else {
      ctx.rect(badgeX, Math.max(0, badgeY), badgeW, badgeH);
    }
    ctx.fill();

    ctx.fillStyle = theme.badgeText;
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
