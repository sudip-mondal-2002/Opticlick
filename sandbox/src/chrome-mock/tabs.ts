/**
 * chrome.tabs shim
 *
 * Manages the mock browser iframe. Other shims import getIframe() to interact
 * with the controlled page.
 */

let iframeEl: HTMLIFrameElement | null = null;
let currentUrl = 'https://example.com';
let tabUpdateListeners: Array<(tabId: number, changeInfo: Partial<chrome.tabs.TabChangeInfo>, tab: Partial<chrome.tabs.Tab>) => void> = [];

let nextTabId = 1;

let tabs: chrome.tabs.Tab[] = [
  {
    id: nextTabId++,
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
    url: currentUrl,
    title: 'Sandbox Tab',
    status: 'complete',
  } as chrome.tabs.Tab,
];

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

function createTab(url: string, active = true): chrome.tabs.Tab {
  return {
    id: nextTabId++,
    index: tabs.length,
    windowId: 1,
    active,
    pinned: false,
    highlighted: active,
    incognito: false,
    selected: active,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    url,
    title: 'Sandbox Tab',
    status: 'complete',
  } as chrome.tabs.Tab;
}

export const tabsShim = {
  create(
    props: chrome.tabs.CreateProperties,
    callback?: (tab: chrome.tabs.Tab) => void,
  ): Promise<chrome.tabs.Tab> {
    const url = props.url ?? currentUrl;

    tabs.forEach(t => {
      t.active = false;
      t.highlighted = false;
    });

    const newTab = createTab(url, true);

    tabs.push(newTab);

    currentUrl = url;

    if (iframeEl) {
      iframeEl.src = proxyUrl(url);
    }

    callback?.(newTab);

    return Promise.resolve(newTab);
  },

remove(
  _tabIds: number | number[],
  callback?: () => void,
): Promise<void> {
  const ids = Array.isArray(_tabIds) ? _tabIds : [_tabIds];

  tabs = tabs.filter(t => t.id !== undefined && !ids.includes(t.id));

  if (tabs.length > 0 && !tabs.some(t => t.active)) {
    tabs[0].active = true;
    tabs[0].highlighted = true;

    currentUrl = tabs[0].url ?? currentUrl;

    if (iframeEl && tabs[0].url) {
      iframeEl.src = proxyUrl(tabs[0].url);
    }
  }

  callback?.();

  return Promise.resolve();
},
  
  query(_info: object, callback?: (tabs: chrome.tabs.Tab[]) => void): Promise<chrome.tabs.Tab[]> {
    const result = [...tabs];
    callback?.(result);
    return Promise.resolve(result);
  },

  get(tabId: number, callback?: (tab: chrome.tabs.Tab) => void): Promise<chrome.tabs.Tab> {
    const tab = tabs.find(t => t.id === tabId);

    if (!tab) {
      throw new Error(`Tab ${tabId} not found`);
    }

    callback?.(tab);

    return Promise.resolve(tab);
  },

update(
  _tabId: number,
  props: chrome.tabs.UpdateProperties,
  callback?: (tab?: chrome.tabs.Tab) => void,
): Promise<chrome.tabs.Tab | undefined> {
  const tab = tabs.find(t => t.id === _tabId);

  if (!tab) {
    return Promise.resolve(undefined);
  }

  if (props.active === true) {
    tabs.forEach(t => {
      t.active = false;
      t.highlighted = false;
    });

    tab.active = true;
    tab.highlighted = true;
  }

  if (props.url) {
    tab.url = props.url;
    currentUrl = props.url;

    if (iframeEl) {
      iframeEl.src = proxyUrl(props.url);
    }
  }

  callback?.(tab);

  return Promise.resolve(tab);
},

  captureVisibleTab(_windowId?: number, _options?: object, callback?: (dataUrl: string) => void): Promise<string> {
    // Handled by debugger shim — returns empty here as fallback
    callback?.('');
    return Promise.resolve('');
  },

  sendMessage(_tabId: number, message: unknown, _options?: object, callback?: (response: unknown) => void): Promise<unknown> {
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

  onCreated: {
    addListener(cb: (tab: chrome.tabs.Tab) => void) {},
    removeListener(cb: any) {},
    hasListener: () => false,
  },
};

