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

    switch (method) {
      // ── Screenshot ────────────────────────────────────────────────────────
      case 'Page.captureScreenshot': {
        if (!doc?.body || !win) throw new Error('Sandbox: iframe not ready for screenshot');
        const h2c = await getHtml2Canvas();
        const canvas = await h2c(doc.body, {
          useCORS: true,
          allowTaint: true,
          scale: 1, // Cap at 1x resolution to keep performance fast and prevent thread freeze
          logging: false,
          foreignObjectRendering: false,
          width: win.innerWidth,
          height: win.innerHeight,
          scrollX: win.scrollX,
          scrollY: win.scrollY,
          windowWidth: win.innerWidth,
          windowHeight: win.innerHeight,
        });
        // Return raw base64 without data-URI prefix (matches real CDP response)
        const dataUrl = canvas.toDataURL('image/png');
        return { data: dataUrl.replace(/^data:image\/png;base64,/, '') };
      }

      // ── Mouse events ──────────────────────────────────────────────────────
      case 'Input.dispatchMouseEvent': {
        if (!win || !doc) return {};
        const { type, x = 0, y = 0, button = 'left', clickCount = 1, modifiers = 0 } = params ?? {};
        const evtType = {
          mousePressed: 'mousedown',
          mouseReleased: 'mouseup',
          mouseMoved: 'mousemove',
          mouseWheel: 'wheel',
        }[type as string] ?? (type as string);

        if (evtType === 'wheel') {
          const el = doc.elementFromPoint(x as number, y as number) ?? doc.body;
          el?.dispatchEvent(new WheelEvent('wheel', {
            clientX: x as number, clientY: y as number,
            deltaX: (params?.deltaX as number) ?? 0,
            deltaY: (params?.deltaY as number) ?? 0,
            bubbles: true, cancelable: true,
          }));
        } else {
          const btnMap: Record<string, number> = { none: 0, left: 0, middle: 1, right: 2 };
          const evtInit: PointerEventInit = {
            clientX: x as number,
            clientY: y as number,
            button: btnMap[button as string] ?? 0,
            buttons: evtType === 'mousedown' ? 1 : 0,
            bubbles: true,
            cancelable: true,
            ctrlKey: !!(modifiers as number & 2),
            shiftKey: !!(modifiers as number & 8),
            altKey: !!(modifiers as number & 1),
            metaKey: !!(modifiers as number & 4),
            detail: clickCount as number,
          };
          const el = doc.elementFromPoint(x as number, y as number) ?? doc.body;
          el?.dispatchEvent(new PointerEvent('pointer' + evtType.replace('mouse', ''), { ...evtInit, bubbles: true }));
          el?.dispatchEvent(new MouseEvent(evtType, evtInit));
          if (evtType === 'mouseup') {
            el?.dispatchEvent(new MouseEvent('click', { ...evtInit, detail: 1 }));
          }
        }
        return {};
      }

      // ── Text input ────────────────────────────────────────────────────────
      case 'Input.insertText': {
        if (!win) return {};
        const text = (params?.text as string) ?? '';
        const active = doc?.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
        if (active && ('value' in active)) {
          let proto = Object.getPrototypeOf(active);
          let nativeInputValueSetter = null;
          while (proto) {
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc?.set) {
              nativeInputValueSetter = desc.set;
              break;
            }
            proto = Object.getPrototypeOf(proto);
          }

          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(active, active.value + text);
          } else {
            active.value += text;
          }
          active.dispatchEvent(new win.InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
          active.dispatchEvent(new win.Event('change', { bubbles: true }));
        } else {
          // Fallback: contenteditable
          try { doc?.execCommand('insertText', false, text); } catch { /* */ }
        }
        return {};
      }


      // ── Key events ────────────────────────────────────────────────────────
      case 'Input.dispatchKeyEvent': {
        if (!win || !doc) return {};
        const { type: kType, key = '', code = '', modifiers = 0, windowsVirtualKeyCode = 0 } = params ?? {};
        const evtType = kType === 'keyDown' ? 'keydown' : kType === 'keyUp' ? 'keyup' : 'keypress';
        const target = doc.activeElement ?? doc.body;
        target?.dispatchEvent(new win.KeyboardEvent(evtType, {
          key: key as string,
          code: code as string,
          keyCode: windowsVirtualKeyCode as number,
          which: windowsVirtualKeyCode as number,
          ctrlKey: !!(modifiers as number & 2),
          shiftKey: !!(modifiers as number & 8),
          altKey: !!(modifiers as number & 1),
          metaKey: !!(modifiers as number & 4),
          bubbles: true,
          cancelable: true,
        }));
        return {};
      }

      // ── Runtime.evaluate ─────────────────────────────────────────────────
      case 'Runtime.evaluate': {
        if (!win) return { result: { type: 'undefined', value: undefined } };
        try {
          const expr = params?.expression as string;
          let value;
          try {
            // Attempt to treat it as a returnable expression first
            const fn = new win.Function(`return (${expr});`);
            value = fn();
          } catch {
            // Fall back to statement block execution
            const fn = new win.Function(expr);
            value = fn();
          }

          let result: Record<string, unknown> = { type: typeof value, value };
          if (value && typeof value === 'object') {
            const isDomElement = (win.HTMLElement && value instanceof win.HTMLElement) ||
                                 (typeof (value as any).nodeType === 'number');
            if (isDomElement) {
              const objectId = 'node_' + Math.random().toString(36).slice(2);
              _objectIdMap.set(objectId, value as HTMLElement);
              result = {
                type: 'object',
                subtype: 'node',
                objectId
              };
            }
          }
          return { result };
        } catch (e) {
          return { result: { type: 'undefined' }, exceptionDetails: { text: (e as Error).message } };
        }
      }



      case 'DOM.setFileInputFiles': {
        const { objectId, files } = params ?? {};
        const inputEl = _objectIdMap.get(objectId as string) as HTMLInputElement | undefined;
        if (!inputEl) {
          console.error('[sandbox] DOM.setFileInputFiles: input element not found for objectId', objectId);
          return {};
        }
        if (Array.isArray(files) && files.length > 0) {
          const fileItem = files[0];
          if (win) {
            try {
              let file: File;
              if (typeof fileItem === 'string') {
                const fileData = _virtualFiles.get(fileItem);
                if (fileData) {
                  const bytes = Uint8Array.from(atob(fileData.data), c => c.charCodeAt(0));
                  file = new win.File([bytes], fileData.filename, { type: fileData.mimeType });
                } else {
                  file = new win.File([new TextEncoder().encode(fileItem)], 'file.txt', { type: 'text/plain' });
                }
              } else if (fileItem instanceof win.File || fileItem instanceof File) {
                file = fileItem as File;
              } else if (fileItem instanceof ArrayBuffer || ArrayBuffer.isView(fileItem)) {
                file = new win.File([fileItem], 'file.bin', { type: 'application/octet-stream' });
              } else if (fileItem && typeof fileItem === 'object' && ('buffer' in fileItem || 'data' in fileItem)) {
                const data = (fileItem as any).buffer || (fileItem as any).data || fileItem;
                file = new win.File([data], 'file.bin', { type: 'application/octet-stream' });
              } else {
                file = new win.File([String(fileItem)], 'file.txt', { type: 'text/plain' });
              }

              const dt = new win.DataTransfer();
              dt.items.add(file);
              inputEl.files = dt.files;
              inputEl.dispatchEvent(new win.Event('change', { bubbles: true }));
              inputEl.dispatchEvent(new win.Event('input', { bubbles: true }));
            } catch (err) {
              console.error('[sandbox] DOM.setFileInputFiles failed to set files:', err);
            }
          }
        }
        return {};
      }

      // ── No-ops ────────────────────────────────────────────────────────────
      case 'Page.setInterceptFileChooserDialog':
      default:
        return {};
    }
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
