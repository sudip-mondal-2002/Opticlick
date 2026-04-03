/**
 * VFS-backed todo list helpers.
 *
 * The todo list is stored as `__todo.json` inside the session VFS so it
 * survives service-worker restarts and browser crashes. The file is excluded
 * from the end-of-session VFS cleanup, allowing interrupted sessions to be
 * resumed with the original plan intact.
 */

import { listVFSFiles, writeVFSFile } from './db';
import type { TodoItem, TodoUpdate } from './types';

export const TODO_VFS_FILENAME = '__todo.json';

/** Load the todo list for a session from VFS. Returns null if none exists yet. */
export async function loadTodoFromVFS(sessionId: number): Promise<TodoItem[] | null> {
  const files = await listVFSFiles(sessionId);
  const todoFile = files.find((f) => f.name === TODO_VFS_FILENAME);
  if (!todoFile) return null;
  try {
    const json = decodeURIComponent(escape(atob(todoFile.data)));
    return JSON.parse(json) as TodoItem[];
  } catch {
    return null;
  }
}

/** Persist the todo list for a session to VFS (upsert by filename). */
export async function saveTodoToVFS(sessionId: number, items: TodoItem[]): Promise<void> {
  const json = JSON.stringify(items, null, 2);
  const base64 = btoa(unescape(encodeURIComponent(json)));
  await writeVFSFile(sessionId, TODO_VFS_FILENAME, base64, 'application/json');
}

/**
 * Apply a list of partial updates to the current todo items.
 * Unknown IDs are silently ignored so stale LLM responses don't crash.
 */
export function applyTodoUpdates(current: TodoItem[], updates: TodoUpdate[]): TodoItem[] {
  return current.map((item) => {
    const patch = updates.find((u) => u.id === item.id);
    if (!patch) return item;
    return {
      ...item,
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
    };
  });
}

/** Render the todo list as a compact text block for LLM context injection. */
export function formatTodoForPrompt(items: TodoItem[]): string {
  if (!items.length) return '(empty)';
  const STATUS_ICON: Record<TodoItem['status'], string> = {
    pending: '[ ]',
    in_progress: '[→]',
    done: '[✓]',
    skipped: '[-]',
  };
  return items
    .map((i) => {
      const icon = STATUS_ICON[i.status] ?? '[ ]';
      const note = i.notes ? `  # ${i.notes}` : '';
      return `  ${icon} ${i.id}: ${i.title}${note}`;
    })
    .join('\n');
}
