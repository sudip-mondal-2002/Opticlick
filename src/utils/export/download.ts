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

export async function triggerDownload(
  content: string,
  filename: string,
  mimeType: string,
): Promise<void> {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
