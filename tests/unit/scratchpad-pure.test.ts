import { describe, it, expect } from 'vitest';
import {
  upsertScratchpadEntry,
  deleteScratchpadEntry,
  formatScratchpadForPrompt,
  type ScratchpadEntry,
} from '../../src/utils/scratchpad';

describe('scratchpad pure logic', () => {
  describe('upsertScratchpadEntry', () => {
    it('adds a new entry to an empty list', () => {
      const before: ScratchpadEntry[] = [];
      const after = upsertScratchpadEntry(before, 'my_key', 'some value');
      expect(after).toHaveLength(1);
      expect(after[0].key).toBe('my_key');
      expect(after[0].value).toBe('some value');
      expect(after[0].updatedAt).toBeTypeOf('number');
      // Should not mutate original
      expect(before).toHaveLength(0);
    });

    it('updates an existing entry and preserves order', () => {
      const before: ScratchpadEntry[] = [
        { key: 'first', value: 'val1', updatedAt: 100 },
        { key: 'target', value: 'old val', updatedAt: 100 },
        { key: 'last', value: 'val3', updatedAt: 100 },
      ];
      const after = upsertScratchpadEntry(before, 'target', 'new val');
      expect(after).toHaveLength(3);
      expect(after[0].key).toBe('first');
      expect(after[1].key).toBe('target');
      expect(after[1].value).toBe('new val');
      expect(after[1].updatedAt).toBeGreaterThanOrEqual(100);
      expect(after[2].key).toBe('last');
      // Original unchanged
      expect(before[1].value).toBe('old val');
    });

    it('trims the key before adding or updating', () => {
      const before: ScratchpadEntry[] = [{ key: 'spaced_key', value: 'v1', updatedAt: 0 }];
      const after = upsertScratchpadEntry(before, '  spaced_key  ', 'v2');
      expect(after).toHaveLength(1);
      expect(after[0].key).toBe('spaced_key');
      expect(after[0].value).toBe('v2');
    });
  });

  describe('deleteScratchpadEntry', () => {
    it('removes an existing entry', () => {
      const before: ScratchpadEntry[] = [
        { key: 'first', value: 'v1', updatedAt: 0 },
        { key: 'target', value: 'v2', updatedAt: 0 },
      ];
      const after = deleteScratchpadEntry(before, 'target');
      expect(after).toHaveLength(1);
      expect(after[0].key).toBe('first');
      // Original unchanged
      expect(before).toHaveLength(2);
    });

    it('does nothing if key is not found', () => {
      const before: ScratchpadEntry[] = [{ key: 'first', value: 'v1', updatedAt: 0 }];
      const after = deleteScratchpadEntry(before, 'missing');
      // It returns a new array...
      expect(after).not.toBe(before);
      // ...but with the same contents
      expect(after).toEqual(before);
    });
  });

  describe('formatScratchpadForPrompt', () => {
    it('returns an empty state message if no entries', () => {
      const result = formatScratchpadForPrompt([]);
      expect(result).toContain('Scratchpad — empty');
      expect(result).toContain('note_write');
    });

    it('formats entries line by line', () => {
      const entries: ScratchpadEntry[] = [
        { key: 'issues_found', value: '#1, #2', updatedAt: 0 },
        { key: 'note', value: 'some free text', updatedAt: 0 },
      ];
      const result = formatScratchpadForPrompt(entries);
      expect(result).toContain('── Scratchpad ──');
      expect(result).toContain('  [issues_found]: #1, #2');
      expect(result).toContain('  [note]: some free text');
    });
  });
});
