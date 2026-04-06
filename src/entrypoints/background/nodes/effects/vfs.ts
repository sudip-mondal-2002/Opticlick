import { appendConversationTurn, writeVFSFile, deleteVFSFile } from '@/utils/db';
import { arrayBufferToBase64 } from '@/utils/base64';
import { log } from '@/utils/agent-log';
import type { AgentAction } from '@/utils/types';
import type { EffectCtx } from './ctx';

type VfsSaveScreenshotAction = Extract<AgentAction, { type: 'vfs_save_screenshot' }>;
type VfsWriteAction = Extract<AgentAction, { type: 'vfs_write' }>;
type VfsDeleteAction = Extract<AgentAction, { type: 'vfs_delete' }>;
type VfsDownloadAction = Extract<AgentAction, { type: 'vfs_download' }>;

function filenameFromResponse(response: Response, url: string, override?: string): string {
  if (override?.trim()) return override.trim();
  const cd = response.headers.get('Content-Disposition');
  if (cd) {
    const m = cd.match(/filename\*?=(?:UTF-8''|"?)([^";\r\n]+)/i);
    if (m) return decodeURIComponent(m[1].trim().replace(/^"|"$/g, ''));
  }
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch { /* ignore */ }
  return 'download';
}

export async function handleVfsSaveScreenshot(
  action: VfsSaveScreenshotAction,
  ctx: EffectCtx,
): Promise<void> {
  const { sessionId, base64Image, step, toolCallId, toolName } = ctx;
  const fname = action.name.trim() || `step_${step}.png`;
  const saved = await writeVFSFile(sessionId, fname, base64Image, 'image/png');
  const result = `Saved screenshot as "${saved.name}" (id: ${saved.id})`;
  await log(`VFS: saved screenshot → "${saved.name}"`, 'info');
  await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
}

export async function handleVfsWrite(action: VfsWriteAction, ctx: EffectCtx): Promise<void> {
  const { sessionId, toolCallId, toolName } = ctx;
  const { name, content, mimeType = 'text/plain' } = action;
  const base64Content = btoa(
    Array.from(new TextEncoder().encode(content), (b) => String.fromCharCode(b)).join(''),
  );
  const saved = await writeVFSFile(sessionId, name, base64Content, mimeType);
  const result = `Wrote "${saved.name}" (${saved.size} B, id: ${saved.id})`;
  await log(`VFS: wrote "${saved.name}" (${saved.size} B)`, 'info');
  await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
}

export async function handleVfsDelete(action: VfsDeleteAction, ctx: EffectCtx): Promise<void> {
  const { sessionId, toolCallId, toolName } = ctx;
  await deleteVFSFile(action.fileId);
  const result = `Deleted VFS file ${action.fileId}`;
  await log(`VFS: deleted file ${action.fileId}`, 'info');
  await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
}

export async function handleVfsDownload(action: VfsDownloadAction, ctx: EffectCtx): Promise<void> {
  const { sessionId, toolCallId, toolName } = ctx;
  const { url, name: nameHint } = action;
  await log(`VFS: downloading ${url}`, 'info');
  let result: string;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
    const mimeType =
      resp.headers.get('Content-Type')?.split(';')[0].trim() ?? 'application/octet-stream';
    const filename = filenameFromResponse(resp.clone(), url, nameHint);
    const b64 = arrayBufferToBase64(await resp.arrayBuffer());
    const saved = await writeVFSFile(sessionId, filename, b64, mimeType);
    result = `Downloaded "${saved.name}" (${saved.size} B, id: ${saved.id})`;
    await log(`VFS: downloaded → "${saved.name}" (${saved.size} B)`, 'info');
  } catch (dlErr) {
    const msg = (dlErr as Error).message;
    result = `Download failed: ${msg}`;
    await log(`VFS: download failed — ${msg}`, 'warn');
  }
  await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
}
