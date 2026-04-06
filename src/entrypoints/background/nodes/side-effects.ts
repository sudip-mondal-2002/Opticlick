/**
 * Graph node: sideEffects.
 *
 * Executes all non-UI tool calls returned by the LLM in the current turn:
 * VFS mutations, todo management, DOM inspection, wait, memory, scratchpad,
 * ask_user setup, and finish acknowledgement. Stores a tool-result
 * conversation turn for each action so the LLM can track execution state.
 */

import {
  appendConversationTurn,
  writeVFSFile,
  deleteVFSFile,
  upsertMemory,
  deleteMemory,
} from '@/utils/db';
import { saveTodoToVFS, applyTodoUpdates } from '@/utils/todo';
import { saveScratchpadToVFS, upsertScratchpadEntry, deleteScratchpadEntry } from '@/utils/scratchpad';
import { arrayBufferToBase64 } from '@/utils/base64';
import { log } from '@/utils/agent-log';
import { sendToTab } from '@/utils/tab-helpers';
import { sleep } from '@/utils/sleep';
import type { TodoItem } from '@/utils/types';
import type { AgentState } from '../agent-state';

// ── Helper ────────────────────────────────────────────────────────────────────

function filenameFromResponse(response: Response, url: string, override?: string): string {
  if (override?.trim()) return override.trim();
  const cd = response.headers.get('Content-Disposition');
  if (cd) {
    const m = cd.match(/filename\*?=(?:UTF-8''|"?)([^";\r\n]+)/i);
    if (m) return decodeURIComponent(m[1].trim().replace(/^"|"$/g, ''));
  }
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch { /* ignore */ }
  return 'download';
}

// ── Node: sideEffects ─────────────────────────────────────────────────────────

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

    switch (action.type) {
      // ── VFS ──────────────────────────────────────────────────────────────────
      case 'vfs_save_screenshot': {
        const fname = action.name.trim() || `step_${step}.png`;
        const saved = await writeVFSFile(sessionId, fname, base64Image, 'image/png');
        const result = `Saved screenshot as "${saved.name}" (id: ${saved.id})`;
        await log(`VFS: saved screenshot → "${saved.name}"`, 'info');
        await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
        break;
      }

      case 'vfs_write': {
        const { name, content, mimeType = 'text/plain' } = action;
        const base64Content = btoa(
          Array.from(new TextEncoder().encode(content), (b) => String.fromCharCode(b)).join(''),
        );
        const saved = await writeVFSFile(sessionId, name, base64Content, mimeType);
        const result = `Wrote "${saved.name}" (${saved.size} B, id: ${saved.id})`;
        await log(`VFS: wrote "${saved.name}" (${saved.size} B)`, 'info');
        await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
        break;
      }

      case 'vfs_delete': {
        await deleteVFSFile(action.fileId);
        const result = `Deleted VFS file ${action.fileId}`;
        await log(`VFS: deleted file ${action.fileId}`, 'info');
        await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
        break;
      }

      case 'vfs_download': {
        const { url, name: nameHint } = action;
        await log(`VFS: downloading ${url}`, 'info');
        let result: string;
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
          const mimeType =
            resp.headers.get('Content-Type')?.split(';')[0].trim() ?? 'application/octet-stream';
          const filename = filenameFromResponse(resp.clone(), url, nameHint);
          const b64 = arrayBufferToBase64(await resp.arrayBuffer());
          const saved = await writeVFSFile(sessionId, filename, b64, mimeType);
          result = `Downloaded "${saved.name}" (${saved.size} B, id: ${saved.id})`;
          await log(`VFS: downloaded → "${saved.name}" (${saved.size} B)`, 'info');
        } catch (dlErr) {
          const msg = (dlErr as Error).message;
          result = `Download failed: ${msg}`;
          await log(`VFS: download failed — ${msg}`, 'warn');
        }
        await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
        break;
      }

      // ── Todo ──────────────────────────────────────────────────────────────────
      case 'todo_create': {
        currentTodo = action.items as TodoItem[];
        await saveTodoToVFS(sessionId, currentTodo);
        const result = `Created todo plan with ${currentTodo.length} item(s)`;
        await log(result, 'info');
        await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
        break;
      }

      case 'todo_update': {
        currentTodo = applyTodoUpdates(currentTodo, action.updates);
        await saveTodoToVFS(sessionId, currentTodo);
        const summary = action.updates.map((u) => `${u.id}→${u.status ?? 'note'}`).join(', ');
        const result = `Todo updated: ${summary}`;
        await log(result, 'info');
        await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
        break;
      }

      case 'todo_add': {
        const existingIds = new Set(currentTodo.map((item) => item.id));
        const newItems = (action.items as TodoItem[]).filter((item) => !existingIds.has(item.id));
        let result: string;
        if (newItems.length > 0) {
          currentTodo = [...currentTodo, ...newItems];
          await saveTodoToVFS(sessionId, currentTodo);
          result = `Todo: added ${newItems.length} new item(s): ${newItems.map((item) => item.id).join(', ')}`;
          await log(result, 'info');
        } else {
          result = 'Todo: no new items added (all IDs already exist)';
        }
        await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
        break;
      }

      // ── DOM inspection ────────────────────────────────────────────────────────
      case 'fetch_dom': {
        const domTarget = coordinateMap.find((c) => c.id === action.targetId);
        if (!domTarget) {
          await log(`fetch_dom — element #${action.targetId} not in coordinate map`, 'warn');
          await appendConversationTurn(
            sessionId, 'tool',
            `fetch_dom failed: element #${action.targetId} not found in coordinate map`,
            { toolCallId, toolName },
          );
          break;
        }
        await log(`Fetching DOM of element #${domTarget.id}…`, 'observe');
        try {
          const domResult = await sendToTab<{
            success: boolean; outerHTML?: string; tag?: string; truncated?: boolean; error?: string;
          }>(tabId, { type: 'GET_ELEMENT_DOM', x: domTarget.rect.x, y: domTarget.rect.y });
          if (domResult?.success && domResult.outerHTML) {
            const truncNote = domResult.truncated ? ' [truncated at 40 KB]' : '';
            await log(`DOM of #${domTarget.id} <${domResult.tag}> ready${truncNote}`, 'observe');
            await appendConversationTurn(
              sessionId, 'tool',
              `[Step ${step}] DOM of element #${domTarget.id} <${domResult.tag}>${truncNote}:\n${domResult.outerHTML}\n\nTask: ${userPrompt}`,
              { toolCallId, toolName },
            );
          } else {
            await appendConversationTurn(
              sessionId, 'tool',
              `fetch_dom failed: ${domResult?.error ?? 'unknown error'}`,
              { toolCallId, toolName },
            );
            await log(`DOM fetch failed — ${domResult?.error ?? 'unknown'}`, 'warn');
          }
        } catch (domErr) {
          await log(`DOM fetch error — ${(domErr as Error).message}`, 'warn');
          await appendConversationTurn(
            sessionId, 'tool',
            `fetch_dom error: ${(domErr as Error).message}`,
            { toolCallId, toolName },
          );
        }
        break;
      }

      // ── Wait ──────────────────────────────────────────────────────────────────
      case 'wait': {
        await log(`Waiting ${action.ms} ms…`, 'act');
        await sleep(action.ms);
        const result = `Waited ${action.ms} ms`;
        await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
        break;
      }

      // ── Memory ────────────────────────────────────────────────────────────────
      case 'memory_upsert': {
        const entry = await upsertMemory(action.key, action.values, action.category, action.sourceUrl);
        const idx = memoryEntries.findIndex((m) => m.key === entry.key);
        memoryEntries =
          idx >= 0
            ? [...memoryEntries.slice(0, idx), entry, ...memoryEntries.slice(idx + 1)]
            : [...memoryEntries, entry];
        const result = `Memory: saved "${entry.key}" = [${entry.values.join(', ')}]`;
        await log(`Memory: saved "${entry.key}" → [${entry.values.join(', ')}]`, 'info');
        await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
        break;
      }

      case 'memory_delete': {
        await deleteMemory(action.key);
        memoryEntries = memoryEntries.filter((m) => m.key !== action.key);
        const result = `Memory: deleted "${action.key}"`;
        await log(result, 'info');
        await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
        break;
      }

      // ── Scratchpad ────────────────────────────────────────────────────────────
      case 'note_write': {
        scratchpadEntries = upsertScratchpadEntry(scratchpadEntries, action.key, action.value);
        await saveScratchpadToVFS(sessionId, scratchpadEntries);
        const result = `Scratchpad: saved note "${action.key}"`;
        await log(result, 'info');
        await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
        break;
      }

      case 'note_delete': {
        scratchpadEntries = deleteScratchpadEntry(scratchpadEntries, action.key);
        await saveScratchpadToVFS(sessionId, scratchpadEntries);
        const result = `Scratchpad: deleted note "${action.key}"`;
        await log(result, 'info');
        await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
        break;
      }

      // ── Ask user ──────────────────────────────────────────────────────────────
      case 'ask_user': {
        askUserQuestion = action.question;
        await log(`Question: ${action.question}`, 'observe');
        break;
      }

      // ── Finish ────────────────────────────────────────────────────────────────
      case 'finish': {
        await appendConversationTurn(
          sessionId, 'tool',
          `Task complete: ${action.summary}`,
          { toolCallId, toolName },
        );
        break;
      }

      // UI actions are handled by uiActionNode
      default:
        break;
    }
  }

  return { currentTodo, memoryEntries, scratchpadEntries, askUserQuestion };
}
