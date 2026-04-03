/**
 * Chrome DevTools Protocol helpers for hardware-level input simulation.
 */

const attachedDebuggers = new Set<number>();

export async function attachDebugger(tabId: number): Promise<void> {
  if (attachedDebuggers.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  attachedDebuggers.add(tabId);
}

export async function detachDebugger(tabId: number): Promise<void> {
  if (!attachedDebuggers.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* tab may have closed */
  }
  attachedDebuggers.delete(tabId);
}

/**
 * Simulate a physical mouse click using Input.dispatchMouseEvent.
 * Coordinates MUST be pre-scaled (CSS pixels, not physical pixels).
 */
export async function dispatchHardwareClick(
  tabId: number,
  cssX: number,
  cssY: number,
): Promise<void> {
  await attachDebugger(tabId);

  const base = { x: cssX, y: cssY, button: 'left' as const, clickCount: 1 };

  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    ...base,
    type: 'mouseMoved',
    buttons: 0,
  });

  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    ...base,
    type: 'mousePressed',
    buttons: 1,
  });

  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    ...base,
    type: 'mouseReleased',
    buttons: 0,
  });
}

// Key code map for CDP keyboard events
const KEY_CODES: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  Backspace: 8,
  Delete: 46,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Space: 32,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
};

export function getKeyCode(keyName: string): number {
  return KEY_CODES[keyName] ?? keyName.charCodeAt(0);
}

// Clean up on debugger detach (tab closed / navigate)
chrome.debugger.onDetach.addListener(({ tabId }) => {
  if (tabId != null) attachedDebuggers.delete(tabId);
});
