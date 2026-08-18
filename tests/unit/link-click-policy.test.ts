import { describe, it, expect } from 'vitest';
import { isSameDocumentHref, shouldOpenLinkInNewTab } from '@/utils/link-click-policy';

describe('link-click-policy', () => {
  it('detects same-document href values', () => {
    expect(isSameDocumentHref('#section')).toBe(true);
    expect(isSameDocumentHref('#')).toBe(true);
    expect(isSameDocumentHref('javascript:void(0)')).toBe(true);
  });

  it('treats regular URLs as navigational', () => {
    expect(isSameDocumentHref('https://example.com')).toBe(false);
    expect(isSameDocumentHref('/docs/getting-started')).toBe(false);
  });

  it('opens plain link clicks in a new tab by default', () => {
    expect(shouldOpenLinkInNewTab({ tag: 'a', href: 'https://example.com' }, {})).toBe(true);
  });

  it('does not force new tab for hash links or non-anchors', () => {
    expect(shouldOpenLinkInNewTab({ tag: 'a', href: '#faq' }, {})).toBe(false);
    expect(shouldOpenLinkInNewTab({ tag: 'button' }, {})).toBe(false);
  });

  it('respects explicit modifiers and upload flow', () => {
    expect(shouldOpenLinkInNewTab({ tag: 'a', href: 'https://example.com' }, { modifier: 'shift' })).toBe(false);
    expect(shouldOpenLinkInNewTab({ tag: 'a', href: 'https://example.com' }, { uploadFileId: 'f1' })).toBe(false);
  });
});
