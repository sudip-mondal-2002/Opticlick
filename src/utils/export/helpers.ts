import type { ConversationTurn } from '../db';
import type { VFSFile } from '../db';
import { MAX_EMBED_BYTES, RESERVED_VFS_NAMES, type ExportFileEntry, type ExportStep, type MemoryUpdateRecord } from './types';

const CONTEXT_RE = /\[CONTEXT: The task started on (.+?)\. If you are on an unrelated page, navigate back\.\]/;
const STEP_RE = /^\[(?:ACTION FAILED - )?Step (\d+)\]/;
const MEMORY_KEY_RE = /Memory: (?:saved|deleted) "(.+?)"/;
const FINISH_PREFIX = 'Task complete: ';

export function inferStartUrl(
  sessionStartUrl: string | undefined,
  turns: ConversationTurn[],
): string | undefined {
  if (sessionStartUrl) return sessionStartUrl;
  for (const turn of turns) {
    const match = turn.content.match(CONTEXT_RE);
    if (match) return match[1];
  }
  for (const turn of turns) {
    for (const tc of turn.toolCalls ?? []) {
      if (tc.name === 'navigate' && typeof tc.args.url === 'string') {
        return tc.args.url;
      }
    }
  }
  return undefined;
}

export function extractSummary(turns: ConversationTurn[]): string | undefined {
  const finishTurns = turns.filter((t) => t.toolName === 'finish');
  const last = finishTurns[finishTurns.length - 1];
  if (!last) return undefined;
  return last.content.startsWith(FINISH_PREFIX)
    ? last.content.slice(FINISH_PREFIX.length)
    : last.content;
}

export function extractMemoryUpdates(turns: ConversationTurn[]): MemoryUpdateRecord[] {
  return turns
    .filter((t) => t.toolName === 'memory_upsert' || t.toolName === 'memory_delete')
    .map((t) => ({
      action: t.toolName === 'memory_upsert' ? ('upsert' as const) : ('delete' as const),
      key: parseMemoryKey(t.content),
      ts: t.ts,
      content: t.content,
    }));
}

function parseMemoryKey(content: string): string {
  return content.match(MEMORY_KEY_RE)?.[1] ?? '';
}

export function groupTurnsIntoSteps(turns: ConversationTurn[], vfsFiles: VFSFile[]): ExportStep[] {
  const steps: ExportStep[] = [];
  let current: ExportStep | null = null;

  for (const turn of turns) {
    if (turn.role === 'user') {
      const stepMatch = turn.content.match(STEP_RE);
      if (stepMatch) {
        if (current) steps.push(current);
        const stepNumber = parseInt(stepMatch[1], 10);
        current = {
          stepNumber,
          userContent: turn.content,
          toolResults: [],
          screenshot: vfsFiles.find((f) => f.name === `step_${stepNumber}.png`),
        };
      }
    } else if (turn.role === 'model' && current) {
      current.reasoning = turn.content;
      current.toolCalls = turn.toolCalls;
    } else if (turn.role === 'tool' && current) {
      current.toolResults.push(turn);
    }
  }

  if (current) steps.push(current);
  return steps;
}

export function fileToExportEntry(file: VFSFile): ExportFileEntry {
  const embedded = file.size <= MAX_EMBED_BYTES;
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    createdAt: file.createdAt,
    embedded,
    data: embedded ? file.data : null,
    note: embedded
      ? undefined
      : 'File exceeds 1 MB embed limit — metadata only. Use Opticlick JSON export or re-fetch from VFS.',
  };
}

export function isProducedFile(file: VFSFile): boolean {
  if (RESERVED_VFS_NAMES.has(file.name)) return false;
  if (/^step_\d+\.png$/.test(file.name)) return false;
  return true;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatIso(ts: number): string {
  return new Date(ts).toISOString();
}

export function shouldEmbedFile(file: VFSFile): boolean {
  return file.size <= MAX_EMBED_BYTES;
}
