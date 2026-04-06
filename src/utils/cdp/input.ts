/**
 * CDP hardware-level input simulation: mouse clicks, keyboard, scrolling, text.
 */

import { attachDebugger } from './core';

export const CDP_MODIFIER: Record<string, number> = {
  alt: 1, ctrl: 2, meta: 4, shift: 8,
};

const KEY_CODES: Record<string, number> = {
  Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  Space: 32, Home: 36, End: 35, PageUp: 33, PageDown: 34,
};

export function getKeyCode(keyName: string): number {
  return KEY_CODES[keyName] ?? keyName.charCodeAt(0);
}

/**
 * Simulate a physical mouse click via Input.dispatchMouseEvent.
 * Coordinates must be pre-scaled to CSS pixels (not physical/device pixels).
 */
export async function dispatchHardwareClick(tabId: number, cssX: number, cssY: number, modifiers = 0): Promise<void> {
  await attachDebugger(tabId);
  const base = { x: cssX, y: cssY, button: 'left' as const, clickCount: 1, modifiers };
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', buttons: 0 });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed', buttons: 1 });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 });
}

/**
 * Clears the currently focused editable element in the page.
 * Exported for direct use in DOM tests (jsdom).
 */
export function clearFocusedField(): void {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, '');
    else el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (el.isContentEditable || el.contentEditable === 'true') {
    document.execCommand('selectAll', false, undefined);
  }
}

/**
 * Type text into the currently focused element via CDP.
 * When clearField is true, `clearFocusedField()` is injected first.
 */
export async function typeTextCDP(tabId: number, text: string, clearField = false): Promise<void> {
  await attachDebugger(tabId);
  if (clearField) {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `(${clearFocusedField.toString()})()`, awaitPromise: false,
    });
  }
  await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
}

/** Simulate a hardware mouse-wheel scroll event via CDP. */
export async function dispatchScrollWheel(tabId: number, cssX: number, cssY: number, deltaX: number, deltaY: number): Promise<void> {
  await attachDebugger(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: cssX, y: cssY, deltaX, deltaY,
  });
}
