/**
 * Background Service Worker (MV3) — Opticlick Engine
 *
 * Orchestrates the Think → Annotate → Capture → Reason → Act loop.
 */

// Initialize LangSmith tracing first, before any other imports
import { initializeLangSmith } from '@/utils/langsmith-config';
initializeLangSmith();

import { log } from '@/utils/agent-log';
import { getAgentState, setAgentState } from '@/utils/agent-state';
import { tempDownloadIds } from '@/utils/cdp';
import { writeVFSFile } from '@/utils/db';
import { runAgentLoop } from './background/loop';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...(bytes.subarray(i, i + chunk) as unknown as number[]));
  }
  return btoa(binary);
}

function filenameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch { /* ignore */ }
  return 'download';
}

export default defineBackground(() => {
  let loopRunning = false;

  // ── Intercept browser downloads during agent sessions ──────────────────────
  // Any file the browser would normally download gets routed to VFS instead.
  chrome.downloads.onCreated.addListener(async (item) => {
    if (!loopRunning) return;
    if (tempDownloadIds.has(item.id)) return; // our own temp file writes — don't intercept
    if (!item.url.startsWith('http')) return; // skip blob: and data: URLs

    // Cancel the real download immediately
    chrome.downloads.cancel(item.id, () => {
      chrome.downloads.erase({ id: item.id });
    });

    const state = await getAgentState();
    if (!state?.sessionId) return;

    try {
      const resp = await fetch(item.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      // Derive filename: Content-Disposition > download item filename > URL path
      let filename: string = filenameFromUrl(item.url);
      const cd = resp.headers.get('Content-Disposition');
      if (cd) {
        const m = cd.match(/filename\*?=(?:UTF-8''|"?)([^";\r\n]+)/i);
        if (m) filename = decodeURIComponent(m[1].trim().replace(/^"|"$/g, ''));
      } else if (item.filename) {
        const parts = item.filename.replace(/\\/g, '/').split('/');
        filename = parts[parts.length - 1] || filename;
      }

      const mimeType = resp.headers.get('Content-Type')?.split(';')[0].trim()
        ?? item.mime
        ?? 'application/octet-stream';

      const base64 = arrayBufferToBase64(await resp.arrayBuffer());
      const saved = await writeVFSFile(state.sessionId, filename, base64, mimeType);

      await log(`VFS: intercepted download → "${saved.name}" (${saved.size} B)`, 'act');
      chrome.runtime.sendMessage({
        type: 'AGENT_LOG',
        message: `Download intercepted → VFS: "${saved.name}"`,
        level: 'act',
      }).catch(() => {});
    } catch (err) {
      await log(`VFS: download interception failed: ${(err as Error).message}`, 'warn');
    }
  });

  // Open the side panel when the toolbar icon is clicked
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'START_AGENT') {
      if (loopRunning) {
        log('Agent is already running — ignoring duplicate start.', 'warn');
        sendResponse({ started: false, reason: 'already_running' });
        return true;
      }
      const { tabId, prompt, sessionId, attachments, modelId } = msg as { tabId: number; prompt: string; sessionId?: number; attachments?: import('@/utils/types').AttachedFile[]; modelId?: string };
      loopRunning = true;
      runAgentLoop(tabId, prompt, sessionId, attachments, modelId)
        .catch(async (err) => {
          await log(`Fatal: ${(err as Error).message}`, 'error');
        })
        .finally(() => {
          loopRunning = false;
        });
      sendResponse({ started: true });
    }

    if (msg.type === 'STOP_AGENT') {
      setAgentState({ status: 'stopped' }).then(() => {
        sendResponse({ stopped: true });
      });
    }

    return true;
  });
});
