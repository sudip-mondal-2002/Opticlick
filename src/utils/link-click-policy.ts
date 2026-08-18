import type { CoordinateEntry } from '@/utils/types';

export interface LinkClickOptions {
  modifier?: 'ctrl' | 'meta' | 'shift' | 'alt';
  uploadFileId?: string;
}

export function isSameDocumentHref(href?: string): boolean {
  if (!href) return false;
  const value = href.trim().toLowerCase();
  return value === '#' || value.startsWith('#') || value.startsWith('javascript:');
}

export function shouldOpenLinkInNewTab(
  target: Pick<CoordinateEntry, 'tag' | 'href'>,
  options: LinkClickOptions,
): boolean {
  if (options.uploadFileId) return false;
  if (options.modifier) return false;
  if (target.tag !== 'a') return false;
  if (isSameDocumentHref(target.href)) return false;
  return true;
}
