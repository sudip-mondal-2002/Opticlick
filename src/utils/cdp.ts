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
 * CDP modifier bitmask values for Input.dispatchMouseEvent.
 * Multiple modifiers can be OR-ed together.
 */
export const CDP_MODIFIER: Record<string, number> = {
  alt:   1,
  ctrl:  2,
  meta:  4,  // Cmd on macOS, Windows key on Windows
  shift: 8,
};

/**
 * Simulate a physical mouse click using Input.dispatchMouseEvent.
 * Coordinates MUST be pre-scaled (CSS pixels, not physical pixels).
 * Pass a non-zero `modifiers` bitmask (see CDP_MODIFIER) for modifier+click,
 * e.g. Ctrl+Click to open a link in a new tab.
 */
export async function dispatchHardwareClick(
  tabId: number,
  cssX: number,
  cssY: number,
  modifiers = 0,
): Promise<void> {
  await attachDebugger(tabId);

  const base = { x: cssX, y: cssY, button: 'left' as const, clickCount: 1, modifiers };

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
if (typeof chrome !== 'undefined' && chrome?.debugger?.onDetach) {
  chrome.debugger.onDetach.addListener(({ tabId }) => {
    if (tabId != null) attachedDebuggers.delete(tabId);
  });
}

/**
 * Clears the currently focused editable element in the page.
 *
 * Exported so this exact function can be called directly in DOM tests (jsdom),
 * making the tests actually exercise the logic rather than just checking strings.
 *
 * - input / textarea  : native prototype value setter + input event (bypasses
 *                       React/Vue/Angular synthetic event wrappers)
 * - contenteditable   : execCommand('selectAll') so the subsequent
 *                       Input.insertText replaces the selection. Direct
 *                       innerHTML/textContent mutation is avoided because it
 *                       breaks framework-managed rich editors (Gemini, Gmail…).
 *
 * Called via Runtime.evaluate in typeTextCDP; serialised with .toString().
 */
export function clearFocusedField(): void {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return;

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    // Native setter bypasses React's synthetic event system
    const proto =
      el instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, '');
    else el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (el.isContentEditable || el.contentEditable === 'true') {
    // Select-all so Input.insertText replaces the entire content.
    // execCommand is the only cross-framework way to establish a real selection
    // in contenteditable (Gemini, Gmail, Notion, etc.).
    document.execCommand('selectAll', false, undefined);
  }
}

/**
 * Type text into the currently focused element via CDP.
 *
 * When clearField is true, clearFocusedField() is injected into the page via
 * Runtime.evaluate first. It handles both regular inputs/textareas (native
 * value setter) and contenteditable divs (select-all so insertText replaces).
 * CDP key events are NOT used — they don't produce a real selection.
 */
export async function typeTextCDP(
  tabId: number,
  text: string,
  clearField = false,
): Promise<void> {
  await attachDebugger(tabId);

  if (clearField) {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `(${clearFocusedField.toString()})()`,
      awaitPromise: false,
    });
  }

  await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
}

// ─── CDP-based file upload (DOM.setFileInputFiles) ───────────────────────────
// This is the Puppeteer/Playwright approach: write a temp file to disk via
// chrome.downloads, pass the OS path to CDP, then clean up. It triggers the
// browser's native file-selection flow, producing trusted events that work
// with every JS framework and upload widget.

/** IDs of our own temp downloads — exported so the download interceptor can skip them. */
export const tempDownloadIds = new Set<number>();

/**
 * Write base64 data to a temp file on disk via chrome.downloads.
 * Returns the download ID (for cleanup) and the absolute OS file path.
 */
export function writeTempFile(
  base64Data: string,
  filename: string,
  mimeType: string,
): Promise<{ downloadId: number; filePath: string }> {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: dataUrl,
        filename: `_opticlick_tmp/${safeFilename}`,
        conflictAction: 'overwrite',
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        tempDownloadIds.add(downloadId);

        const onChange = (delta: chrome.downloads.DownloadDelta) => {
          if (delta.id !== downloadId) return;
          if (delta.state?.current === 'complete') {
            chrome.downloads.onChanged.removeListener(onChange);
            chrome.downloads.search({ id: downloadId }, (items) => {
              const path = items?.[0]?.filename;
              if (path) {
                resolve({ downloadId, filePath: path });
              } else {
                tempDownloadIds.delete(downloadId);
                reject(new Error('Temp download finished but path unknown'));
              }
            });
          }
          if (delta.state?.current === 'interrupted') {
            chrome.downloads.onChanged.removeListener(onChange);
            tempDownloadIds.delete(downloadId);
            reject(new Error('Temp download interrupted'));
          }
        };
        chrome.downloads.onChanged.addListener(onChange);
      },
    );
  });
}

/** Remove the temp file and erase the download entry from Chrome's list. */
export async function cleanupTempFile(downloadId: number): Promise<void> {
  tempDownloadIds.delete(downloadId);
  try { await chrome.downloads.removeFile(downloadId); } catch { /* already gone */ }
  try { await chrome.downloads.erase({ id: downloadId }); } catch { /* */ }
}

// ─── File upload via CDP ─────────────────────────────────────────────────────
//
// DOM.setFileInputFiles is the CDP command for setting files on <input type="file">.
// It fires trusted change + input events internally (verified from Chromium source).
// It never opens a file dialog — it sets files directly on the DOM node.
//
// We find the input via Runtime.evaluate (stable objectId, survives DOM mutations)
// and set files. No clicking, no dialogs, no risk of a rogue OS file picker.

/**
 * Set file(s) on an <input type="file"> via CDP.
 *
 * Uses Runtime.evaluate to get a stable objectId (not nodeId which goes stale),
 * then calls DOM.setFileInputFiles which fires trusted change + input events.
 *
 * Never opens a file dialog. Never clicks anything.
 *
 * Throws if no <input type="file"> exists in the page.
 */
/** @internal — test only. Clears the module-level attachedDebuggers Set between tests. */
export function _resetAttachedDebuggers(): void {
  attachedDebuggers.clear();
}

export async function setFileInputFiles(
  tabId: number,
  filePaths: string[],
): Promise<void> {
  await attachDebugger(tabId);

  const evalResult = (await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
    expression: `document.querySelector('input[type="file"]')`,
  })) as { result: { objectId?: string; subtype?: string } };

  const objectId = evalResult?.result?.objectId;
  if (!objectId || evalResult.result.subtype === 'null') {
    throw new Error('No <input type="file"> found in page');
  }

  await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', {
    objectId,
    files: filePaths,
  });
}
