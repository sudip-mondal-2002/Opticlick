import type { AgentAction, CoordinateEntry, ActionRecord } from '@/utils/types';
import type { AgentState } from './agent-state';
import { handleClick } from './nodes/actions/click';
import { handleNavigate } from './nodes/actions/navigate';
import { handleScroll } from './nodes/actions/scroll';
import { handleType } from './nodes/actions/type';
import { handlePressKey } from './nodes/actions/press-key';
import { handleDragAndDrop } from './nodes/actions/drag-and-drop';

import {
  handleVfsSaveScreenshot,
  handleVfsWrite,
  handleVfsDelete,
  handleVfsDownload,
} from './nodes/effects/vfs';
import {
  handleTodoCreate,
  handleTodoUpdate,
  handleTodoAdd,
} from './nodes/effects/todo';
import {
  handleMemoryUpsert,
  handleMemoryDelete,
  handleNoteWrite,
  handleNoteDelete,
} from './nodes/effects/memory';
import { handleFetchDom } from './nodes/effects/dom-inspect';
import { sleep } from '@/utils/sleep';
import { log } from '@/utils/agent-log';
import { appendConversationTurn } from '@/utils/db';

export interface UIActionContext {
  tabId: number;
  sessionId: number;
  step: number;
  userPrompt: string;
  toolCallId: string;
  toolName: string;
  coordinateMap: CoordinateEntry[];
  actionHistory: ActionRecord[];
  tabIdRef: { current: number };
}

export interface SideEffectContext {
  sessionId: number;
  tabId: number;
  base64Image: string;
  step: number;
  coordinateMap: CoordinateEntry[];
  userPrompt: string;
  toolCallId: string;
  toolName: string;
  state: AgentState;
}

export interface UIActionHandler<T extends AgentAction = AgentAction> {
  type: T['type'];
  execute(action: T, ctx: UIActionContext): Promise<Partial<AgentState> | void>;
}

export interface SideEffectHandler<T extends AgentAction = AgentAction> {
  type: T['type'];
  execute(action: T, ctx: SideEffectContext): Promise<Partial<AgentState> | void>;
}

class UIActionRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers = new Map<string, UIActionHandler<any>>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(handler: UIActionHandler<any>) {
    this.handlers.set(handler.type, handler);
  }

  get<T extends AgentAction>(type: T['type']): UIActionHandler<T> | undefined {
    return this.handlers.get(type) as UIActionHandler<T> | undefined;
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }
}

class SideEffectRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlers = new Map<string, SideEffectHandler<any>>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(handler: SideEffectHandler<any>) {
    this.handlers.set(handler.type, handler);
  }

  get<T extends AgentAction>(type: T['type']): SideEffectHandler<T> | undefined {
    return this.handlers.get(type) as SideEffectHandler<T> | undefined;
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }
}

export const uiActionRegistry = new UIActionRegistry();
export const sideEffectRegistry = new SideEffectRegistry();

// ── Helpers to extract handler-specific contexts ──────────────────────────────

function makeActionCtx(ctx: UIActionContext) {
  return {
    tabId: ctx.tabId,
    sessionId: ctx.sessionId,
    step: ctx.step,
    userPrompt: ctx.userPrompt,
    toolCallId: ctx.toolCallId,
    toolName: ctx.toolName,
  };
}

function makeEffectCtx(ctx: SideEffectContext) {
  return {
    sessionId: ctx.sessionId,
    tabId: ctx.tabId,
    base64Image: ctx.base64Image,
    step: ctx.step,
    coordinateMap: ctx.coordinateMap,
    userPrompt: ctx.userPrompt,
    toolCallId: ctx.toolCallId,
    toolName: ctx.toolName,
  };
}

// ── UI Action registrations ───────────────────────────────────────────────────

uiActionRegistry.register({
  type: 'click',
  execute: async (action, ctx) => {
    const tabId = await handleClick(action, makeActionCtx(ctx), ctx.coordinateMap, ctx.tabIdRef);
    return { tabId };
  },
});

uiActionRegistry.register({
  type: 'navigate',
  execute: async (action, ctx) => {
    await handleNavigate(action, makeActionCtx(ctx));
  },
});

uiActionRegistry.register({
  type: 'scroll',
  execute: async (action, ctx) => {
    const actionHistory = await handleScroll(
      action,
      makeActionCtx(ctx),
      ctx.actionHistory,
      ctx.coordinateMap,
    );
    return { actionHistory };
  },
});

uiActionRegistry.register({
  type: 'type',
  execute: async (action, ctx) => {
    await handleType(action, makeActionCtx(ctx));
  },
});

uiActionRegistry.register({
  type: 'press_key',
  execute: async (action, ctx) => {
    await handlePressKey(action, makeActionCtx(ctx));
  },
});

uiActionRegistry.register({
  type: 'drag_and_drop',
  execute: async (action, ctx) => {
    await handleDragAndDrop(action, makeActionCtx(ctx), ctx.coordinateMap);
  },
});

// ── Side Effect registrations ─────────────────────────────────────────────────

sideEffectRegistry.register({
  type: 'vfs_save_screenshot',
  execute: async (action, ctx) => {
    await handleVfsSaveScreenshot(action, makeEffectCtx(ctx));
  },
});

sideEffectRegistry.register({
  type: 'vfs_write',
  execute: async (action, ctx) => {
    await handleVfsWrite(action, makeEffectCtx(ctx));
  },
});

sideEffectRegistry.register({
  type: 'vfs_delete',
  execute: async (action, ctx) => {
    await handleVfsDelete(action, makeEffectCtx(ctx));
  },
});

sideEffectRegistry.register({
  type: 'vfs_download',
  execute: async (action, ctx) => {
    await handleVfsDownload(action, makeEffectCtx(ctx));
  },
});

sideEffectRegistry.register({
  type: 'todo_create',
  execute: async (action, ctx) => {
    const currentTodo = await handleTodoCreate(action, makeEffectCtx(ctx));
    return { currentTodo };
  },
});

sideEffectRegistry.register({
  type: 'todo_update',
  execute: async (action, ctx) => {
    const currentTodo = await handleTodoUpdate(action, makeEffectCtx(ctx), ctx.state.currentTodo);
    return { currentTodo };
  },
});

sideEffectRegistry.register({
  type: 'todo_add',
  execute: async (action, ctx) => {
    const currentTodo = await handleTodoAdd(action, makeEffectCtx(ctx), ctx.state.currentTodo);
    return { currentTodo };
  },
});

sideEffectRegistry.register({
  type: 'fetch_dom',
  execute: async (action, ctx) => {
    await handleFetchDom(action, makeEffectCtx(ctx));
  },
});

sideEffectRegistry.register({
  type: 'wait',
  execute: async (action, ctx) => {
    await log(`Waiting ${action.ms} ms…`, 'act');
    await sleep(action.ms);
    await appendConversationTurn(ctx.sessionId, 'tool', `Waited ${action.ms} ms`, {
      toolCallId: ctx.toolCallId,
      toolName: ctx.toolName,
    });
  },
});

sideEffectRegistry.register({
  type: 'memory_upsert',
  execute: async (action, ctx) => {
    const memoryEntries = await handleMemoryUpsert(action, makeEffectCtx(ctx), ctx.state.memoryEntries);
    return { memoryEntries };
  },
});

sideEffectRegistry.register({
  type: 'memory_delete',
  execute: async (action, ctx) => {
    const memoryEntries = await handleMemoryDelete(action, makeEffectCtx(ctx), ctx.state.memoryEntries);
    return { memoryEntries };
  },
});

sideEffectRegistry.register({
  type: 'note_write',
  execute: async (action, ctx) => {
    const scratchpadEntries = await handleNoteWrite(action, makeEffectCtx(ctx), ctx.state.scratchpadEntries);
    return { scratchpadEntries };
  },
});

sideEffectRegistry.register({
  type: 'note_delete',
  execute: async (action, ctx) => {
    const scratchpadEntries = await handleNoteDelete(action, makeEffectCtx(ctx), ctx.state.scratchpadEntries);
    return { scratchpadEntries };
  },
});

sideEffectRegistry.register({
  type: 'ask_user',
  execute: async (action, _ctx) => {
    await log(`Question: ${action.question}`, 'observe');
    return { askUserQuestion: action.question };
  },
});

sideEffectRegistry.register({
  type: 'finish',
  execute: async (action, ctx) => {
    await appendConversationTurn(ctx.sessionId, 'tool', `Task complete: ${action.summary}`, {
      toolCallId: ctx.toolCallId,
      toolName: ctx.toolName,
    });
  },
});
