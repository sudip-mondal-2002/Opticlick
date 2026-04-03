import { log } from './agent-log';
import { sleep } from './sleep';

const UNINJECTABLE_PATTERNS = /^(about:|chrome:|chrome-extension:|edge:|brave:)/;

export function sendToTab<T = unknown>(
  tabId: number,
  message: Record<string, unknown>,
  frameId = 0,
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, (response: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

export async function isTabInjectable(tabId: number): Promise<boolean> {
  const tab = await chrome.tabs.get(tabId);
  return !!tab.url && !UNINJECTABLE_PATTERNS.test(tab.url);
}

export async function waitForInjectableTab(tabId: number, timeoutMs = 30_000): Promise<void> {
  if (await isTabInjectable(tabId)) return;

  await log('Tab is on a restricted page — waiting for navigation…', 'warn');

  return new Promise((resolve, reject) => {
    let resolved = false;
    const done = (err?: Error) => {
      if (resolved) return;
      resolved = true;
      chrome.tabs.onUpdated.removeListener(listener);
      err ? reject(err) : resolve();
    };

    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (updatedTabId !== tabId) return;
      if (
        changeInfo.status === 'complete' &&
        tab.url &&
        !UNINJECTABLE_PATTERNS.test(tab.url)
      ) {
        done();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    setTimeout(
      () => done(new Error('Timed out waiting for tab to navigate to an injectable page.')),
      timeoutMs,
    );
  });
}

/**
 * Wait for a tab to finish loading. When `expectNavigation` is true the tab
 * must first enter a `loading` state before we accept `complete`, preventing
 * a race where the *old* page's `complete` status resolves the promise
 * before the new navigation even begins.
 */
export function waitForTabLoad(
  tabId: number,
  timeoutMs = 15_000,
  expectNavigation = false,
): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    let sawLoading = !expectNavigation; // skip the loading gate when not navigating

    const done = () => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId) return;
      if (!sawLoading && changeInfo.status === 'loading') {
        sawLoading = true;
      }
      if (sawLoading && changeInfo.status === 'complete') {
        done();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    // Only check current status when we're NOT expecting a fresh navigation
    if (!expectNavigation) {
      chrome.tabs
        .get(tabId)
        .then((tab) => {
          if (tab.status === 'complete') done();
        })
        .catch(done);
    }

    setTimeout(done, timeoutMs);
  });
}

export async function ensureContentScript(tabId: number): Promise<void> {
  await waitForInjectableTab(tabId);
  try {
    await sendToTab(tabId, { type: 'PING' });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content-scripts/content.js'],
    });
    await sleep(300);
  }
}
