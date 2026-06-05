import type { ConversationTurn } from '@/utils/db';
import { getProviderForModel, getModelLabel } from '@/utils/models';
import type { Session } from '@/utils/types';
import {
  EXPORT_VERSION,
  LARGE_FILE_THRESHOLD_BYTES,
  type ExportedVFSFile,
  type MemoryUpdateRecord,
  type ModelInfo,
  type SessionExportInput,
  type SessionExportPayload,
  type SessionExportStatus,
  type TaskOutcome,
} from './types';

function resolveStatus(session: Session, agentState?: SessionExportInput['agentState']): SessionExportStatus {
  if (agentState?.sessionId === session.id && agentState.status === 'running') return 'in_progress';
  if (session.status === 'in_progress') return 'in_progress';
  if (session.status === 'completed') return 'completed';
  if (session.status === 'stopped') return 'stopped';
  if (session.status === 'error') return 'error';
  if (agentState?.sessionId === session.id) {
    if (agentState.status === 'done') return 'completed';
    if (agentState.status === 'stopped') return 'stopped';
    if (agentState.status === 'error') return 'error';
  }
  return 'unknown';
}

function extractInitialPrompt(conversation: ConversationTurn[], session: Session, agentState?: SessionExportInput['agentState']): string | undefined {
  for (const turn of conversation) {
    const match = turn.content.match(/User task:\s*(.+?)(?:\n|$)/s);
    if (match) return match[1].trim();
    if (turn.role === 'user' && !turn.content.startsWith('[Step')) {
      return turn.content.trim();
    }
  }
  if (agentState?.prompt) return agentState.prompt;
  return session.title;
}

function extractTaskOutcome(
  conversation: ConversationTurn[],
  session: Session,
  status: SessionExportStatus,
): TaskOutcome {
  if (session.finishSummary) {
    return { status, summary: session.finishSummary };
  }

  const finishTurn = [...conversation]
    .reverse()
    .find((t) => t.toolName === 'finish' || t.content.startsWith('Task complete:'));

  if (finishTurn) {
    return {
      status: status === 'unknown' ? 'completed' : status,
      summary: finishTurn.content.replace(/^Task complete:\s*/, '').trim(),
      completedAt: finishTurn.ts,
    };
  }

  return { status };
}

function extractMemoryUpdates(conversation: ConversationTurn[]): MemoryUpdateRecord[] {
  const updates: MemoryUpdateRecord[] = [];

  for (const turn of conversation) {
    if (turn.role === 'model' && turn.toolCalls?.length) {
      for (const call of turn.toolCalls) {
        if (call.name === 'memory_upsert') {
          updates.push({
            action: 'memory_upsert',
            key: String(call.args.key ?? ''),
            values: Array.isArray(call.args.values) ? call.args.values.map(String) : undefined,
            category: call.args.category != null ? String(call.args.category) : undefined,
            sourceUrl: call.args.sourceUrl != null ? String(call.args.sourceUrl) : undefined,
            summary: `Upsert "${String(call.args.key ?? '')}"`,
            ts: turn.ts,
          });
        } else if (call.name === 'memory_delete') {
          updates.push({
            action: 'memory_delete',
            key: String(call.args.key ?? ''),
            summary: `Delete "${String(call.args.key ?? '')}"`,
            ts: turn.ts,
          });
        }
      }
    }

    if (turn.role === 'tool' && (turn.toolName === 'memory_upsert' || turn.toolName === 'memory_delete')) {
      updates.push({
        action: turn.toolName,
        summary: turn.content,
        ts: turn.ts,
      });
    }
  }

  return updates;
}

export function mapVfsFilesForExport(
  vfsFiles: SessionExportInput['vfsFiles'],
): ExportedVFSFile[] {
  return vfsFiles.map((file) => {
    const embedded = file.size <= LARGE_FILE_THRESHOLD_BYTES;
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
      embedded,
      ...(embedded ? { data: file.data } : {}),
    };
  });
}

export function buildModelInfo(session: Session, modelLabel?: string): ModelInfo {
  const modelId = session.modelId;
  if (!modelId) return {};
  return {
    modelId,
    provider: getProviderForModel(modelId),
    label: modelLabel ?? getModelLabel(modelId, [], []),
  };
}

export function buildSessionExportPayload(input: SessionExportInput): SessionExportPayload {
  const { session, conversation, vfsFiles, todos, scratchpad, agentState, runtimeLogs, modelLabel } = input;
  const sortedConversation = [...conversation].sort((a, b) => a.ts - b.ts);
  const status = resolveStatus(session, agentState);

  return {
    exportVersion: EXPORT_VERSION,
    exportedAt: Date.now(),
    format: 'json',
    session,
    status,
    model: buildModelInfo(session, modelLabel),
    startingUrl: session.startingUrl,
    initialPrompt: extractInitialPrompt(sortedConversation, session, agentState),
    taskOutcome: extractTaskOutcome(sortedConversation, session, status),
    conversation: sortedConversation,
    todos,
    scratchpad,
    memoryUpdates: extractMemoryUpdates(sortedConversation),
    vfsFiles: mapVfsFilesForExport(vfsFiles),
    ...(runtimeLogs?.length ? { runtimeLogs } : {}),
    ...(status === 'in_progress' && agentState?.step != null ? { currentStep: agentState.step } : {}),
  };
}
