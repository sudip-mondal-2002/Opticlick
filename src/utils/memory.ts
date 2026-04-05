/**
 * Pure-logic helpers for the persistent memory system.
 *
 * The memory store holds cross-session facts the agent discovers about the
 * user (accounts, preferences, etc.). This module handles formatting for
 * prompt injection — no Chrome APIs, easily testable.
 */

import type { MemoryEntry } from './db';

/**
 * Render all memory entries as a compact context block for LLM prompt injection.
 * Grouped by category for readability.
 */
export function formatMemoryForPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return '\n\n── Long-term Memory — empty (use memory_upsert to save useful facts) ──';
  }

  // Group by category
  const grouped = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const cat = entry.category || 'other';
    let list = grouped.get(cat);
    if (!list) {
      list = [];
      grouped.set(cat, list);
    }
    list.push(entry);
  }

  const lines: string[] = [];
  for (const [category, items] of grouped) {
    lines.push(`  [${category}]`);
    for (const item of items) {
      const vals = item.values.join(', ');
      const src = item.sourceUrl ? `  (from: ${item.sourceUrl})` : '';
      lines.push(`    ${item.key}: ${vals}${src}`);
    }
  }

  return `\n\n── Long-term Memory ──\n${lines.join('\n')}`;
}
