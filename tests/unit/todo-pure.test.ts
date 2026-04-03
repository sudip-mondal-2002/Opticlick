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

// ── formatTodoForPrompt ──────────────────────────────────────────────────────

describe('formatTodoForPrompt', () => {
  it('returns "(empty)" for empty array', () => {
    expect(formatTodoForPrompt([])).toBe('(empty)');
  });

  it('produces exact format: "  [icon] id: title" without notes', () => {
    const out = formatTodoForPrompt([{ id: 'go-login', title: 'Log in to site', status: 'pending' }]);
    expect(out).toBe('  [ ] go-login: Log in to site');
  });

  it('produces exact format: "  [icon] id: title  # notes" with notes', () => {
    const out = formatTodoForPrompt([
      { id: 'go-login', title: 'Log in to site', status: 'done', notes: 'used gmail' },
    ]);
    expect(out).toBe('  [✓] go-login: Log in to site  # used gmail');
  });

  it.each([
    ['pending',     '[ ]'],
    ['in_progress', '[→]'],
    ['done',        '[✓]'],
    ['skipped',     '[-]'],
  ] as const)('uses correct icon for status "%s"', (status, icon) => {
    const out = formatTodoForPrompt([{ id: 't', title: 'T', status }]);
    expect(out.trimStart().startsWith(icon)).toBe(true);
  });

  it('includes notes when present and omits them when absent', () => {
    const withNotes = formatTodoForPrompt([{ id: 't', title: 'T', status: 'done', notes: 'note' }]);
    const noNotes  = formatTodoForPrompt([{ id: 't', title: 'T', status: 'done' }]);
    expect(withNotes).toContain('# note');
    expect(noNotes).not.toContain('#');
  });

  it('formats multiple items as newline-separated lines with correct content', () => {
    const items: TodoItem[] = [
      { id: 'a', title: 'First', status: 'done' },
      { id: 'b', title: 'Second', status: 'pending' },
    ];
    const lines = formatTodoForPrompt(items).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('  [✓] a: First');
    expect(lines[1]).toBe('  [ ] b: Second');
  });
});
