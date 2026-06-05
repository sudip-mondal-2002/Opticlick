import { describe, it, expect } from 'vitest';
import { splitByMatch } from '@/utils/highlight-match';

describe('splitByMatch', () => {
  it('returns single non-match segment when query is empty', () => {
    expect(splitByMatch('Hello world', '')).toEqual([{ text: 'Hello world', match: false }]);
  });

  it('splits case-insensitively', () => {
    expect(splitByMatch('Competitor Analysis', 'comp')).toEqual([
      { text: 'Comp', match: true },
      { text: 'etitor Analysis', match: false },
    ]);
  });

  it('handles multiple occurrences', () => {
    expect(splitByMatch('foo bar foo', 'foo')).toEqual([
      { text: 'foo', match: true },
      { text: ' bar ', match: false },
      { text: 'foo', match: true },
    ]);
  });

  it('returns no matches when query not found', () => {
    expect(splitByMatch('Hello', 'xyz')).toEqual([{ text: 'Hello', match: false }]);
  });
});
