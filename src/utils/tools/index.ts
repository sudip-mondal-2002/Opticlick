/**
 * Aggregates all agent tools and exposes a single parseToolCall helper.
 *
 * Import AGENT_TOOLS to bind to the model; import parseToolCall to convert
 * raw LangChain tool_calls into typed AgentAction objects.
 */

export { UI_TOOLS, clickTool, typeTool, navigateTool, scrollTool, pressKeyTool, dragAndDropTool } from './ui';
export { DOM_TOOLS, fetchDOMTool } from './dom';
export { VFS_TOOLS, vfsSaveScreenshotTool, vfsWriteTool, vfsDeleteTool, vfsDownloadTool } from './vfs';
export { MEMORY_TOOLS, memoryUpsertTool, memoryDeleteTool } from './memory';
export { TODO_TOOLS, todoCreateTool, todoUpdateTool, todoAddTool } from './todo';
export { SCRATCHPAD_TOOLS, noteWriteTool, noteDeleteTool } from './scratchpad';
export { CONTROL_TOOLS, finishTool, waitTool, askUserTool } from './control';

import { UI_TOOLS } from './ui';
import { DOM_TOOLS } from './dom';
import { VFS_TOOLS } from './vfs';
import { MEMORY_TOOLS } from './memory';
import { TODO_TOOLS } from './todo';
import { SCRATCHPAD_TOOLS } from './scratchpad';
import { CONTROL_TOOLS } from './control';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { AgentAction, TodoItem } from '../types';

/**
 * Full ordered tool list to pass to model.bindTools().
 *
 * Order matters for the model's implicit priority:
 *   1. Todo — keeps the plan current before anything else executes.
 *   2. VFS  — persist/fetch data.
 *   3. DOM  — inspect elements when the screenshot isn't enough.
 *   4. UI   — interact with the page (at most one per turn).
 *   5. Control — finish or wait.
 */
export const AGENT_TOOLS = [
  ...TODO_TOOLS,
  ...MEMORY_TOOLS,
  ...SCRATCHPAD_TOOLS,
  ...VFS_TOOLS,
  ...DOM_TOOLS,
  ...UI_TOOLS,
  ...CONTROL_TOOLS,
] as const;

// One compact schema replaces six repeated function definitions for text-only
// providers. parseToolCall expands it into the existing internal action union.
const textBrowserActionTool = tool(async () => 'ok', {
  name: 'browser_action',
  description: 'Exactly one command: click ID OR type TEXT OR go URL OR scroll DIR OR key KEY OR finish FACTS',
  schema: z.object({
    command: z.string(),
  }),
});
const textFinishActionTool = tool(async () => 'ok', {
  name: 'browser_action',
  description: 'Finish by returning every requested fact from the supplied evidence.',
  schema: z.object({
    summary: z.string().min(12).describe('Complete factual answer, not a placeholder'),
  }),
});

export const TEXT_AGENT_TOOLS = [textBrowserActionTool] as const;
export const TEXT_FINISH_TOOLS = [textFinishActionTool] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Tool-call parser
// ─────────────────────────────────────────────────────────────────────────────

type ScrollDirection = (AgentAction & { type: 'scroll' })['direction'];
type TodoUpdateItem = (AgentAction & { type: 'todo_update' })['updates'][number];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parsers: Record<string, (args: Record<string, any>) => AgentAction> = {
  browser_action: (args) => {
    if (typeof args.summary === 'string' && args.action === undefined) {
      return { type: 'finish', summary: args.summary };
    }
    if (typeof args.command === 'string') {
      const match = args.command.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
      const verb = match?.[1]?.toLowerCase();
      const value = match?.[2]?.trim() ?? '';
      const firstValue = value.split(/[;\r\n]/, 1)[0].trim();
      switch (verb) {
        case 'click': return { type: 'click', targetId: Number.parseInt(firstValue, 10) };
        case 'type': return { type: 'type', text: value, clearField: true };
        case 'go':
        case 'navigate': return { type: 'navigate', url: firstValue };
        case 'scroll': return { type: 'scroll', direction: (firstValue || 'down') as ScrollDirection };
        case 'key': return { type: 'press_key', key: firstValue };
        case 'finish': return { type: 'finish', summary: value };
        default: return { type: 'finish', summary: value || args.command };
      }
    }
    // Accept the former structured shape for persisted calls and backwards
    // compatibility while newly bound models receive only the one-string DSL.
    switch (args.action) {
      case 'click': return { type: 'click', targetId: args.targetId as number };
      case 'type': return { type: 'type', text: args.text as string, clearField: args.clearField as boolean | undefined };
      case 'navigate': return { type: 'navigate', url: args.url as string };
      case 'scroll': return { type: 'scroll', direction: (args.direction ?? 'down') as ScrollDirection };
      case 'key': return { type: 'press_key', key: args.key as string };
      case 'finish': return { type: 'finish', summary: args.summary as string };
      default: return { type: 'finish', summary: String(args.summary ?? '') };
    }
  },
  click: (args) => ({
    type: 'click',
    targetId: args.targetId as number,
    modifier: args.modifier as 'ctrl' | 'meta' | 'shift' | 'alt' | undefined,
    uploadFileId: args.uploadFileId as string | undefined,
  }),
  type: (args) => ({
    type: 'type',
    text: args.text as string,
    clearField: args.clearField as boolean | undefined,
  }),
  navigate: (args) => ({
    type: 'navigate',
    url: args.url as string,
  }),
  scroll: (args) => ({
    type: 'scroll',
    direction: args.direction as ScrollDirection,
    scrollTargetId: args.scrollTargetId as number | undefined,
  }),
  press_key: (args) => ({
    type: 'press_key',
    key: args.key as string,
  }),
  drag_and_drop: (args) => ({
    type: 'drag_and_drop',
    sourceId: args.sourceId as number,
    targetId: args.targetId as number | undefined,
    targetX: args.targetX as number | undefined,
    targetY: args.targetY as number | undefined,
  }),
  fetch_dom: (args) => ({
    type: 'fetch_dom',
    targetId: args.targetId as number,
  }),
  vfs_save_screenshot: (args) => ({
    type: 'vfs_save_screenshot',
    name: args.name as string,
  }),
  vfs_write: (args) => ({
    type: 'vfs_write',
    name: args.name as string,
    content: args.content as string,
    mimeType: args.mimeType as string | undefined,
  }),
  vfs_delete: (args) => ({
    type: 'vfs_delete',
    fileId: args.fileId as string,
  }),
  vfs_download: (args) => ({
    type: 'vfs_download',
    url: args.url as string,
    name: args.name as string | undefined,
  }),
  todo_create: (args) => ({
    type: 'todo_create',
    items: args.items as TodoItem[],
  }),
  todo_update: (args) => ({
    type: 'todo_update',
    updates: args.updates as TodoUpdateItem[],
  }),
  todo_add: (args) => ({
    type: 'todo_add',
    items: args.items as TodoItem[],
  }),
  note_write: (args) => ({
    type: 'note_write',
    key: args.key as string,
    value: args.value as string,
  }),
  note_delete: (args) => ({
    type: 'note_delete',
    key: args.key as string,
  }),
  memory_upsert: (args) => ({
    type: 'memory_upsert',
    key: args.key as string,
    values: args.values as string[],
    category: args.category as string,
    sourceUrl: args.sourceUrl as string | undefined,
  }),
  memory_delete: (args) => ({
    type: 'memory_delete',
    key: args.key as string,
  }),
  finish: (args) => ({
    type: 'finish',
    summary: String(args.summary ?? ''),
  }),
  wait: (args) => ({
    type: 'wait',
    ms: args.ms as number,
  }),
  ask_user: (args) => ({
    type: 'ask_user',
    question: args.question as string,
  }),
};

/**
 * Convert a raw LangChain tool_call (name + untyped args) into a typed AgentAction.
 * Returns null for unknown tool names so callers can log and skip gracefully.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseToolCall(name: string, args: Record<string, any>): AgentAction | null {
  const parser = parsers[name];
  if (!parser) return null;
  return parser(args);
}
