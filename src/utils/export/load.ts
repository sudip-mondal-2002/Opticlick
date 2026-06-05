import {
  getSession,
  getConversationHistory,
  listVFSFiles,
} from '../db';
import { loadTodoFromVFS } from '../todo';
import { loadScratchpadFromVFS } from '../scratchpad';
import type { SessionExportBundle } from './types';
import { extractMemoryUpdates, extractSummary, inferStartUrl } from './helpers';

export async function loadSessionExportBundle(sessionId: number): Promise<SessionExportBundle> {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const [turns, vfsFiles, todo, scratchpad] = await Promise.all([
    getConversationHistory(sessionId),
    listVFSFiles(sessionId),
    loadTodoFromVFS(sessionId),
    loadScratchpadFromVFS(sessionId),
  ]);

  const startUrl = inferStartUrl(session.startUrl, turns);
  const modelId = session.modelId;
  const summary = extractSummary(turns);
  const memoryUpdates = extractMemoryUpdates(turns);

  return {
    session,
    turns,
    vfsFiles,
    todo: todo ?? [],
    scratchpad,
    memoryUpdates,
    summary,
    startUrl,
    modelId,
  };
}
