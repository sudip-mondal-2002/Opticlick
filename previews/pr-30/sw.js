/**
 * Opticlick Sandbox Service Worker Proxy
 *
 * Designed to run 100% statically under any dynamic scope (e.g. /opticlick/previews/pr-N/).
 * Features:
 * 1. Virtual Cookie Jar (domain-keyed Map for Cookie/Set-Cookie management).
 * 2. Scoped redirection/interception of un-proxied iframe requests (dynamic fetches).
 * 3. CSP and X-Frame-Options stripping.
 * 4. Content script shim injection.
 */

const CONTENT_SCRIPT_ID = '__opticlick_cs__';
const cookieJar = new Map(); // domain -> Map(name -> value)

function escapeHtml(str) {
  if (typeof str !== 'string') {
    str = String(str);
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/**
 * Resolves the dynamic proxy prefix based on Service Worker registration scope.
 */
function getProxyPrefix() {
  const scopePath = new URL(self.registration.scope).pathname;
  return scopePath + (scopePath.endsWith('/') ? '' : '/') + '__proxy__/';
}

/**
 * Cookie Jar: Outbound helper to fetch and inject domain-specific cookies.
 */
function getCookiesForUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const domain = url.hostname;
    const cookies = [];
    for (const [jarDomain, jarCookies] of cookieJar.entries()) {
      if (domain === jarDomain || domain.endsWith('.' + jarDomain)) {
        for (const [name, val] of jarCookies.entries()) {
          cookies.push(`${name}=${val}`);
        }
      }
    }
    return cookies.join('; ');
  } catch (e) {
    return '';
  }
}

/**
 * Cookie Jar: Inbound helper to parse and save Set-Cookie headers.
 */
function saveCookiesFromHeaders(urlStr, headers) {
  try {
    const url = new URL(urlStr);
    const domain = url.hostname;
    const setCookies = headers.getSetCookie ? headers.getSetCookie() : [];
    if (setCookies.length === 0) {
      const raw = headers.get('set-cookie');
      if (raw) setCookies.push(raw);
    }
    for (const cookieStr of setCookies) {
      const parts = cookieStr.split(';')[0].split('=');
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const val = parts.slice(1).join('=').trim();
        if (!cookieJar.has(domain)) {
          cookieJar.set(domain, new Map());
        }
        cookieJar.get(domain).set(name, val);
      }
    }
  } catch (e) {}
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // In local dev mode, let the Vite dev server handle proxy requests server-side (Node.js) to bypass browser CORS restrictions.
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    return;
  }

  const scopePath = new URL(self.registration.scope).pathname;
  const normalizedScope = scopePath.endsWith('/') ? scopePath : scopePath + '/';
  const proxyPrefix = getProxyPrefix();

  // 1. If it's explicitly a proxy request
  if (url.pathname.startsWith(proxyPrefix) || url.pathname.includes('/__proxy__/')) {
    const target = url.searchParams.get('url');
    if (target) {
      event.respondWith(handleProxy(target, event.request));
      return;
    }
  }

  // 2. Intercept un-proxied iframe requests (e.g. relative dynamic AJAX, CSS, images)
  const referer = event.request.referrer;
  if (referer && (referer.includes('/__proxy__/?url=') || referer.includes('/__proxy__?url='))) {
    try {
      const refererUrl = new URL(referer);
      const originalTargetPage = refererUrl.searchParams.get('url');
      if (originalTargetPage) {
        const isRelative = url.origin === location.origin;
        const resolvedTargetUrl = isRelative
          ? new URL(url.pathname + url.search, originalTargetPage).href
          : url.href;

        // Skip assets belonging to the sandbox React app itself
        const isSandboxAsset = url.pathname.startsWith(normalizedScope + 'src/') ||
                               url.pathname.startsWith(normalizedScope + 'node_modules/') ||
                               url.pathname.includes('/@vite/') ||
                               url.pathname.includes('/@fs/');
        if (!isSandboxAsset) {
          event.respondWith(handleProxy(resolvedTargetUrl, event.request));
          return;
        }
      }
    } catch (e) {
      console.error('[SW] Referrer parsing failed:', e);
    }
  }
});

async function handleProxy(targetUrl, originalRequest) {
  let resolvedUrl = targetUrl;

  try {
    const headers = buildProxyHeaders(originalRequest.headers, targetUrl);
    const fetchInit = {
      method: originalRequest.method,
      headers: headers,
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
    };

    if (originalRequest.method !== 'GET' && originalRequest.method !== 'HEAD') {
      fetchInit.body = await originalRequest.clone().arrayBuffer();
    }

    // Determine if we need to route through a CORS proxy (only in production / GitHub Pages)
    // Production builds route through the third-party CORS proxy corsproxy.io because the sandbox running
    // on GitHub Pages (or any external origin) cannot directly fetch arbitrary URLs due to browser CORS security rules.
    // NOTE: This introduces a dependency on corsproxy.io. If this public service fails, resolving target URLs in production will fail.
    // Fallback considerations: set up a self-hosted CORS proxy, support an optional custom proxy URL via settings,
    // or handle the failure gracefully by displaying a troubleshooting guide to the user.
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const fetchUrl = isLocal ? resolvedUrl : `https://corsproxy.io/?${encodeURIComponent(resolvedUrl)}`;

    const resp = await fetch(fetchUrl, fetchInit);
    
    let finalUrl = resp.url || resolvedUrl;
    if (finalUrl.startsWith('https://corsproxy.io/?')) {
      finalUrl = decodeURIComponent(finalUrl.slice('https://corsproxy.io/?'.length));
    }
    resolvedUrl = finalUrl;

    // Save outbound cookies
    saveCookiesFromHeaders(resolvedUrl, resp.headers);

    const responseHeaders = new Headers();
    const BLOCKED_HEADERS = new Set([
      'x-frame-options', 'content-security-policy',
      'content-security-policy-report-only', 'x-content-type-options',
      'strict-transport-security', 'cross-origin-opener-policy',
      'cross-origin-embedder-policy', 'cross-origin-resource-policy',
      'set-cookie', 'set-cookie2',
      'content-encoding', 'content-length'
    ]);

    for (const [k, v] of resp.headers.entries()) {
      if (!BLOCKED_HEADERS.has(k.toLowerCase())) {
        responseHeaders.set(k, v);
      }
    }
    responseHeaders.set('access-control-allow-origin', '*');

    const ct = resp.headers.get('content-type') ?? '';
    const isHtml = ct.includes('text/html');
    const isCss = ct.includes('text/css');

    if (isHtml) {
      let html = await resp.text();
      html = rewriteHtml(html, resolvedUrl);
      html = injectContentScript(html);
      responseHeaders.set('content-type', 'text/html; charset=utf-8');
      return new Response(html, { status: resp.status, headers: responseHeaders });
    }

    if (isCss) {
      let css = await resp.text();
      css = rewriteCssUrls(css, resolvedUrl);
      return new Response(css, { status: resp.status, headers: responseHeaders });
    }

    return new Response(resp.body, { status: resp.status, headers: responseHeaders });

  } catch (err) {
    return new Response(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;background:#1a1a2e;color:#e2e8f0;">
        <h2 style="color:#f87171">⚠️ Proxy Error</h2>
        <p>URL: <code>${escapeHtml(targetUrl)}</code></p>
        <p>Error: ${escapeHtml(err.message)}</p>
      </body></html>`,
      { status: 502, headers: { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': '*' } }
    );
  }
}

function buildProxyHeaders(originalHeaders, targetUrl) {
  const h = new Headers();
  for (const [k, v] of originalHeaders.entries()) {
    const lower = k.toLowerCase();
    if (lower === 'cookie' || lower === 'referer' || lower === 'host' || lower === 'origin') {
      continue;
    }
    h.set(k, v);
  }

  const cookies = getCookiesForUrl(targetUrl);
  if (cookies) {
    h.set('Cookie', cookies);
  }

  h.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  h.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
  h.set('Accept-Language', 'en-US,en;q=0.9');
  return h;
}

function rewriteHtml(html, baseUrl) {
  const base = new URL(baseUrl);
  const baseTag = `<base href="${base.origin}${base.pathname}" />`;

  html = html
    .replace(/\bhref="((?!#|javascript:|mailto:|tel:)[^"]+)"/gi, (_, u) => `href="${proxyUrl(u, baseUrl)}"`)
    .replace(/\bhref='((?!#|javascript:|mailto:|tel:)[^']+)'/gi, (_, u) => `href='${proxyUrl(u, baseUrl)}'`)
    .replace(/\bsrc="([^"]+)"/gi, (_, u) => `src="${proxyUrl(u, baseUrl)}"`)
    .replace(/\bsrc='([^']+)'/gi, (_, u) => `src='${proxyUrl(u, baseUrl)}'`)
    .replace(/\baction="([^"]+)"/gi, (_, u) => `action="${proxyUrl(u, baseUrl)}"`)
    .replace(/\bsrcset="([^"]+)"/gi, (_, s) => `srcset="${rewriteSrcset(s, baseUrl)}"`)
    .replace(/\s+integrity="[^"]*"/gi, '')
    .replace(/\s+crossorigin(="[^"]*")?/gi, '');

  return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
}

function rewriteSrcset(srcset, baseUrl) {
  return srcset.split(',').map(part => {
    const trimmed = part.trim();
    const [u, ...rest] = trimmed.split(/\s+/);
    return [proxyUrl(u, baseUrl), ...rest].join(' ');
  }).join(', ');
}

function rewriteCssUrls(css, baseUrl) {
  return css.replace(/url\(['"]?([^'"\)]+)['"]?\)/gi, (_, u) => `url(${proxyUrl(u, baseUrl)})`);
}

function proxyUrl(url, baseUrl) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) {
    return url;
  }
  try {
    const abs = new URL(url, baseUrl).href;
    if (abs.startsWith('http://') || abs.startsWith('https://')) {
      const prefix = getProxyPrefix();
      return `${prefix}?url=${encodeURIComponent(abs)}`;
    }
    return url;
  } catch {
    return url;
  }
}

function injectContentScript(html) {
  const script = `
<script id="${CONTENT_SCRIPT_ID}">
(function() {
  'use strict';
  if (window.__opticlick_cs_loaded__) return;
  window.__opticlick_cs_loaded__ = true;

  const CANVAS_ID = '__opticlick_overlay__';
  const BLOCKER_ID = '__opticlick_blocker__';

  const LIGHT = {
    markStroke:    '#0284c7',
    markFill:      'rgba(2, 132, 199, 0.07)',
    badgeBg:       '#0284c7',
    badgeText:     '#ffffff',
    blockerBg:     'radial-gradient(ellipse at center, rgba(14, 165, 233, 0) 60%, rgba(14, 165, 233, 0.9) 120%)',
    bannerBg:      'rgba(2, 132, 199, 0)',
  };
  const DARK = {
    markStroke:    '#38bdf8',
    markFill:      'rgba(56, 189, 248, 0.08)',
    badgeBg:       '#0369a1',
    badgeText:     '#ffffff',
    blockerBg:     'radial-gradient(ellipse at center, rgba(2, 132, 199, 0.20) 60%, rgba(2, 132, 199, 0.9) 120%)',
    bannerBg:      'rgba(3, 105, 161, 0)',
  };

  async function getTheme() {
    try {
      if (window.parent && window.parent.chrome?.storage?.local) {
        const res = await window.parent.chrome.storage.local.get('opticlickTheme');
        if (res && res.opticlickTheme) {
          return res.opticlickTheme === 'dark' ? DARK : LIGHT;
        }
      }
    } catch(e){}
    return LIGHT;
  }

  function collectInteractables() {
    const tags = 'a,button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[onclick],[tabindex]';
    return [...document.querySelectorAll(tags)].filter(el => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    });
  }

  function getLabel(el) {
    return (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.alt || el.tagName.toLowerCase()).slice(0, 80).trim();
  }

  async function drawOverlay() {
    destroyOverlay();
    const theme = await getTheme();
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    const els = collectInteractables();
    const canvas = document.createElement('canvas');
    canvas.id = CANVAS_ID;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:' + w + 'px;height:' + h + 'px;z-index:2147483647;pointer-events:none;';
    (document.body || document.documentElement).appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const map = [];
    let id = 1;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      
      ctx.strokeStyle = theme.markStroke;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.left + 0.5, r.top + 0.5, r.width - 1, r.height - 1);
      
      ctx.fillStyle = theme.markFill;
      ctx.fillRect(r.left + 1, r.top + 1, r.width - 2, r.height - 2);
      
      const label = String(id);
      const badgeW = Math.max(label.length * 7 + 8, 20);
      const badgeH = 16;
      const badgeX = r.left;
      const badgeY = r.top - badgeH - 1;
      
      ctx.fillStyle = theme.badgeBg;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(badgeX, Math.max(0, badgeY), badgeW, badgeH, 3);
      } else {
        ctx.rect(badgeX, Math.max(0, badgeY), badgeW, badgeH);
      }
      ctx.fill();
      
      ctx.fillStyle = theme.badgeText;
      ctx.font = 'bold 10px -apple-system, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, badgeX + 4, Math.max(badgeH / 2, badgeY + badgeH / 2));
      
      map.push({
        id,
        tag: el.tagName.toLowerCase(),
        text: getLabel(el),
        rect: {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          left: Math.round(r.left),
          top: Math.round(r.top),
          width: Math.round(r.width),
          height: Math.round(r.height)
        }
      });
      id++;
    }
    return map;
  }

  function destroyOverlay() {
    document.getElementById(CANVAS_ID)?.remove();
  }

  async function installBlocker() {
    if (document.getElementById(BLOCKER_ID)) return;
    const theme = await getTheme();
    const div = document.createElement('div');
    div.id = BLOCKER_ID;
    div.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:' + theme.blockerBg + ';cursor:not-allowed;pointer-events:none;box-sizing:border-box;';
    
    const banner = document.createElement('div');
    banner.style.cssText = 'position:absolute;top:0;left:0;right:0;padding:10px 0;background:' + theme.bannerBg + ';color:#fff;font:bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;text-align:center;letter-spacing:1.5px;text-transform:uppercase;pointer-events:none;animation:__opticlick_pulse__ 1.5s ease-in-out infinite;';
    banner.textContent = 'Opticlick Agent Running — Tab Locked';
    div.appendChild(banner);
    
    const style = document.createElement('style');
    style.textContent = '@keyframes __opticlick_pulse__ { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } } body.' + BLOCKER_ID + '-active, body.' + BLOCKER_ID + '-active * { cursor: not-allowed !important; }';
    div.appendChild(style);
    
    (document.body || document.documentElement).appendChild(div);
    document.body?.classList.add(BLOCKER_ID + '-active');
  }

  function removeBlocker() {
    document.getElementById(BLOCKER_ID)?.remove();
    document.body?.classList.remove(BLOCKER_ID + '-active');
  }

  window.addEventListener('message', async function(event) {
    if (!event.data?.__opticlick__) return;
    const { id, type } = event.data;
    const reply = data => event.source.postMessage({ __opticlick_reply__: true, id, response: data }, '*');
    switch (type) {
      case 'DRAW_MARKS': {
        const coordinateMap = await drawOverlay();
        reply({ success: true, coordinateMap, dpr: window.devicePixelRatio || 1 });
        break;
      }
      case 'DESTROY_MARKS': {
        destroyOverlay();
        reply({ success: true });
        break;
      }
      case 'BLOCK_INPUT': {
        await installBlocker();
        reply({ success: true });
        break;
      }
      case 'UNBLOCK_INPUT': {
        removeBlocker();
        reply({ success: true });
        break;
      }
      case 'PING': {
        reply({ alive: true });
        break;
      }
      case 'GET_ELEMENT_DOM': {
        const el = document.elementFromPoint(event.data.x, event.data.y);
        reply({ success: true, outerHTML: el?.outerHTML?.slice(0, 2000) ?? '' });
        break;
      }
      default:
        reply({ success: false, error: 'unknown:' + type });
    }
  });

  console.log('[Opticlick] Content script (sandbox) loaded on', location.href);
})();
<\/script>`;

  if (html.includes('</body>')) {
    return html.replace(/<\/body>/i, script + '</body>');
  }
  return html + script;
}
