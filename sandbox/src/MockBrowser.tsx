import React, { useState, useRef, useCallback, useEffect } from 'react';
import { setIframeRef, setCurrentUrl, proxyUrl } from './chrome-mock/tabs';

interface MockBrowserProps {
  initialUrl?: string;
}

function useTabs() {
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);

  const refreshTabs = useCallback(() => {
    chrome.tabs.query({}, (result) => {
      setTabs(result);
      const active = result.find(t => t.active) || null;
      setActiveTab(active);
    });
  }, []);

  useEffect(() => {
    refreshTabs();

    const handleCreated = () => refreshTabs();
    const handleUpdated = () => refreshTabs();
    const handleRemoved = () => refreshTabs();

    chrome.tabs.onCreated.addListener(handleCreated);
    chrome.tabs.onUpdated.addListener(handleUpdated);
    if (chrome.tabs.onRemoved) {
      chrome.tabs.onRemoved.addListener(handleRemoved);
    }

    return () => {
      chrome.tabs.onCreated.removeListener(handleCreated);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      if (chrome.tabs.onRemoved) {
        chrome.tabs.onRemoved.removeListener(handleRemoved);
      }
    };
  }, [refreshTabs]);

  return { tabs, activeTab, refreshTabs };
}

export function MockBrowser({ initialUrl = 'https://example.com' }: MockBrowserProps) {
  const { tabs, activeTab } = useTabs();
  const [addressInput, setAddressInput] = useState(initialUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [isSecure, setIsSecure] = useState(true);
  const [swReady, setSwReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Sync iframe ref with chrome.tabs shim
  useEffect(() => {
    if (iframeRef.current) {
      setIframeRef(iframeRef.current);
    }
  }, []);

  // Sync addressInput with active tab url changes
  useEffect(() => {
    if (activeTab?.url) {
      setAddressInput(activeTab.url);
      setIsSecure(activeTab.url.startsWith('https://'));
    }
  }, [activeTab?.url]);

  // Listen to Service Worker readiness before triggering navigation
  useEffect(() => {
    const checkSW = async () => {
      if (!('serviceWorker' in navigator)) {
        setSwReady(false);
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration('./');
      if (reg?.active) {
        setSwReady(true);
        navigate(initialUrl);
      } else {
        navigator.serviceWorker.ready.then(() => {
          setSwReady(true);
          navigate(initialUrl);
        });
      }
    };
    checkSW();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = useCallback((url: string) => {
    let target = url.trim();
    if (!target) return;

    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      if (target.includes('.') && !target.includes(' ')) {
        target = 'https://' + target;
      } else {
        target = 'https://www.google.com/search?q=' + encodeURIComponent(target);
      }
    }

    chrome.tabs.query({ active: true }, (tabsList) => {
      const active = tabsList[0] || null;
      if (active && active.id != null) {
        chrome.tabs.update(active.id, { url: target });
      } else {
        // Fallback: If shims/tabs aren't ready yet, set iframe src directly
        setCurrentUrl(target);
        setAddressInput(target);
        setIsLoading(true);
        setIsSecure(target.startsWith('https://'));
        if (iframeRef.current) {
          iframeRef.current.src = proxyUrl(target);
        }
      }
    });
  }, []);

  const handleAddressKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      navigate(addressInput);
    }
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
    try {
      const iframeUrl = iframeRef.current?.contentWindow?.location?.href;
      if (iframeUrl) {
        let displayUrl = iframeUrl;
        if (iframeUrl.includes('/__proxy__/')) {
          try {
            const urlObj = new URL(iframeUrl);
            const target = urlObj.searchParams.get('url');
            if (target) displayUrl = target;
          } catch { /* parse failure fallback */ }
        }

        const displayTitle = iframeRef.current?.contentWindow?.document?.title || 'New Tab';
        setCurrentUrl(displayUrl, displayTitle);
        setAddressInput(displayUrl);
        setIsSecure(displayUrl.startsWith('https://'));
      }
    } catch { /* cross-origin frame guard */ }
  };

  const handleRefresh = () => {
    if (iframeRef.current) {
      setIsLoading(true);
      // eslint-disable-next-line no-self-assign
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  return (
    <div className="sandbox-browser-pane">
      {/* Tabs Container */}
      <div className="browser-tabs-container">
        <div className="browser-tabs-list">
          {tabs.map((tab) => {
            const isActive = tab.active;
            return (
              <div
                key={tab.id}
                className={`browser-tab${isActive ? ' active' : ''}`}
                onClick={() => {
                  if (tab.id != null) {
                    chrome.tabs.update(tab.id, { active: true });
                  }
                }}
              >
                <span className="browser-tab-title" title={tab.title || tab.url}>
                  {tab.title || tab.url || 'New Tab'}
                </span>
                {tabs.length > 1 && (
                  <button
                    className="browser-tab-close"
                    title="Close Tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (tab.id != null) {
                        chrome.tabs.remove(tab.id);
                      }
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          className="browser-tab-new"
          title="New Tab"
          onClick={() => {
            chrome.tabs.create({ url: 'https://example.com' });
          }}
        >
          +
        </button>
      </div>

      {/* Toolbar */}
      <div className="browser-toolbar">
        <button
          className="browser-nav-btn"
          title="Back"
          onClick={() => iframeRef.current?.contentWindow?.history.back()}
        >
          ←
        </button>
        <button
          className="browser-nav-btn"
          title="Forward"
          onClick={() => iframeRef.current?.contentWindow?.history.forward()}
        >
          →
        </button>
        <button
          className="browser-nav-btn"
          title={isLoading ? 'Stop' : 'Refresh'}
          onClick={handleRefresh}
        >
          {isLoading ? '✕' : '↺'}
        </button>

        {/* Address bar */}
        <div className="browser-address-bar">
          <span
            className={`browser-address-lock${isSecure ? '' : ' insecure'}`}
            title={isSecure ? 'Secure' : 'Not secure'}
          >
            {isSecure ? '🔒' : '🔓'}
          </span>
          <input
            className="browser-address-input"
            type="text"
            value={addressInput}
            onChange={e => setAddressInput(e.target.value)}
            onKeyDown={handleAddressKeyDown}
            onFocus={e => e.target.select()}
            placeholder="Enter URL or search..."
            spellCheck={false}
          />
          <button
            className="browser-address-go"
            onClick={() => navigate(addressInput)}
            title="Navigate"
          >
            ›
          </button>
        </div>

        {/* SW status indicator */}
        {!swReady && (
          <span
            title="Service worker initializing..."
            style={{ fontSize: 16, cursor: 'help' }}
          >
            ⚠️
          </span>
        )}
      </div>

      {/* Loading bar */}
      <div className={`browser-loading-bar${isLoading ? ' loading' : ''}`} />

      {/* Viewport */}
      <div className="browser-viewport">
        {!swReady && (
          <div className="browser-placeholder">
            <div className="browser-placeholder-icon">⏳</div>
            <div className="browser-placeholder-text">
              Initializing proxy service worker…<br />
              <span style={{ fontSize: 12, opacity: 0.6 }}>
                This may take a moment on first load.
              </span>
            </div>
            <button
              className="browser-address-go"
              style={{
                background: 'rgba(14, 165, 233, 0.2)',
                border: '1px solid rgba(14, 165, 233, 0.4)',
                color: '#7dd3fc',
                padding: '6px 14px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                width: 'auto',
                height: 'auto',
              }}
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        )}
        <iframe
          ref={iframeRef}
          className="browser-iframe"
          title="Mock Browser"
          sandbox="allow-scripts allow-same-origin allow-forms"
          onLoad={handleIframeLoad}
          style={{ display: swReady ? 'block' : 'none' }}
        />
      </div>
    </div>
  );
}

