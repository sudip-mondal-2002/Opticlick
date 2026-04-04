/**
 * Unit tests for src/utils/tools/todo.ts
 *
 * Tests the LangChain tool objects: names, descriptions, schemas, and invocation.
 * Note: parseToolCall integration for todo_* tools is covered in tools-parseToolCall.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { todoCreateTool, todoUpdateTool, todoAddTool, TODO_TOOLS } from '@/utils/tools/todo';

describe('todoCreateTool', () => {
  it('has name "todo_create"', () => {
    expect(todoCreateTool.name).toBe('todo_create');
  });

  it('has a non-empty description', () => {
    expect(todoCreateTool.description.length).toBeGreaterThan(0);
  });

  it('returns "ok" when invoked with valid items', async () => {
    const result = await todoCreateTool.invoke({
      items: [
        { id: 'step-1', title: 'Navigate to login', status: 'in_progress' },
        { id: 'step-2', title: 'Enter credentials', status: 'pending' },
      ],
    });
    expect(result).toBe('ok');
  });

  it('returns "ok" for a single item with optional notes', async () => {
    const result = await todoCreateTool.invoke({
      items: [{ id: 'only-step', title: 'Do the thing', status: 'pending', notes: 'Context here' }],
    });
    expect(result).toBe('ok');
  });

  it('returns "ok" for an empty items array (replaces plan)', async () => {
    const result = await todoCreateTool.invoke({ items: [] });
    expect(result).toBe('ok');
  });
});

describe('todoUpdateTool', () => {
  it('has name "todo_update"', () => {
    expect(todoUpdateTool.name).toBe('todo_update');
  });

  it('has a non-empty description', () => {
    expect(todoUpdateTool.description.length).toBeGreaterThan(0);
  });

  it('returns "ok" with a full update (status + notes)', async () => {
    const result = await todoUpdateTool.invoke({
      updates: [{ id: 'step-1', status: 'done', notes: 'Page loaded successfully' }],
    });
    expect(result).toBe('ok');
  });

  it('returns "ok" with only id (all other fields optional)', async () => {
    const result = await todoUpdateTool.invoke({
      updates: [{ id: 'step-2' }],
    });
    expect(result).toBe('ok');
  });

  it('returns "ok" with status "skipped"', async () => {
    const result = await todoUpdateTool.invoke({
      updates: [{ id: 'step-3', status: 'skipped' }],
    });
    expect(result).toBe('ok');
  });

  it('returns "ok" with multiple updates in one call', async () => {
    const result = await todoUpdateTool.invoke({
      updates: [
        { id: 'step-1', status: 'done' },
        { id: 'step-2', status: 'in_progress', notes: 'Starting now' },
      ],
    });
    expect(result).toBe('ok');
  });
});

describe('todoAddTool', () => {
  it('has name "todo_add"', () => {
    expect(todoAddTool.name).toBe('todo_add');
  });

  it('has a non-empty description', () => {
    expect(todoAddTool.description.length).toBeGreaterThan(0);
  });

  it('returns "ok" when appending a new pending task', async () => {
    const result = await todoAddTool.invoke({
      items: [{ id: 'extra-step', title: 'Handle CAPTCHA', status: 'pending' }],
    });
    expect(result).toBe('ok');
  });

  it('returns "ok" when appending multiple new tasks', async () => {
    const result = await todoAddTool.invoke({
      items: [
        { id: 'nav-back', title: 'Navigate back', status: 'in_progress', notes: 'got redirected' },
        { id: 'retry-login', title: 'Retry login', status: 'pending' },
      ],
    });
    expect(result).toBe('ok');
  });

  it('returns "ok" for an empty items array', async () => {
    const result = await todoAddTool.invoke({ items: [] });
    expect(result).toBe('ok');
  });
});

describe('TODO_TOOLS', () => {
  it('contains exactly three tools', () => {
    expect(TODO_TOOLS).toHaveLength(3);
  });

  it('includes todoCreateTool, todoUpdateTool, todoAddTool', () => {
    const names = TODO_TOOLS.map((t) => t.name);
    expect(names).toContain('todo_create');
    expect(names).toContain('todo_update');
    expect(names).toContain('todo_add');
  });

  it('has unique tool names', () => {
    const names = TODO_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(3);
  });

  it('every tool has a non-empty description', () => {
    for (const t of TODO_TOOLS) {
      expect(t.description.length, `${t.name} should have a description`).toBeGreaterThan(0);
    }
  });
});
