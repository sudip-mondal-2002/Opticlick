import { appendConversationTurn, upsertMemory, deleteMemory } from '@/utils/db';
import { saveScratchpadToVFS, upsertScratchpadEntry, deleteScratchpadEntry } from '@/utils/scratchpad';
import { log } from '@/utils/agent-log';
import type { MemoryEntry } from '@/utils/db';
import type { ScratchpadEntry } from '@/utils/scratchpad';
import type { AgentAction } from '@/utils/types';
import type { EffectCtx } from './ctx';

type MemoryUpsertAction = Extract<AgentAction, { type: 'memory_upsert' }>;
type MemoryDeleteAction = Extract<AgentAction, { type: 'memory_delete' }>;
type NoteWriteAction = Extract<AgentAction, { type: 'note_write' }>;
type NoteDeleteAction = Extract<AgentAction, { type: 'note_delete' }>;

export async function handleMemoryUpsert(
  action: MemoryUpsertAction,
  ctx: EffectCtx,
  memoryEntries: MemoryEntry[],
): Promise<MemoryEntry[]> {
  const { sessionId, toolCallId, toolName } = ctx;
  const entry = await upsertMemory(action.key, action.values, action.category, action.sourceUrl);
  const idx = memoryEntries.findIndex((m) => m.key === entry.key);
  const newEntries =
    idx >= 0
      ? [...memoryEntries.slice(0, idx), entry, ...memoryEntries.slice(idx + 1)]
      : [...memoryEntries, entry];
  const result = `Memory: saved "${entry.key}" = [${entry.values.join(', ')}]`;
  await log(`Memory: saved "${entry.key}" → [${entry.values.join(', ')}]`, 'info');
  await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
  return newEntries;
}

export async function handleMemoryDelete(
  action: MemoryDeleteAction,
  ctx: EffectCtx,
  memoryEntries: MemoryEntry[],
): Promise<MemoryEntry[]> {
  const { sessionId, toolCallId, toolName } = ctx;
  await deleteMemory(action.key);
  const result = `Memory: deleted "${action.key}"`;
  await log(result, 'info');
  await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
  return memoryEntries.filter((m) => m.key !== action.key);
}

export async function handleNoteWrite(
  action: NoteWriteAction,
  ctx: EffectCtx,
  scratchpadEntries: ScratchpadEntry[],
): Promise<ScratchpadEntry[]> {
  const { sessionId, toolCallId, toolName } = ctx;
  const newEntries = upsertScratchpadEntry(scratchpadEntries, action.key, action.value);
  await saveScratchpadToVFS(sessionId, newEntries);
  const result = `Scratchpad: saved note "${action.key}"`;
  await log(result, 'info');
  await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
  return newEntries;
}

export async function handleNoteDelete(
  action: NoteDeleteAction,
  ctx: EffectCtx,
  scratchpadEntries: ScratchpadEntry[],
): Promise<ScratchpadEntry[]> {
  const { sessionId, toolCallId, toolName } = ctx;
  const newEntries = deleteScratchpadEntry(scratchpadEntries, action.key);
  await saveScratchpadToVFS(sessionId, newEntries);
  const result = `Scratchpad: deleted note "${action.key}"`;
  await log(result, 'info');
  await appendConversationTurn(sessionId, 'tool', result, { toolCallId, toolName });
  return newEntries;
}
