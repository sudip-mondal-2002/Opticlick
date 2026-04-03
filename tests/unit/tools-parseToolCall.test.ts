import { describe, it, expect } from 'vitest';
import { parseToolCall } from '@/utils/tools/index';
import type { AgentAction, TodoItem } from '@/utils/types';

describe('parseToolCall', () => {
  it('returns null for unknown tool name', () => {
    expect(parseToolCall('unknown_tool', {})).toBeNull();
  });

  it('returns null for empty string name', () => {
    expect(parseToolCall('', {})).toBeNull();
  });

  // ── UI ──────────────────────────────────────────────────────────────────────

  it('parses "click" with required targetId only', () => {
    const result = parseToolCall('click', { targetId: 5 }) as AgentAction & { type: 'click' };
    expect(result.type).toBe('click');
    expect(result.targetId).toBe(5);
    expect(result.modifier).toBeUndefined();
    expect(result.typeText).toBeUndefined();
    expect(result.uploadFileId).toBeUndefined();
  });

  it('parses "click" with all optional fields', () => {
    const result = parseToolCall('click', {
      targetId: 7,
      modifier: 'ctrl',
      clearField: true,
      typeText: 'hello world',
      pressKey: 'Enter',
      uploadFileId: 'uuid-123',
    }) as AgentAction & { type: 'click' };
    expect(result.type).toBe('click');
    expect(result.targetId).toBe(7);
    expect(result.modifier).toBe('ctrl');
    expect(result.clearField).toBe(true);
    expect(result.typeText).toBe('hello world');
    expect(result.pressKey).toBe('Enter');
    expect(result.uploadFileId).toBe('uuid-123');
  });

  it('parses "navigate"', () => {
    const result = parseToolCall('navigate', { url: 'https://example.com' }) as AgentAction & { type: 'navigate' };
    expect(result.type).toBe('navigate');
    expect(result.url).toBe('https://example.com');
  });

  it('parses "scroll" with direction only', () => {
    const result = parseToolCall('scroll', { direction: 'down' }) as AgentAction & { type: 'scroll' };
    expect(result.type).toBe('scroll');
    expect(result.direction).toBe('down');
    expect(result.scrollTargetId).toBeUndefined();
  });

  it('parses "scroll" with scrollTargetId', () => {
    const result = parseToolCall('scroll', { direction: 'up', scrollTargetId: 3 }) as AgentAction & { type: 'scroll' };
    expect(result.scrollTargetId).toBe(3);
  });

  it('parses "press_key"', () => {
    const result = parseToolCall('press_key', { key: 'Escape' }) as AgentAction & { type: 'press_key' };
    expect(result.type).toBe('press_key');
    expect(result.key).toBe('Escape');
  });

  // ── DOM ────────────────────────────────────────────────────────────────────

  it('parses "fetch_dom"', () => {
    const result = parseToolCall('fetch_dom', { targetId: 12 }) as AgentAction & { type: 'fetch_dom' };
    expect(result.type).toBe('fetch_dom');
    expect(result.targetId).toBe(12);
  });

  // ── VFS ────────────────────────────────────────────────────────────────────

  it('parses "vfs_save_screenshot"', () => {
    const result = parseToolCall('vfs_save_screenshot', { name: 'step1.png' }) as AgentAction & { type: 'vfs_save_screenshot' };
    expect(result.type).toBe('vfs_save_screenshot');
    expect(result.name).toBe('step1.png');
  });

  it('parses "vfs_write" without mimeType', () => {
    const result = parseToolCall('vfs_write', { name: 'data.json', content: '{}' }) as AgentAction & { type: 'vfs_write' };
    expect(result.type).toBe('vfs_write');
    expect(result.name).toBe('data.json');
    expect(result.content).toBe('{}');
    expect(result.mimeType).toBeUndefined();
  });

  it('parses "vfs_write" with mimeType override', () => {
    const result = parseToolCall('vfs_write', {
      name: 'data.json',
      content: '{}',
      mimeType: 'application/json',
    }) as AgentAction & { type: 'vfs_write' };
    expect(result.mimeType).toBe('application/json');
  });

  it('parses "vfs_delete"', () => {
    const result = parseToolCall('vfs_delete', { fileId: 'abc-123' }) as AgentAction & { type: 'vfs_delete' };
    expect(result.type).toBe('vfs_delete');
    expect(result.fileId).toBe('abc-123');
  });

  it('parses "vfs_download" without name', () => {
    const result = parseToolCall('vfs_download', { url: 'https://example.com/file.pdf' }) as AgentAction & { type: 'vfs_download' };
    expect(result.type).toBe('vfs_download');
    expect(result.url).toBe('https://example.com/file.pdf');
    expect(result.name).toBeUndefined();
  });

  it('parses "vfs_download" with name override', () => {
    const result = parseToolCall('vfs_download', {
      url: 'https://example.com/file.pdf',
      name: 'document.pdf',
    }) as AgentAction & { type: 'vfs_download' };
    expect(result.name).toBe('document.pdf');
  });

  // ── Todo ──────────────────────────────────────────────────────────────────

  it('parses "todo_create" with items array', () => {
    const items: TodoItem[] = [
      { id: 'step-1', title: 'Navigate', status: 'pending' },
    ];
    const result = parseToolCall('todo_create', { items }) as AgentAction & { type: 'todo_create' };
    expect(result.type).toBe('todo_create');
    expect(result.items).toEqual(items);
  });

  it('parses "todo_update" with updates array', () => {
    const updates = [{ id: 'step-1', status: 'done' as const }];
    const result = parseToolCall('todo_update', { updates }) as AgentAction & { type: 'todo_update' };
    expect(result.type).toBe('todo_update');
    expect(result.updates).toEqual(updates);
  });

  // ── Control ───────────────────────────────────────────────────────────────

  it('parses "finish" with summary', () => {
    const result = parseToolCall('finish', { summary: 'Task complete' }) as AgentAction & { type: 'finish' };
    expect(result.type).toBe('finish');
    expect(result.summary).toBe('Task complete');
  });

  it('parses "finish" without summary (undefined)', () => {
    const result = parseToolCall('finish', {}) as AgentAction & { type: 'finish' };
    expect(result.type).toBe('finish');
    expect(result.summary).toBeUndefined();
  });

  it('parses "wait"', () => {
    const result = parseToolCall('wait', { ms: 1500 }) as AgentAction & { type: 'wait' };
    expect(result.type).toBe('wait');
    expect(result.ms).toBe(1500);
  });

  it('covers all 13 named tool types', () => {
    const toolNames = [
      'click', 'navigate', 'scroll', 'press_key',
      'fetch_dom',
      'vfs_save_screenshot', 'vfs_write', 'vfs_delete', 'vfs_download',
      'todo_create', 'todo_update',
      'finish', 'wait',
    ];
    for (const name of toolNames) {
      const minimalArgs: Record<string, unknown> = {
        click: { targetId: 1 },
        navigate: { url: 'https://x.com' },
        scroll: { direction: 'down' },
        press_key: { key: 'Enter' },
        fetch_dom: { targetId: 1 },
        vfs_save_screenshot: { name: 'x.png' },
        vfs_write: { name: 'x.txt', content: '' },
        vfs_delete: { fileId: 'id' },
        vfs_download: { url: 'https://x.com' },
        todo_create: { items: [] },
        todo_update: { updates: [] },
        finish: {},
        wait: { ms: 100 },
      }[name] as Record<string, unknown>;
      expect(parseToolCall(name, minimalArgs), `tool "${name}" should not return null`).not.toBeNull();
    }
  });
});
