import type { Session, TodoItem } from '../types';
import type { ConversationTurn } from '../db';
import type { VFSFile } from '../db';
import type { ScratchpadEntry } from '../scratchpad';

export const EXPORT_VERSION = 1;
export const MAX_EMBED_BYTES = 1_048_576;

export const RESERVED_VFS_NAMES = new Set(['__todo.json', '__scratchpad.json']);

export interface MemoryUpdateRecord {
  action: 'upsert' | 'delete';
  key: string;
  ts: number;
  content: string;
}

export interface ExportFileEntry {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  embedded: boolean;
  data?: string | null;
  note?: string;
}

export interface SessionExportBundle {
  session: Session;
  turns: ConversationTurn[];
  vfsFiles: VFSFile[];
  todo: TodoItem[];
  scratchpad: ScratchpadEntry[];
  memoryUpdates: MemoryUpdateRecord[];
  summary?: string;
  startUrl?: string;
  modelId?: string;
}

export interface ExportStep {
  stepNumber: number;
  userContent?: string;
  reasoning?: string;
  toolCalls?: ConversationTurn['toolCalls'];
  toolResults: ConversationTurn[];
  screenshot?: VFSFile;
}
