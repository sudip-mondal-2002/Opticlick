import {
  getSessionById,
  getConversationHistory,
  listVFSFiles,
} from '@/utils/db';
import { getAgentState } from '@/utils/agent-state';
import { loadTodoFromVFS } from '@/utils/todo';
import { loadScratchpadFromVFS } from '@/utils/scratchpad';
import type { LogEntry } from '@/utils/types';
import { buildSessionExportPayload } from './build-payload';
import type { SessionExportInput, SessionExportPayload } from './types';

export async function collectSessionExportInput(sessionId: number): Promise<SessionExportInput> {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const [conversation, vfsFiles, todos, scratchpad, agentState] = await Promise.all([
    getConversationHistory(sessionId),
    listVFSFiles(sessionId),
    loadTodoFromVFS(sessionId),
    loadScratchpadFromVFS(sessionId),
    getAgentState(),
  ]);

  let runtimeLogs: LogEntry[] | undefined;
  if (agentState?.sessionId === sessionId && agentState.status === 'running') {
    const { agentLog } = await chrome.storage.session.get('agentLog') as { agentLog?: LogEntry[] };
    if (Array.isArray(agentLog) && agentLog.length) runtimeLogs = agentLog;
  }

  return {
    session,
    conversation,
    vfsFiles,
    todos: todos ?? [],
    scratchpad,
    agentState,
    runtimeLogs,
  };
}

export async function buildExportPayloadForSession(sessionId: number): Promise<SessionExportPayload> {
  const input = await collectSessionExportInput(sessionId);
  return buildSessionExportPayload(input);
}
