import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';

// ── Dev-mode server-side proxy plugin ─────────────────────────────────────────
// In dev (http://localhost), the service worker can't fetch cross-origin HTTPS
// URLs due to browser security restrictions. This Vite plugin handles
// /__proxy__/?url=<target> requests server-side (Node.js has no CORS limits).
// In production (GitHub Pages HTTPS), the SW handles everything.
function devProxyPlugin() {
  return {
    name: 'sandbox-dev-proxy',
    configureServer(server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url?.startsWith('/__proxy__/')) return next();

        const rawQuery = req.url.slice('/__proxy__/'.length - 1); // includes leading ?
        let targetUrl: string | null = null;
        try {
          targetUrl = new URL('http://x' + rawQuery).searchParams.get('url');
        } catch { /* */ }

        if (!targetUrl) return next();

        try {
          const resp = await fetch(targetUrl, {
            method: (req.method as string) || 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
            },
            redirect: 'follow',
          });

          const BLOCKED_HEADERS = new Set([
            'x-frame-options', 'content-security-policy',
            'content-security-policy-report-only', 'x-content-type-options',
            'strict-transport-security', 'cross-origin-opener-policy',
            'cross-origin-embedder-policy', 'cross-origin-resource-policy',
            'transfer-encoding', 'content-encoding', 'content-length',
          ]);

          for (const [k, v] of resp.headers.entries()) {
            if (!BLOCKED_HEADERS.has(k.toLowerCase())) {
              res.setHeader(k, v);
            }
          }
          res.setHeader('access-control-allow-origin', '*');

          const finalUrl = resp.url || targetUrl;
          const ct = resp.headers.get('content-type') ?? '';
          const isHtml = ct.includes('text/html');
          const isCss = ct.includes('text/css');

          if (isHtml) {
            let html = await resp.text();
            html = rewriteHtmlUrls(html, finalUrl);
            html = injectContentScript(html);
            res.setHeader('content-type', 'text/html; charset=utf-8');
            res.end(html);
          } else if (isCss) {
            let css = await resp.text();
            css = css.replace(/url\(['"]?([^'")\s]+)['"]?\)/gi, (_, u) => `url(${proxyUrlNode(u, finalUrl)})`);
            res.end(css);
          } else {
            const buf = Buffer.from(await resp.arrayBuffer());
            res.end(buf);
          }
        } catch (err: unknown) {
          res.statusCode = 502;
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;background:#1a1a2e;color:#e2e8f0;">
            <h2 style="color:#f87171">⚠️ Proxy error</h2>
            <p>URL: <code>${escapeHtml(targetUrl)}</code></p>
            <p>${escapeHtml(String((err as Error).message || ''))}</p>
          </body></html>`);
        }
      });
    },
  };
}

function escapeHtml(str: unknown): string {
  const s = typeof str === 'string' ? str : String(str ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function proxyUrlNode(url: string, base: string): string {
  if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) return url;
  try {
    const abs = new URL(url, base).href;
    if (abs.startsWith('http://') || abs.startsWith('https://')) {
      return `/__proxy__/?url=${encodeURIComponent(abs)}`;
    }
  } catch { /* */ }
  return url;
}

function rewriteHtmlUrls(html: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  const baseTag = `<base href="${base.origin}${base.pathname}" />`;
  const proxy = (u: string) => proxyUrlNode(u, baseUrl);

  const rewritten = html
    .replace(/\bhref="((?!#|javascript:|mailto:|tel:)[^"]+)"/gi, (_, u) => `href="${proxy(u)}"`)
    .replace(/\bhref='((?!#|javascript:|mailto:|tel:)[^']+)'/gi, (_, u) => `href='${proxy(u)}'`)
    .replace(/\bsrc="([^"]+)"/gi, (_, u) => `src="${proxy(u)}"`)
    .replace(/\bsrc='([^']+)'/gi, (_, u) => `src='${proxy(u)}'`)
    .replace(/\baction="([^"]+)"/gi, (_, u) => `action="${proxy(u)}"`)
    .replace(/\s+integrity="[^"]*"/gi, '')
    .replace(/\s+crossorigin(="[^"]*")?/gi, '');

  return rewritten.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
}

function injectContentScript(html: string): string {
  const script = `<script>
(function(){
'use strict';
if(window.__opticlick_cs_loaded__)return;
window.__opticlick_cs_loaded__=true;

const CANVAS_ID='__opticlick_overlay__';
const BLOCKER_ID='__opticlick_blocker__';

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

function collectInteractables(){
  return [...document.querySelectorAll('a,button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[onclick],[tabindex]')].filter(el=>{
    const s=getComputedStyle(el);
    return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';
  });
}

function getLabel(el){
  return (el.getAttribute('aria-label')||el.innerText||el.value||el.placeholder||el.title||el.alt||el.tagName.toLowerCase()).slice(0,80).trim();
}

async function drawOverlay(){
  destroyOverlay();
  const theme = await getTheme();
  const dpr = window.devicePixelRatio||1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const els = collectInteractables();
  const canvas = document.createElement('canvas');
  canvas.id = CANVAS_ID;
  canvas.width = Math.round(w*dpr);
  canvas.height = Math.round(h*dpr);
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:'+w+'px;height:'+h+'px;z-index:2147483647;pointer-events:none;';
  (document.body||document.documentElement).appendChild(canvas);
  
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  const map = [];
  let id = 1;
  for(const el of els){
    const r = el.getBoundingClientRect();
    if(r.width<4||r.height<4)continue;
    
    ctx.strokeStyle = theme.markStroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.left+.5,r.top+.5,r.width-1,r.height-1);
    
    ctx.fillStyle = theme.markFill;
    ctx.fillRect(r.left+1,r.top+1,r.width-2,r.height-2);
    
    const label = String(id);
    const badgeW = Math.max(label.length*7+8,20);
    const badgeH = 16;
    const badgeX = r.left;
    const badgeY = r.top-badgeH-1;
    
    ctx.fillStyle = theme.badgeBg;
    ctx.beginPath();
    if(ctx.roundRect){
      ctx.roundRect(badgeX, Math.max(0,badgeY), badgeW, badgeH, 3);
    }else{
      ctx.rect(badgeX, Math.max(0,badgeY), badgeW, badgeH);
    }
    ctx.fill();
    
    ctx.fillStyle = theme.badgeText;
    ctx.font = 'bold 10px -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, badgeX+4, Math.max(badgeH/2, badgeY+badgeH/2));
    
    map.push({
      id,
      tag: el.tagName.toLowerCase(),
      text: getLabel(el),
      rect: {
        x: Math.round(r.left+r.width/2),
        y: Math.round(r.top+r.height/2),
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

function destroyOverlay(){
  document.getElementById(CANVAS_ID)?.remove();
}

async function installBlocker(){
  if(document.getElementById(BLOCKER_ID))return;
  const theme = await getTheme();
  const div = document.createElement('div');
  div.id = BLOCKER_ID;
  div.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:'+theme.blockerBg+';cursor:not-allowed;pointer-events:none;box-sizing:border-box;';
  
  const banner = document.createElement('div');
  banner.style.cssText = 'position:absolute;top:0;left:0;right:0;padding:10px 0;background:'+theme.bannerBg+';color:#fff;font:bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;text-align:center;letter-spacing:1.5px;text-transform:uppercase;pointer-events:none;animation:__opticlick_pulse__ 1.5s ease-in-out infinite;';
  banner.textContent = 'Opticlick Agent Running — Tab Locked';
  div.appendChild(banner);
  
  const style = document.createElement('style');
  style.textContent = '@keyframes __opticlick_pulse__ { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } } body.'+BLOCKER_ID+'-active, body.'+BLOCKER_ID+'-active * { cursor: not-allowed !important; }';
  div.appendChild(style);
  
  (document.body||document.documentElement).appendChild(div);
  document.body?.classList.add(BLOCKER_ID+'-active');
}

function removeBlocker(){
  document.getElementById(BLOCKER_ID)?.remove();
  document.body?.classList.remove(BLOCKER_ID+'-active');
}

window.addEventListener('message',async function(event){
  if(!event.data?.__opticlick__)return;
  const{id,type}=event.data;
  const reply=data=>event.source.postMessage({__opticlick_reply__:true,id,response:data},'*');
  switch(type){
    case 'DRAW_MARKS':{
      const coordinateMap = await drawOverlay();
      reply({success:true,coordinateMap,dpr:window.devicePixelRatio||1});
      break;
    }
    case 'DESTROY_MARKS':{
      destroyOverlay();
      reply({success:true});
      break;
    }
    case 'BLOCK_INPUT':{
      await installBlocker();
      reply({success:true});
      break;
    }
    case 'UNBLOCK_INPUT':{
      removeBlocker();
      reply({success:true});
      break;
    }
    case 'PING':{
      reply({alive:true});
      break;
    }
    case 'GET_ELEMENT_DOM':{
      const el=document.elementFromPoint(event.data.x,event.data.y);
      reply({success:true,outerHTML:el?.outerHTML?.slice(0,2000)??''});
      break;
    }
    default:
      reply({success:false,error:'unknown:'+type});
  }
});

console.log('[Opticlick] sandbox content script loaded on',location.href);
})();
</script>`;
  return html.includes('</body>') ? html.replace(/<\/body>/i, script + '</body>') : html + script;
}

export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), devProxyPlugin()],
  base: process.env.VITE_BASE_PATH ?? '/',
  define: {
    'import.meta.env.VITE_PR_NUMBER': JSON.stringify(process.env.VITE_PR_NUMBER ?? ''),
    'import.meta.env.VITE_BRANCH_NAME': JSON.stringify(process.env.VITE_BRANCH_NAME ?? ''),
    'import.meta.env.VITE_LANGSMITH_TRACING': JSON.stringify(process.env.VITE_LANGSMITH_TRACING ?? ''),
    'import.meta.env.VITE_LANGSMITH_ENDPOINT': JSON.stringify(process.env.VITE_LANGSMITH_ENDPOINT ?? ''),
    'import.meta.env.VITE_LANGSMITH_API_KEY': JSON.stringify(process.env.VITE_LANGSMITH_API_KEY ?? ''),
    'import.meta.env.VITE_LANGSMITH_PROJECT': JSON.stringify(process.env.VITE_LANGSMITH_PROJECT ?? ''),
  },
  resolve: {
    alias: [
      { find: '@/utils/cdp', replacement: path.resolve(__dirname, 'src/chrome-mock/debugger.ts') },
      { find: '@/utils/tab-helpers', replacement: path.resolve(__dirname, 'src/chrome-mock/messaging.ts') },
      { find: '@/', replacement: path.resolve(__dirname, '../src/') + '/' },
    ],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'html2canvas'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5174,
  },
}));
