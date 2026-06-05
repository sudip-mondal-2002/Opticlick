import { describe, it, expect } from 'vitest';
import {
  buildSearchText,
  mergeSearchText,
  parseStartUrlFromContent,
  SESSION_SEARCH_TEXT_MAX,
} from '@/utils/session-search-text';

describe('buildSearchText', () => {
  it('lowercases and collapses whitespace', () => {
    expect(buildSearchText('  Hello   World  ')).toBe('hello world');
  });

  it('truncates to max length', () => {
    const long = 'a'.repeat(SESSION_SEARCH_TEXT_MAX + 100);
    expect(buildSearchText(long)).toHaveLength(SESSION_SEARCH_TEXT_MAX);
  });
});

describe('mergeSearchText', () => {
  it('appends new snippet', () => {
    expect(mergeSearchText('hello', 'world')).toBe('hello world');
  });

  it('skips duplicate snippet', () => {
    expect(mergeSearchText('hello world', 'world')).toBe('hello world');
  });
});

describe('parseStartUrlFromContent', () => {
  it('extracts URL from CONTEXT block', () => {
    const content = 'Task here\n\n[CONTEXT: The task started on https://example.com/page. If you are on an unrelated page, navigate back.]';
    expect(parseStartUrlFromContent(content)).toBe('https://example.com/page');
  });

  it('returns undefined when no CONTEXT block', () => {
    expect(parseStartUrlFromContent('plain text')).toBeUndefined();
  });
});
