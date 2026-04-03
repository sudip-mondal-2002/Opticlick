import { getTheme } from './theme';

const BLOCKER_ID = '__opticlick_blocker__';

const BLOCKED_EVENTS = [
  'click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress',
  'scroll', 'wheel', 'touchstart', 'touchend', 'touchmove', 'input',
  'change', 'focus', 'blur', 'contextmenu', 'dblclick', 'pointerdown',
  'pointerup', 'pointermove',
] as const;

let isBlocking = false;

function blockHandler(e: Event): void {
  e.preventDefault();
  e.stopImmediatePropagation();
}

export async function installBlocker(): Promise<void> {
  if (isBlocking) return;
  isBlocking = true;

  const theme = await getTheme();

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
    background: ${theme.blockerBg};
    border: 4px solid ${theme.blockerBorder};
    cursor: not-allowed;
    box-sizing: border-box;
  `;

  const banner = document.createElement('div');
  banner.style.cssText = `
    position: absolute;
    top: 0; left: 0; right: 0;
    padding: 10px 0;
    background: ${theme.bannerBg};
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

export function removeBlocker(): void {
  if (!isBlocking) return;
  isBlocking = false;

  for (const evt of BLOCKED_EVENTS) {
    document.removeEventListener(evt, blockHandler, { capture: true });
  }

  document.getElementById(BLOCKER_ID)?.remove();
  document.body?.classList.remove(`${BLOCKER_ID}-active`);
}
