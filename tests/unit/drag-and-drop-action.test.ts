import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CoordinateEntry } from '@/utils/types';
import { dispatchDragAndDrop } from '@/utils/cdp';
import { appendConversationTurn } from '@/utils/db';
import { handleDragAndDrop } from '@/entrypoints/background/nodes/actions/drag-and-drop';

vi.mock('@/utils/cdp', () => ({
  dispatchDragAndDrop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/db', () => ({
  appendConversationTurn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/agent-log', () => ({
  log: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/tab-helpers', () => ({
  sendToTab: vi.fn().mockResolvedValue(undefined),
  ensureContentScript: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/sleep', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}));

const ctx = {
  tabId: 9,
  sessionId: 1,
  step: 3,
  userPrompt: 'Move the card',
  toolCallId: 'call_drag',
  toolName: 'drag_and_drop',
};

function entry(id: number, x: number, y: number, text = `Element ${id}`): CoordinateEntry {
  return {
    id,
    tag: 'div',
    text,
    rect: { x, y, left: x - 10, top: y - 10, width: 20, height: 20 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleDragAndDrop', () => {
  it('resolves source and targetId coordinates and dispatches drag-and-drop', async () => {
    await handleDragAndDrop(
      { type: 'drag_and_drop', sourceId: 1, targetId: 2 },
      ctx,
      [entry(1, 100, 150, 'Card A'), entry(2, 300, 350, 'Column B')],
    );

    expect(dispatchDragAndDrop).toHaveBeenCalledWith(
      9,
      { x: 100, y: 150 },
      { x: 300, y: 350 },
    );
  });

  it('supports coordinate drop targets', async () => {
    await handleDragAndDrop(
      { type: 'drag_and_drop', sourceId: 1, targetX: 500, targetY: 300 },
      ctx,
      [entry(1, 100, 150, 'Card A')],
    );

    expect(dispatchDragAndDrop).toHaveBeenCalledWith(
      9,
      { x: 100, y: 150 },
      { x: 500, y: 300 },
    );
  });

  it('fails when sourceId does not exist', async () => {
    await handleDragAndDrop(
      { type: 'drag_and_drop', sourceId: 99, targetId: 2 },
      ctx,
      [entry(2, 300, 350)],
    );

    expect(dispatchDragAndDrop).not.toHaveBeenCalled();
    expect(appendConversationTurn).toHaveBeenCalledWith(
      1,
      'tool',
      expect.stringContaining('Source ID 99 not found'),
      { toolCallId: 'call_drag', toolName: 'drag_and_drop' },
    );
  });

  it('fails when targetId does not exist', async () => {
    await handleDragAndDrop(
      { type: 'drag_and_drop', sourceId: 1, targetId: 99 },
      ctx,
      [entry(1, 100, 150)],
    );

    expect(dispatchDragAndDrop).not.toHaveBeenCalled();
    expect(appendConversationTurn).toHaveBeenCalledWith(
      1,
      'tool',
      expect.stringContaining('Target ID 99 not found'),
      { toolCallId: 'call_drag', toolName: 'drag_and_drop' },
    );
  });

  it('fails when coordinate target is incomplete', async () => {
    await handleDragAndDrop(
      { type: 'drag_and_drop', sourceId: 1, targetX: 500 },
      ctx,
      [entry(1, 100, 150)],
    );

    expect(dispatchDragAndDrop).not.toHaveBeenCalled();
    expect(appendConversationTurn).toHaveBeenCalledWith(
      1,
      'tool',
      expect.stringContaining('targetId or both targetX and targetY'),
      { toolCallId: 'call_drag', toolName: 'drag_and_drop' },
    );
  });

  it('fails when coordinates are invalid', async () => {
    await handleDragAndDrop(
      { type: 'drag_and_drop', sourceId: 1, targetX: Number.NaN, targetY: 300 },
      ctx,
      [entry(1, 100, 150)],
    );

    expect(dispatchDragAndDrop).not.toHaveBeenCalled();
    expect(appendConversationTurn).toHaveBeenCalledWith(
      1,
      'tool',
      expect.stringContaining('Invalid drag target coordinates'),
      { toolCallId: 'call_drag', toolName: 'drag_and_drop' },
    );
  });
});
