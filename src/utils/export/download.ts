import type { Session } from '../types';

export function buildExportFilename(session: Session, ext: 'json' | 'md'): string {
  const slug = session.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'session';
  const date = new Date(session.createdAt).toISOString().slice(0, 10);
  return `opticlick-${session.id ?? 'unknown'}-${slug}-${date}.${ext}`;
}

/**
 * Encode a UTF-8 string to base64.
 * Works in service workers (no dependency on DOM `btoa` quirks with Unicode).
 */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function triggerDownload(
  content: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  // URL.createObjectURL is NOT available in MV3 service workers.
  // Use a self-contained data URL instead.
  const base64 = utf8ToBase64(content);
  const url = `data:${mimeType};base64,${base64}`;
  await chrome.downloads.download({ url, filename, saveAs: false });
}

