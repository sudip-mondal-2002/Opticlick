/**
 * Pure-logic helpers for the in-session scratchpad system.
 *
 * The scratchpad stores intermediate findings the agent accumulates during a
 * single task (e.g. items found across multiple scrolls, extracted data, etc.).
 * It is backed by the VFS as `__scratchpad.json` so it survives service-worker
 * restarts within a session, and is automatically cleared when the session ends
 * (the end-of-session VFS cleanup excludes it via SCRATCHPAD_VFS_FILENAME).
 *
 * Unlike long-term memory (IndexedDB), scratchpad entries are strictly
 * session-scoped and do NOT propagate to other sessions or threads.
 *
 * No Chrome APIs — module is pure and easily testable.
 */

import { listVFSFiles, writeVFSFile } from './db';

export const SCRATCHPAD_VFS_FILENAME = '__scratchpad.json';

export interface ScratchpadEntry {
  /** Short descriptive key, e.g. "issues_found", "search_results". */
  key: string;
  /** The accumulated or updated value for this note. */
  value: string;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// VFS persistence
// ─────────────────────────────────────────────────────────────────────────────

/** Load the scratchpad for a session from VFS. Returns [] if none exists yet. */
export async function loadScratchpadFromVFS(sessionId: number): Promise<ScratchpadEntry[]> {
  const files = await listVFSFiles(sessionId);
  const file = files.find((f) => f.name === SCRATCHPAD_VFS_FILENAME);
  if (!file) return [];
  try {
    const json = decodeURIComponent(escape(atob(file.data)));
    return JSON.parse(json) as ScratchpadEntry[];
  } catch {
    return [];
  }
}

/** Persist the scratchpad for a session to VFS (upsert by filename). */
export async function saveScratchpadToVFS(
  sessionId: number,
  entries: ScratchpadEntry[],
): Promise<void> {
  const json = JSON.stringify(entries, null, 2);
  const base64 = btoa(unescape(encodeURIComponent(json)));
  await writeVFSFile(sessionId, SCRATCHPAD_VFS_FILENAME, base64, 'application/json');
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure mutations (no side-effects — easy to test)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert or update a scratchpad entry.
 * Returns the new entries array (does not mutate the input).
 */
export function upsertScratchpadEntry(
  entries: ScratchpadEntry[],
  key: string,
  value: string,
): ScratchpadEntry[] {
  const now = Date.now();
  const trimmedKey = key.trim();
  const idx = entries.findIndex((e) => e.key === trimmedKey);
  const updated: ScratchpadEntry = { key: trimmedKey, value, updatedAt: now };
  if (idx >= 0) {
    return [...entries.slice(0, idx), updated, ...entries.slice(idx + 1)];
  }
  return [...entries, updated];
}

/**
 * Remove a scratchpad entry by key.
 * Returns the new entries array (does not mutate the input).
 */
export function deleteScratchpadEntry(
  entries: ScratchpadEntry[],
  key: string,
): ScratchpadEntry[] {
  return entries.filter((e) => e.key !== key.trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render all scratchpad entries as a compact context block for LLM prompt
 * injection. The block is always shown so the agent knows the tool exists.
 */
export function formatScratchpadForPrompt(entries: ScratchpadEntry[]): string {
  if (entries.length === 0) {
    return '\n\n── Scratchpad — empty (use note_write to save intermediate findings) ──';
  }
  const lines = entries.map((e) => `  [${e.key}]: ${e.value}`);
  return `\n\n── Scratchpad ──\n${lines.join('\n')}`;
}
