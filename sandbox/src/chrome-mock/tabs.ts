/**
 * chrome.tabs shim
 *
 * Manages the mock browser iframe. Other shims import getIframe() to interact
 * with the controlled page.
 */

let iframeEl: HTMLIFrameElement | null = null;
let currentUrl = 'https://example.com';
let tabUpdateListeners: Array<(tabId: number, changeInfo: Partial<chrome.tabs.TabChangeInfo>, tab: Partial<chrome.tabs.Tab>) => void> = [];

const MOCK_TAB_ID = 1;

export function setIframeRef(el: HTMLIFrameElement) {
  iframeEl = el;
}

export function getIframe(): HTMLIFrameElement | null {
  return iframeEl;
}

export function setCurrentUrl(url: string) {
  currentUrl = url;
}

export function getCurrentUrl(): string {
  return currentUrl;
}

const BASE_URL = import.meta.env.BASE_URL || '/';
const PROXY_PREFIX = `${BASE_URL.endsWith('/') ? BASE_URL : BASE_URL + '/'}__proxy__/`;

export function proxyUrl(url: string): string {
  // Proxy through service worker for cross-origin pages
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return `${PROXY_PREFIX}?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function makeMockTab(url = currentUrl): chrome.tabs.Tab {
  return {
    id: MOCK_TAB_ID,
    index: 0,
    windowId: 1,
    active: true,
    pinned: false,
    highlighted: true,
    incognito: false,
    selected: true,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    url,
    title: 'Sandbox Tab',
    status: 'complete',
  } as chrome.tabs.Tab;
}

export const tabsShim = {
  query(_info: object, callback?: (tabs: chrome.tabs.Tab[]) => void): Promise<chrome.tabs.Tab[]> {
    const result = [makeMockTab()];
    callback?.(result);
    return Promise.resolve(result);
  },

  get(tabId: number, callback?: (tab: chrome.tabs.Tab) => void): Promise<chrome.tabs.Tab> {
    const tab = makeMockTab();
    callback?.(tab);
    return Promise.resolve(tab);
  },

  update(_tabId: number, props: chrome.tabs.UpdateProperties, callback?: (tab?: chrome.tabs.Tab) => void): Promise<chrome.tabs.Tab | undefined> {
    if (props.url && iframeEl) {
      const targetUrl = props.url;
      currentUrl = targetUrl;
      iframeEl.src = proxyUrl(targetUrl);
      // Fire onUpdated: loading
      tabUpdateListeners.forEach(l => l(MOCK_TAB_ID, { status: 'loading', url: targetUrl }, makeMockTab(targetUrl)));
      // Fire onUpdated: complete after load
      iframeEl.onload = () => {
        tabUpdateListeners.forEach(l => l(MOCK_TAB_ID, { status: 'complete', url: targetUrl }, makeMockTab(targetUrl)));
      };
    }
    const tab = makeMockTab();
    callback?.(tab);
    return Promise.resolve(tab);
  },

  captureVisibleTab(_windowId?: number, _options?: object, callback?: (dataUrl: string) => void): Promise<string> {
    // Handled by debugger shim — returns empty here as fallback
    callback?.('');
    return Promise.resolve('');
  },

  sendMessage(tabId: number, message: unknown, _options?: object, callback?: (response: unknown) => void): Promise<unknown> {
    // Handled by messaging shim
    if (iframeEl?.contentWindow) {
      iframeEl.contentWindow.postMessage({ __opticlick__: true, ...( typeof message === 'object' ? message : { message }) }, '*');
    }
    callback?.(undefined);
    return Promise.resolve(undefined);
  },

  onUpdated: {
    addListener(cb: (tabId: number, changeInfo: Partial<chrome.tabs.TabChangeInfo>, tab: Partial<chrome.tabs.Tab>) => void) {
      tabUpdateListeners.push(cb as any);
    },
    removeListener(cb: any) {
      tabUpdateListeners = tabUpdateListeners.filter(l => l !== cb);
    },
    hasListener: () => false,
  },
};
