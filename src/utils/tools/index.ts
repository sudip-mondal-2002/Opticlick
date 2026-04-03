/**
 * Aggregates all agent tools and exposes a single parseToolCall helper.
 *
 * Import AGENT_TOOLS to bind to the model; import parseToolCall to convert
 * raw LangChain tool_calls into typed AgentAction objects.
 */

export { UI_TOOLS, clickTool, navigateTool, scrollTool, pressKeyTool } from './ui';
export { DOM_TOOLS, fetchDOMTool } from './dom';
export { VFS_TOOLS, vfsSaveScreenshotTool, vfsWriteTool, vfsDeleteTool, vfsDownloadTool } from './vfs';
export { TODO_TOOLS, todoCreateTool, todoUpdateTool } from './todo';
export { CONTROL_TOOLS, finishTool, waitTool } from './control';

import { UI_TOOLS } from './ui';
import { DOM_TOOLS } from './dom';
import { VFS_TOOLS } from './vfs';
import { TODO_TOOLS } from './todo';
import { CONTROL_TOOLS } from './control';
import type { AgentAction, TodoItem, TodoUpdate } from '../types';

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
  ...VFS_TOOLS,
  ...DOM_TOOLS,
  ...UI_TOOLS,
  ...CONTROL_TOOLS,
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Tool-call parser
// ─────────────────────────────────────────────────────────────────────────────

type ScrollDirection = (AgentAction & { type: 'scroll' })['direction'];
type TodoUpdateItem = (AgentAction & { type: 'todo_update' })['updates'][number];

/**
 * Convert a raw LangChain tool_call (name + untyped args) into a typed AgentAction.
 * Returns null for unknown tool names so callers can log and skip gracefully.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseToolCall(name: string, args: Record<string, any>): AgentAction | null {
  switch (name) {
    // ── UI ──────────────────────────────────────────────────────────────────
    case 'click':
      return {
        type: 'click',
        targetId: args.targetId as number,
        modifier: args.modifier as 'ctrl' | 'meta' | 'shift' | 'alt' | undefined,
        clearField: args.clearField as boolean | undefined,
        typeText: args.typeText as string | undefined,
        pressKey: args.pressKey as string | undefined,
        uploadFileId: args.uploadFileId as string | undefined,
      };
    case 'navigate':
      return { type: 'navigate', url: args.url as string };
    case 'scroll':
      return {
        type: 'scroll',
        direction: args.direction as ScrollDirection,
        scrollTargetId: args.scrollTargetId as number | undefined,
      };
    case 'press_key':
      return { type: 'press_key', key: args.key as string };

    // ── DOM ─────────────────────────────────────────────────────────────────
    case 'fetch_dom':
      return { type: 'fetch_dom', targetId: args.targetId as number };

    // ── VFS ─────────────────────────────────────────────────────────────────
    case 'vfs_save_screenshot':
      return { type: 'vfs_save_screenshot', name: args.name as string };
    case 'vfs_write':
      return {
        type: 'vfs_write',
        name: args.name as string,
        content: args.content as string,
        mimeType: args.mimeType as string | undefined,
      };
    case 'vfs_delete':
      return { type: 'vfs_delete', fileId: args.fileId as string };
    case 'vfs_download':
      return {
        type: 'vfs_download',
        url: args.url as string,
        name: args.name as string | undefined,
      };

    // ── Todo ─────────────────────────────────────────────────────────────────
    case 'todo_create':
      return { type: 'todo_create', items: args.items as TodoItem[] };
    case 'todo_update':
      return { type: 'todo_update', updates: args.updates as TodoUpdateItem[] };

    // ── Control ──────────────────────────────────────────────────────────────
    case 'finish':
      return { type: 'finish', summary: args.summary as string | undefined };
    case 'wait':
      return { type: 'wait', ms: args.ms as number };

    default:
      return null;
  }
}
