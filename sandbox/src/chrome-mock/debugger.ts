/**
 * chrome.debugger shim
 *
 * Replaces all CDP chrome.debugger.sendCommand calls with iframe-native equivalents.
 * Key replacements:
 *   Page.captureScreenshot → html2canvas
 *   Input.dispatchMouseEvent → PointerEvent/MouseEvent dispatch in iframe
 *   Input.insertText → execCommand / InputEvent
 *   Input.dispatchKeyEvent → KeyboardEvent dispatch
 *   Runtime.evaluate → iframe.contentWindow.eval()
 *   Page.setInterceptFileChooserDialog → no-op
 *   DOM.setFileInputFiles → no-op
 */

import { getIframe } from './tabs';
import { defaultCDPRegistry, type CDPContext } from './cdp-handlers';

let html2canvasLib: ((el: HTMLElement, opts?: object) => Promise<HTMLCanvasElement>) | null = null;

const _objectIdMap = new Map<string, HTMLElement>();
const _virtualFiles = new Map<string, { data: string; filename: string; mimeType: string }>();
const _downloadIdMap = new Map<number, string>();


// ── Named exports required by @/utils/cdp imports ─────────────────────────────
// The real cdp/ module exports these; Vite aliases @/utils/cdp to this file.

export const tempDownloadIds = new Set<number>(); // no-op: downloads not supported in sandbox
export const CDP_MODIFIER: Record<string, number> = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

const _attachedDebuggers = new Set<number>();

export async function attachDebugger(tabId: number): Promise<void> {
  _attachedDebuggers.add(tabId);
}

export async function detachDebugger(tabId: number): Promise<void> {
  _attachedDebuggers.delete(tabId);
}

export function _resetAttachedDebuggers(): void {
  _attachedDebuggers.clear();
}

export function getKeyCode(keyName: string): number {
  const KEY_CODES: Record<string, number> = {
    Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
    ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
    Space: 32, Home: 36, End: 35, PageUp: 33, PageDown: 34,
  };
  return KEY_CODES[keyName] ?? keyName.charCodeAt(0);
}

export async function dispatchHardwareClick(tabId: number, cssX: number, cssY: number, modifiers = 0): Promise<void> {
  await debuggerShim.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: cssX, y: cssY, button: 'left', buttons: 0, modifiers });
  await debuggerShim.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cssX, y: cssY, button: 'left', buttons: 1, clickCount: 1, modifiers });
  await debuggerShim.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cssX, y: cssY, button: 'left', buttons: 0, clickCount: 1, modifiers });
}

export async function typeTextCDP(tabId: number, text: string, _clearField = false): Promise<void> {
  await debuggerShim.sendCommand({ tabId }, 'Input.insertText', { text });
}

export async function dispatchScrollWheel(tabId: number, cssX: number, cssY: number, deltaX: number, deltaY: number): Promise<void> {
  await debuggerShim.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: cssX, y: cssY, deltaX, deltaY });
}
export async function dispatchDragAndDrop(
    _tabId: number,
    _sourceCoords: { x: number; y: number },
    _targetCoords: { x: number; y: number },
  ): Promise<void> {
    // no-op sandbox implementation
}

// File upload helpers — mock implementation to persist base64 data for sandbox DOM.setFileInputFiles
export async function writeTempFile(
  base64Data: string, filename: string, mimeType: string,
): Promise<{ downloadId: number; filePath: string }> {
  const downloadId = Math.floor(Math.random() * 1000000);
  const filePath = `/tmp/opticlick_upload_${downloadId}_${filename}`;
  _virtualFiles.set(filePath, { data: base64Data, filename, mimeType });
  _downloadIdMap.set(downloadId, filePath);
  return { downloadId, filePath };
}

export async function cleanupTempFile(downloadId: number): Promise<void> {
  const filePath = _downloadIdMap.get(downloadId);
  if (filePath) {
    _virtualFiles.delete(filePath);
    _downloadIdMap.delete(downloadId);
  }
}


async function getHtml2Canvas() {
  if (html2canvasLib) return html2canvasLib;
  // Dynamic import — bundled by vite
  const mod = await import('html2canvas');
  html2canvasLib = mod.default;
  return html2canvasLib;
}

const attachedTabs = new Set<number>();

export const debuggerShim = {
  attach(_target: object, _version: string): Promise<void> {
    const t = _target as { tabId?: number };
    if (t.tabId != null) attachedTabs.add(t.tabId);
    return Promise.resolve();
  },

  detach(_target: object): Promise<void> {
    const t = _target as { tabId?: number };
    if (t.tabId != null) attachedTabs.delete(t.tabId);
    return Promise.resolve();
  },

  async sendCommand(
    _target: object,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    const iframe = getIframe();
    const win = iframe?.contentWindow;
    const doc = iframe?.contentDocument;

    const handler = defaultCDPRegistry.get(method);
    if (handler) {
      const ctx: CDPContext = {
        win,
        doc,
        objectIdMap: _objectIdMap,
        virtualFiles: _virtualFiles,
        getHtml2Canvas,
      };
      return handler.execute(params, ctx);
    }
    return {};
  },


  onEvent: {
    addListener(_cb: unknown) {},
    removeListener(_cb: unknown) {},
    hasListener: () => false,
  },

  onDetach: {
    addListener(_cb: unknown) {},
    removeListener(_cb: unknown) {},
    hasListener: () => false,
  },
};
