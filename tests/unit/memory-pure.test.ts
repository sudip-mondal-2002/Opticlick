/**
 * Unit tests for the persistent memory helpers (src/utils/memory.ts).
 *
 * Covers formatMemoryForPrompt — pure logic, no Chrome APIs.
 */

import { describe, it, expect } from 'vitest';
import { formatMemoryForPrompt } from '../../src/utils/memory';
import type { MemoryEntry } from '../../src/utils/db';

function makeEntry(overrides: Partial<MemoryEntry> & { key: string }): MemoryEntry {
  return {
    values: [],
    category: 'other',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('formatMemoryForPrompt', () => {
  it('returns an empty-state message when no entries exist', () => {
    const result = formatMemoryForPrompt([]);
    expect(result).toContain('Long-term Memory');
    expect(result).toContain('empty');
    expect(result).toContain('memory_upsert');
  });

  it('renders a single entry correctly', () => {
    const entries: MemoryEntry[] = [
      makeEntry({
        key: 'github/username',
        values: ['sudip-mondal-2002'],
        category: 'account',
        sourceUrl: 'https://github.com',
      }),
    ];
    const result = formatMemoryForPrompt(entries);
    expect(result).toContain('Long-term Memory');
    expect(result).toContain('### account');
    expect(result).toContain('`github/username`: sudip-mondal-2002');
    expect(result).toContain('from: `https://github.com`');
  });

  it('renders multiple values comma-separated', () => {
    const entries: MemoryEntry[] = [
      makeEntry({
        key: 'github/username',
        values: ['sudip-mondal-2002', 'work-account'],
        category: 'account',
      }),
    ];
    const result = formatMemoryForPrompt(entries);
    expect(result).toContain('sudip-mondal-2002, work-account');
  });

  it('groups entries by category', () => {
    const entries: MemoryEntry[] = [
      makeEntry({ key: 'github/username', values: ['user1'], category: 'account' }),
      makeEntry({ key: 'locale/timezone', values: ['Asia/Kolkata'], category: 'preference' }),
      makeEntry({ key: 'twitter/handle', values: ['@user1'], category: 'account' }),
    ];
    const result = formatMemoryForPrompt(entries);

    // Check that account entries appear together
    const lines = result.split('\n');
    const accountHeaderIdx = lines.findIndex((l) => l.includes('### account'));
    const prefHeaderIdx = lines.findIndex((l) => l.includes('### preference'));
    expect(accountHeaderIdx).toBeGreaterThanOrEqual(0);
    expect(prefHeaderIdx).toBeGreaterThanOrEqual(0);
    expect(accountHeaderIdx).not.toBe(prefHeaderIdx);
  });

  it('omits sourceUrl when not present', () => {
    const entries: MemoryEntry[] = [
      makeEntry({ key: 'locale/lang', values: ['en'], category: 'preference' }),
    ];
    const result = formatMemoryForPrompt(entries);
    expect(result).not.toContain('(from:');
  });

  it('handles the "other" category for entries without an explicit category', () => {
    const entries: MemoryEntry[] = [
      makeEntry({ key: 'misc/fact', values: ['some info'], category: 'other' }),
    ];
    const result = formatMemoryForPrompt(entries);
    expect(result).toContain('### other');
    expect(result).toContain('`misc/fact`: some info');
  });
});
