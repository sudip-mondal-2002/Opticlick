import { attachDebugger } from './cdp';

// Minimum base64 length that indicates a real rendered frame (~5 KB decoded).
// A blank/throttled frame from a background tab is typically < 1 KB.
const MIN_VALID_B64_LENGTH = 6_000;

const RETRY_DELAYS_MS = [300, 800, 1500];

/**
 * Capture a PNG screenshot of `tabId` without switching tabs.
 *
 * Strategy:
 *  1. Use CDP `Page.captureScreenshot` with `fromSurface: true`, which reads
 *     from the tab's compositor surface rather than the physical screen buffer.
 *     This works even when the tab is not active and causes zero visible flicker.
 *  2. If the result looks blank / throttled (too small), fall back to the
 *     activate → captureVisibleTab → restore approach. This fallback may cause
 *     a brief flicker but guarantees a valid frame.
 *  3. Both paths are retried up to 3 times with backoff before throwing.
 */
export async function captureScreenshot(tabId: number): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
    }

    // Try the flicker-free CDP path first.
    try {
      await attachDebugger(tabId);
      const result = await chrome.debugger.sendCommand(
        { tabId },
        'Page.captureScreenshot',
        { format: 'png', fromSurface: true },
      ) as { data: string };

      if (result?.data && result.data.length >= MIN_VALID_B64_LENGTH) {
        return result.data; // Already raw base64 — no data-URI prefix.
      }
    } catch (err) {
      lastError = err;
      // Debugger may not be attachable (e.g. chrome:// pages); try fallback below.
    }

    // Fallback: temporarily activate the target tab so captureVisibleTab works.
    try {
      const tab = await chrome.tabs.get(tabId);
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      const needsSwitch = activeTab?.id !== tabId;

      if (needsSwitch) {
        await chrome.tabs.update(tabId, { active: true });
        await new Promise<void>((resolve) => setTimeout(resolve, 150));
      }

      let dataUrl: string;
      try {
        dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png', quality: 90 });
      } finally {
        if (needsSwitch && activeTab?.id != null) {
          await chrome.tabs.update(activeTab.id, { active: true });
        }
      }

      return dataUrl.replace(/^data:image\/png;base64,/, '');
    } catch (err) {
      lastError = err;
      // Will retry after delay.
    }
  }

  throw lastError ?? new Error('captureScreenshot: all attempts failed');
}
