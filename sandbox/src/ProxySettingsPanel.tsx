import { useState, useEffect } from 'react';

const STORAGE_KEY_PROXY = 'customCorsProxyUrl';

export function ProxySettingsPanel() {
  const [open, setOpen] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [status, setStatus] = useState<'active' | 'default' | 'inactive'>('inactive');
  const [saved, setSaved] = useState(false);

  // Load from localStorage & sync to Cache Storage on mount
  useEffect(() => {
    const initializeProxy = async () => {
      const storedUrl = localStorage.getItem(STORAGE_KEY_PROXY) ?? '';
      const defaultUrl = (import.meta.env.VITE_CORS_PROXY_URL as string) ?? '';

      // Check Cache Storage state
      try {
        const cache = await caches.open('opticlick-proxy-config');
        const cachedResp = await cache.match('/proxy-url');
        
        let activeUrl = '';
        if (cachedResp) {
          activeUrl = (await cachedResp.text()).trim();
        }

        if (activeUrl) {
          setProxyUrl(activeUrl);
          if (storedUrl && activeUrl === storedUrl) {
            setStatus('active');
            setSaved(true);
          } else if (defaultUrl && activeUrl === defaultUrl) {
            setStatus('default');
          } else {
            // Out of sync or custom
            setStatus('active');
          }
        } else {
          // Cache is empty
          if (storedUrl) {
            setProxyUrl(storedUrl);
            await cache.put('/proxy-url', new Response(storedUrl));
            setStatus('active');
            setSaved(true);
          } else if (defaultUrl) {
            setProxyUrl(defaultUrl);
            await cache.put('/proxy-url', new Response(defaultUrl));
            setStatus('default');
          } else {
            setProxyUrl('');
            setStatus('inactive');
          }
        }
      } catch (e) {
        console.error('[ProxyPanel] Error accessing cache storage:', e);
        // Fallback to localstorage only
        if (storedUrl) {
          setProxyUrl(storedUrl);
          setStatus('active');
          setSaved(true);
        } else if (defaultUrl) {
          setProxyUrl(defaultUrl);
          setStatus('default');
        }
      }
    };

    initializeProxy();
  }, []);

  const handleSave = async () => {
    let trimmedUrl = proxyUrl.trim();
    if (!trimmedUrl) {
      handleClear();
      return;
    }

    // Automatically prepend https:// if protocol is missing to prevent relative URL fetching loop
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      trimmedUrl = 'https://' + trimmedUrl;
    }
    setProxyUrl(trimmedUrl);

    localStorage.setItem(STORAGE_KEY_PROXY, trimmedUrl);

    try {
      const cache = await caches.open('opticlick-proxy-config');
      await cache.put('/proxy-url', new Response(trimmedUrl));
    } catch (e) {
      console.error('[ProxyPanel] Failed to save to cache:', e);
    }

    const defaultUrl = (import.meta.env.VITE_CORS_PROXY_URL as string) ?? '';
    if (trimmedUrl === defaultUrl) {
      setStatus('default');
    } else {
      setStatus('active');
    }
    setSaved(true);
  };

  const handleClear = async () => {
    localStorage.removeItem(STORAGE_KEY_PROXY);

    try {
      const cache = await caches.open('opticlick-proxy-config');
      await cache.delete('/proxy-url');
    } catch (e) {
      console.error('[ProxyPanel] Failed to clear cache:', e);
    }

    const defaultUrl = (import.meta.env.VITE_CORS_PROXY_URL as string) ?? '';
    if (defaultUrl) {
      setProxyUrl(defaultUrl);
      try {
        const cache = await caches.open('opticlick-proxy-config');
        await cache.put('/proxy-url', new Response(defaultUrl));
      } catch {
        // Ignore cache write failures
      }
      setStatus('default');
    } else {
      setProxyUrl('');
      setStatus('inactive');
    }
    setSaved(false);
  };

  const getStatusBadge = () => {
    if (status === 'active') {
      return <span className="proxy-status active">Custom Worker</span>;
    }
    if (status === 'default') {
      return <span className="proxy-status default">Default Worker</span>;
    }
    return <span className="proxy-status inactive">Required</span>;
  };

  return (
    <div className="proxy-panel">
      <div
        className="proxy-header"
        onClick={() => setOpen(o => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setOpen(o => !o)}
      >
        <span className="proxy-icon">🌐</span>
        <span className="proxy-title">CORS Proxy Settings</span>
        {getStatusBadge()}
        <span className={`proxy-chevron${open ? ' open' : ''}`}>▼</span>
      </div>

      {open && (
        <div className="proxy-body">
          <div className="proxy-row">
            <label className="proxy-label">Cloudflare Worker Proxy URL</label>
            <input
              className="proxy-input"
              type="text"
              value={proxyUrl}
              onChange={e => { setProxyUrl(e.target.value); setSaved(false); }}
              placeholder="https://your-worker.subdomain.workers.dev"
              spellCheck={false}
            />
            <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.4 }}>
              Enter your self-hosted Cloudflare Worker CORS proxy URL to allow Opticlick Sandbox to navigate and fetch target websites.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', marginTop: 4 }}>
            {(status === 'active' || saved) && (
              <button
                onClick={handleClear}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#64748b',
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Reset
              </button>
            )}
            <button className="proxy-save-btn" onClick={handleSave}>
              {saved ? '✓ Saved' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
