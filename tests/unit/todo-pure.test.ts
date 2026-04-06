import { describe, it, expect } from 'vitest';
import { applyTodoUpdates, formatTodoForPrompt } from '@/utils/todo';
import type { TodoItem } from '@/utils/types';

// ── applyTodoUpdates ─────────────────────────────────────────────────────────

const ITEMS: TodoItem[] = [
  { id: 'step-1', title: 'Open page', status: 'pending' },
  { id: 'step-2', title: 'Login', status: 'pending' },
  { id: 'step-3', title: 'Submit form', status: 'pending' },
];

describe('applyTodoUpdates', () => {
  it('returns items unchanged when updates is empty', () => {
    expect(applyTodoUpdates(ITEMS, [])).toEqual(ITEMS);
  });

  it('patches status of a matching item', () => {
    const result = applyTodoUpdates(ITEMS, [{ id: 'step-1', status: 'done' }]);
    expect(result[0].status).toBe('done');
  });

  it('patches notes of a matching item', () => {
    const result = applyTodoUpdates(ITEMS, [{ id: 'step-2', notes: 'used email' }]);
    expect(result[1].notes).toBe('used email');
  });

  it('patches both status and notes simultaneously', () => {
    const result = applyTodoUpdates(ITEMS, [
      { id: 'step-3', status: 'in_progress', notes: 'filling fields' },
    ]);
    expect(result[2]).toMatchObject({ status: 'in_progress', notes: 'filling fields' });
  });

  it('leaves unmatched items untouched when a valid update is present', () => {
    const result = applyTodoUpdates(ITEMS, [{ id: 'step-1', status: 'done' }]);
    expect(result[1]).toEqual(ITEMS[1]);
    expect(result[2]).toEqual(ITEMS[2]);
  });

  it('silently ignores an update whose id does not match any item', () => {
    const result = applyTodoUpdates(ITEMS, [{ id: 'nonexistent', status: 'done' }]);
    expect(result).toEqual(ITEMS);
  });

  it('does not apply status when update.status is undefined', () => {
    const result = applyTodoUpdates(ITEMS, [{ id: 'step-1', notes: 'note only' }]);
    expect(result[0].status).toBe('pending');
    expect(result[0].notes).toBe('note only');
  });

  it('does not apply notes when update.notes is undefined', () => {
    const result = applyTodoUpdates(ITEMS, [{ id: 'step-1', status: 'done' }]);
    expect(result[0].status).toBe('done');
    expect(result[0].notes).toBeUndefined();
  });

  it('does not mutate the original array', () => {
    const copy = ITEMS.map((i) => ({ ...i }));
    applyTodoUpdates(ITEMS, [{ id: 'step-1', status: 'done' }]);
    expect(ITEMS).toEqual(copy);
  });

  it('preserves item order after updates', () => {
    const result = applyTodoUpdates(ITEMS, [
      { id: 'step-2', status: 'skipped' },
      { id: 'step-3', status: 'done' },
    ]);
    expect(result.map((i) => i.id)).toEqual(['step-1', 'step-2', 'step-3']);
  });
});

// ── todo_add deduplication logic ─────────────────────────────────────────────
// The loop filters out items whose id already exists before appending.
// These tests exercise the same pure logic inline.

function applyTodoAdd(current: TodoItem[], incoming: TodoItem[]): TodoItem[] {
  const existingIds = new Set(current.map((i) => i.id));
  const newItems = incoming.filter((i) => !existingIds.has(i.id));
  return [...current, ...newItems];
}

describe('todo_add deduplication', () => {
  it('appends new items that do not exist yet', () => {
    const result = applyTodoAdd(ITEMS, [{ id: 'step-4', title: 'Extra step', status: 'pending' }]);
    expect(result).toHaveLength(4);
    expect(result[3].id).toBe('step-4');
  });

  it('silently ignores items whose id already exists', () => {
    const result = applyTodoAdd(ITEMS, [{ id: 'step-1', title: 'Duplicate', status: 'pending' }]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(ITEMS[0]); // original preserved, not overwritten
  });

  it('appends only the non-duplicate items from a mixed batch', () => {
    const incoming: TodoItem[] = [
      { id: 'step-2', title: 'Dup', status: 'pending' },
      { id: 'step-99', title: 'New', status: 'pending' },
    ];
    const result = applyTodoAdd(ITEMS, incoming);
    expect(result).toHaveLength(4);
    expect(result[3].id).toBe('step-99');
  });

  it('returns the original array unchanged when incoming is empty', () => {
    const result = applyTodoAdd(ITEMS, []);
    expect(result).toEqual(ITEMS);
  });

  it('does not mutate the original array', () => {
    const copy = [...ITEMS];
    applyTodoAdd(ITEMS, [{ id: 'step-4', title: 'New', status: 'pending' }]);
    expect(ITEMS).toEqual(copy);
  });

  it('appends to an empty list without error', () => {
    const item: TodoItem = { id: 'first', title: 'First item', status: 'in_progress' };
    const result = applyTodoAdd([], [item]);
    expect(result).toEqual([item]);
  });

  it('preserves insertion order of new items', () => {
    const incoming: TodoItem[] = [
      { id: 'x', title: 'X', status: 'pending' },
      { id: 'y', title: 'Y', status: 'pending' },
    ];
    const result = applyTodoAdd([], incoming);
    expect(result.map((i) => i.id)).toEqual(['x', 'y']);
  });
});

// ── formatTodoForPrompt ──────────────────────────────────────────────────────

describe('formatTodoForPrompt', () => {
  it('returns "(empty)" for empty array', () => {
    expect(formatTodoForPrompt([])).toBe('(empty)');
  });

  it('produces exact format: "emoji `id`: title" without notes', () => {
    const out = formatTodoForPrompt([{ id: 'go-login', title: 'Log in to site', status: 'pending' }]);
    expect(out).toBe('⭕ `go-login`: Log in to site');
  });

  it('produces exact format: "emoji `id`: title — notes" with notes', () => {
    const out = formatTodoForPrompt([
      { id: 'go-login', title: 'Log in to site', status: 'done', notes: 'used gmail' },
    ]);
    expect(out).toBe('✅ `go-login`: Log in to site — used gmail');
  });

  it.each([
    ['pending',     '⭕'],
    ['in_progress', '🔄'],
    ['done',        '✅'],
    ['skipped',     '⏭️'],
  ] as const)('uses correct icon for status "%s"', (status, icon) => {
    const out = formatTodoForPrompt([{ id: 't', title: 'T', status }]);
    expect(out.trimStart().startsWith(icon)).toBe(true);
  });

  it('includes notes when present and omits them when absent', () => {
    const withNotes = formatTodoForPrompt([{ id: 't', title: 'T', status: 'done', notes: 'note' }]);
    const noNotes  = formatTodoForPrompt([{ id: 't', title: 'T', status: 'done' }]);
    expect(withNotes).toContain('— note');
    expect(noNotes).not.toContain('—');
  });

  it('formats multiple items as newline-separated lines with correct content', () => {
    const items: TodoItem[] = [
      { id: 'a', title: 'First', status: 'done' },
      { id: 'b', title: 'Second', status: 'pending' },
    ];
    const lines = formatTodoForPrompt(items).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('✅ `a`: First');
    expect(lines[1]).toBe('⭕ `b`: Second');
  });
});
