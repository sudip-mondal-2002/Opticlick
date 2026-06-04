/**
 * Replaces chrome.tabs.sendMessage and the content script messaging channel.
 *
 * It bridges the window.postMessage bridge between the sandbox parent window
 * and the proxied iframe.
 */

import { getIframe } from './tabs';

type PendingReply = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingReplies = new Map<string, PendingReply>();

window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data?.__opticlick_reply__) return;
  const { id, response } = data;
  const pending = pendingReplies.get(id);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingReplies.delete(id);
    pending.resolve(response);
  }
});

/**
 * Sends a message directly to the iframe content context.
 * Replaces chrome.tabs.sendMessage directly.
 */
export function sendToIframe(message: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const iframe = getIframe();
    if (!iframe?.contentWindow) {
      resolve(undefined);
      return;
    }

    const id = Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => {
      pendingReplies.delete(id);
      resolve(undefined);
    }, 3000);

    pendingReplies.set(id, { resolve, reject, timeout });
    iframe.contentWindow.postMessage({ __opticlick__: true, id, ...message }, '*');
  });
}

/**
 * sendToTab replacement used by background agent loop to draw marks/block inputs.
 */
export async function sendToTabShim<T = any>(
  _tabId: number,
  message: Record<string, any>
): Promise<T> {
  return sendToIframe(message) as Promise<T>;
}

export async function isTabInjectableShim(_tabId: number): Promise<boolean> {
  return true;
}

export async function waitForInjectableTabShim(_tabId: number, _timeoutMs?: number): Promise<void> {
  return;
}

export function waitForTabLoadShim(_tabId: number, _timeoutMs?: number): Promise<void> {
  const iframe = getIframe();
  if (!iframe) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    iframe.addEventListener('load', done, { once: true });
    setTimeout(done, _timeoutMs ?? 15000);
  });
}

export async function retryTabUpdateShim(
  tabId: number,
  props: chrome.tabs.UpdateProperties
): Promise<chrome.tabs.Tab> {
  const { tabsShim } = await import('./tabs');
  return tabsShim.update(tabId, props) as Promise<chrome.tabs.Tab>;
}

export async function ensureContentScriptShim(_tabId: number): Promise<void> {
  try {
    await sendToIframe({ type: 'PING' });
  } catch {
    // Expected if iframe not yet fully loaded
  }
}

// Map exports to expected helper paths
export const sendToTab = sendToTabShim;
export const isTabInjectable = isTabInjectableShim;
export const waitForInjectableTab = waitForInjectableTabShim;
export const waitForTabLoad = waitForTabLoadShim;
export const retryTabUpdate = retryTabUpdateShim;
export const ensureContentScript = ensureContentScriptShim;
