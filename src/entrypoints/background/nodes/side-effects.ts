/**
 * Graph node: sideEffects.
 *
 * Executes all non-UI tool calls returned by the LLM in the current turn:
 * VFS mutations, todo management, DOM inspection, wait, memory, scratchpad,
 * ask_user setup, and finish acknowledgement. Stores a tool-result
 * conversation turn for each action so the LLM can track execution state.
 */

import { appendConversationTurn } from '@/utils/db';
import { log } from '@/utils/agent-log';
import { sleep } from '@/utils/sleep';
import { handleVfsSaveScreenshot, handleVfsWrite, handleVfsDelete, handleVfsDownload } from './effects/vfs';
import { handleTodoCreate, handleTodoUpdate, handleTodoAdd } from './effects/todo';
import { handleMemoryUpsert, handleMemoryDelete, handleNoteWrite, handleNoteDelete } from './effects/memory';
import { handleFetchDom } from './effects/dom-inspect';
import type { AgentState } from '../agent-state';
import type { EffectCtx } from './effects/ctx';

export async function sideEffectsNode(state: AgentState): Promise<Partial<AgentState>> {
  const { actions, rawToolCalls, sessionId, tabId, base64Image, step, coordinateMap, userPrompt } = state;
  let currentTodo = state.currentTodo;
  let memoryEntries = state.memoryEntries;
  let scratchpadEntries = state.scratchpadEntries;
  let askUserQuestion: string | undefined;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const toolCallId = rawToolCalls[i]?.id ?? '';
    const toolName = rawToolCalls[i]?.name ?? action.type;
    const ctx: EffectCtx = {
      sessionId, tabId, base64Image, step, coordinateMap, userPrompt, toolCallId, toolName,
    };

    switch (action.type) {
      // ── VFS ──────────────────────────────────────────────────────────────────
      case 'vfs_save_screenshot':
        await handleVfsSaveScreenshot(action, ctx);
        break;
      case 'vfs_write':
        await handleVfsWrite(action, ctx);
        break;
      case 'vfs_delete':
        await handleVfsDelete(action, ctx);
        break;
      case 'vfs_download':
        await handleVfsDownload(action, ctx);
        break;

      // ── Todo ──────────────────────────────────────────────────────────────────
      case 'todo_create':
        currentTodo = await handleTodoCreate(action, ctx);
        break;
      case 'todo_update':
        currentTodo = await handleTodoUpdate(action, ctx, currentTodo);
        break;
      case 'todo_add':
        currentTodo = await handleTodoAdd(action, ctx, currentTodo);
        break;

      // ── DOM inspection ────────────────────────────────────────────────────────
      case 'fetch_dom':
        await handleFetchDom(action, ctx);
        break;

      // ── Wait ──────────────────────────────────────────────────────────────────
      case 'wait':
        await log(`Waiting ${action.ms} ms…`, 'act');
        await sleep(action.ms);
        await appendConversationTurn(sessionId, 'tool', `Waited ${action.ms} ms`, { toolCallId, toolName });
        break;

      // ── Memory ────────────────────────────────────────────────────────────────
      case 'memory_upsert':
        memoryEntries = await handleMemoryUpsert(action, ctx, memoryEntries);
        break;
      case 'memory_delete':
        memoryEntries = await handleMemoryDelete(action, ctx, memoryEntries);
        break;

      // ── Scratchpad ────────────────────────────────────────────────────────────
      case 'note_write':
        scratchpadEntries = await handleNoteWrite(action, ctx, scratchpadEntries);
        break;
      case 'note_delete':
        scratchpadEntries = await handleNoteDelete(action, ctx, scratchpadEntries);
        break;

      // ── Ask user ──────────────────────────────────────────────────────────────
      case 'ask_user':
        askUserQuestion = action.question;
        await log(`Question: ${action.question}`, 'observe');
        break;

      // ── Finish ────────────────────────────────────────────────────────────────
      case 'finish':
        await appendConversationTurn(
          sessionId, 'tool',
          `Task complete: ${action.summary}`,
          { toolCallId, toolName },
        );
        break;

      // UI actions are handled by uiActionNode
      default:
        break;
    }
  }

  return { currentTodo, memoryEntries, scratchpadEntries, askUserQuestion };
}
