import { getSession, getConversationHistory, listVFSFiles } from '@/utils/db';
import { getAgentState } from '@/utils/agent-state';
import type { Session } from '@/utils/types';
import type { ConversationTurn, VFSFile } from '@/utils/db';
import { openDB, SESSIONS_STORE, CONV_STORE, VFS_STORE } from '@/utils/db/core';

export interface MemoryUpdate {
  key: string;
  action: 'upsert' | 'delete';
  values?: string[];
  category?: string;
  sourceUrl?: string;
  ts: number;
}

export interface SessionExportData {
  session: Session & {
    status: string;
    outcomeSummary: string;
  };
  conversation: ConversationTurn[];
  files: Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    createdAt: number;
    isEmbedded: boolean;
    data: string | null;
    message?: string;
  }>;
  memoryUpdates: MemoryUpdate[];
}

const LARGE_FILE_LIMIT = 1024 * 1024; // 1 MB

function decodeBase64ToUtf8(base64: string): string {
  try {
    const binString = atob(base64);
    return new TextDecoder().decode(Uint8Array.from(binString, (m) => m.charCodeAt(0)));
  } catch {
    return '[Binary Data]';
  }
}

function isTextMimeType(mime: string, name: string): boolean {
  const textExtensions = ['.txt', '.json', '.csv', '.md', '.js', '.ts', '.html', '.css', '.xml', '.yml', '.yaml'];
  const lowercaseName = name.toLowerCase();
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/javascript' ||
    mime === 'application/xml' ||
    textExtensions.some((ext) => lowercaseName.endsWith(ext))
  );
}

export async function getSessionExportData(sessionId: number): Promise<SessionExportData> {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error(`Session with ID ${sessionId} not found`);
  }

  const turns = await getConversationHistory(sessionId);
  const dbFiles = await listVFSFiles(sessionId);

  // Extract task outcome and status
  let status = 'completed';
  let outcomeSummary = '';

  const finishCall = turns
    .filter((t) => t.role === 'model' && t.toolCalls)
    .flatMap((t) => t.toolCalls || [])
    .find((tc) => tc.name === 'finish');

  if (finishCall) {
    status = 'completed';
    outcomeSummary = (finishCall.args?.summary as string) || 'Task completed successfully';
  } else {
    const agentState = await getAgentState();
    if (agentState && agentState.sessionId === sessionId) {
      if (agentState.status === 'running' || agentState.status === 'idle') {
        status = 'in_progress';
      } else if (agentState.status === 'done') {
        status = 'completed';
      } else if (agentState.status === 'stopped') {
        status = 'stopped';
      } else if (agentState.status === 'error') {
        status = 'failed';
        outcomeSummary = 'Agent execution encountered an error';
      }
    } else {
      status = 'stopped';
      outcomeSummary = 'Session stopped or inactive';
    }
  }

  // Extract memory updates from model tool calls
  const memoryUpdates: MemoryUpdate[] = [];
  for (const turn of turns) {
    if (turn.role === 'model' && turn.toolCalls) {
      for (const tc of turn.toolCalls) {
        if (tc.name === 'memory_upsert') {
          const args = tc.args as any;
          memoryUpdates.push({
            key: args.key || '',
            action: 'upsert',
            values: args.values,
            category: args.category,
            sourceUrl: args.sourceUrl,
            ts: turn.ts,
          });
        } else if (tc.name === 'memory_delete') {
          const args = tc.args as any;
          memoryUpdates.push({
            key: args.key || '',
            action: 'delete',
            ts: turn.ts,
          });
        }
      }
    }
  }

  // Process files: reference files larger than 1 MB
  const processedFiles = dbFiles.map((file) => {
    const isLarge = file.size > LARGE_FILE_LIMIT;
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
      isEmbedded: !isLarge,
      data: isLarge ? null : file.data,
      ...(isLarge && { message: 'File size exceeds 1 MB. Omitted from export payload.' }),
    };
  });

  return {
    session: {
      ...session,
      status,
      outcomeSummary,
    },
    conversation: turns,
    files: processedFiles,
    memoryUpdates,
  };
}

export async function exportSessionAsJson(sessionId: number): Promise<string> {
  const data = await getSessionExportData(sessionId);
  return JSON.stringify(data, null, 2);
}

export async function exportSessionAsMarkdown(sessionId: number): Promise<string> {
  const data = await getSessionExportData(sessionId);
  const { session, conversation, files, memoryUpdates } = data;

  const lines: string[] = [];
  lines.push(`# Session Report: ${session.title}`);
  lines.push('');

  // 1. Metadata Table
  lines.push('## Session Metadata');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('| --- | --- |');
  lines.push(`| **Session ID** | ${session.id || 'N/A'} |`);
  lines.push(`| **Created At** | ${new Date(session.createdAt).toLocaleString()} |`);
  lines.push(`| **Last Updated** | ${new Date(session.updatedAt).toLocaleString()} |`);
  lines.push(`| **Model** | ${session.modelId || 'N/A'} |`);
  lines.push(`| **Starting URL** | ${session.startUrl ? `[Link](${session.startUrl})` : 'N/A'} |`);
  lines.push(`| **Status** | \`${session.status.toUpperCase()}\` |`);
  if (session.outcomeSummary) {
    lines.push(`| **Outcome Summary** | ${session.outcomeSummary} |`);
  }
  lines.push('');

  // 2. Memory Updates
  if (memoryUpdates.length > 0) {
    lines.push('## Memory Updates');
    lines.push('');
    for (const update of memoryUpdates) {
      const timeStr = new Date(update.ts).toLocaleTimeString();
      if (update.action === 'upsert') {
        const valuesStr = update.values ? update.values.join(', ') : 'N/A';
        const categoryStr = update.category ? ` (Category: *${update.category}*)` : '';
        const sourceStr = update.sourceUrl ? ` [Source: ${update.sourceUrl}]` : '';
        lines.push(`- **[${timeStr}] Upserted**: \`${update.key}\` → [${valuesStr}]${categoryStr}${sourceStr}`);
      } else {
        lines.push(`- **[${timeStr}] Deleted**: \`${update.key}\``);
      }
    }
    lines.push('');
  }

  // 3. Conversation History
  lines.push('## Conversation History');
  lines.push('');

  for (const turn of conversation) {
    const timeStr = new Date(turn.ts).toLocaleTimeString();
    lines.push(`### **${turn.role.toUpperCase()}** - *${timeStr}*`);
    lines.push('');

    // Print content
    if (turn.content) {
      // Handle the turn content format
      if (turn.role === 'model') {
        try {
          const parsed = JSON.parse(turn.content);
          if (parsed.reasoning) {
            lines.push(`**Reasoning**:`);
            lines.push(parsed.reasoning);
            lines.push('');
          }
        } catch {
          lines.push(turn.content);
        }
      } else {
        lines.push(turn.content);
      }
      lines.push('');
    }

    // Print Tool Calls if present in model turn
    if (turn.role === 'model' && turn.toolCalls && turn.toolCalls.length > 0) {
      lines.push('**Actions Taken**:');
      for (const tc of turn.toolCalls) {
        lines.push(`- **Tool Call**: \`${tc.name}\``);
        lines.push('  ```json');
        lines.push(JSON.stringify(tc.args, null, 2).replace(/^/gm, '  '));
        lines.push('  ```');
      }
      lines.push('');
    }

    // Try to find if a screenshot file belongs to this turn
    // User turns usually look like "[Step X] ...", let's extract the step number if it exists
    const stepMatch = turn.role === 'user' && turn.content ? turn.content.match(/^\[(?:ACTION FAILED - )?Step (\d+)\]/i) : null;
    if (stepMatch) {
      const stepNum = stepMatch[1];
      const screenshotName = `step_${stepNum}.png`;
      const screenshotFile = files.find((f) => f.name.toLowerCase() === screenshotName.toLowerCase());

      if (screenshotFile) {
        lines.push('**Step Screenshot**:');
        lines.push('');
        if (screenshotFile.isEmbedded && screenshotFile.data) {
          lines.push(`![Screenshot ${screenshotFile.name}](data:image/png;base64,${screenshotFile.data})`);
        } else {
          lines.push(`*[Screenshot ${screenshotFile.name} exceeds 1 MB (${(screenshotFile.size / (1024 * 1024)).toFixed(2)} MB) and is referenced but not embedded]*`);
        }
        lines.push('');
      }
    }
  }

  // 4. Generated Files (excluding step screenshots which are displayed inline)
  const nonScreenshotFiles = files.filter((f) => !/^step_\d+\.png$/i.test(f.name));
  if (nonScreenshotFiles.length > 0) {
    lines.push('## Generated Session Files');
    lines.push('');
    for (const file of nonScreenshotFiles) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(3);
      lines.push(`### File: \`${file.name}\` (${file.size} Bytes, ~${sizeMb} MB)`);
      lines.push(`- **MimeType**: \`${file.mimeType}\``);
      lines.push(`- **Created At**: ${new Date(file.createdAt).toLocaleString()}`);
      lines.push('');

      if (file.isEmbedded && file.data) {
        if (isTextMimeType(file.mimeType, file.name)) {
          const textContent = decodeBase64ToUtf8(file.data);
          lines.push('**Content**:');
          lines.push('```');
          lines.push(textContent);
          lines.push('```');
        } else {
          lines.push('**Content**: *[Binary file embedded in JSON payload]*');
        }
      } else {
        lines.push(`*[File content exceeds 1 MB limit and is referenced but not embedded]*`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export async function importSession(data: SessionExportData): Promise<number> {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid export data: not an object');
  }
  if (!data.session || typeof data.session.title !== 'string') {
    throw new Error('Invalid export data: missing session title');
  }
  if (!Array.isArray(data.conversation)) {
    throw new Error('Invalid export data: conversation must be an array');
  }
  if (data.files && !Array.isArray(data.files)) {
    throw new Error('Invalid export data: files must be an array');
  }

  const db = await openDB();
  const tx = db.transaction([SESSIONS_STORE, CONV_STORE, VFS_STORE], 'readwrite');

  return new Promise<number>((resolve, reject) => {
    const sessionStore = tx.objectStore(SESSIONS_STORE);

    const sessionToInsert: Omit<Session, 'id'> = {
      title: data.session.title.slice(0, 80),
      createdAt: data.session.createdAt || Date.now(),
      updatedAt: data.session.updatedAt || Date.now(),
      modelId: data.session.modelId,
      startUrl: data.session.startUrl,
      searchText: data.session.searchText || data.session.title || '',
    };

    const sessionReq = sessionStore.add(sessionToInsert);

    sessionReq.onsuccess = (e) => {
      const newSessionId = (e.target as IDBRequest).result as number;

      const convStore = tx.objectStore(CONV_STORE);
      for (const turn of data.conversation) {
        const turnToInsert: Omit<ConversationTurn, 'id'> = {
          sessionId: newSessionId,
          role: turn.role,
          content: turn.content,
          ts: turn.ts || Date.now(),
          toolCalls: turn.toolCalls,
          toolCallId: turn.toolCallId,
          toolName: turn.toolName,
        };
        convStore.add(turnToInsert);
      }

      if (data.files) {
        const vfsStore = tx.objectStore(VFS_STORE);
        for (const file of data.files) {
          const fileToInsert: VFSFile = {
            id: file.id || crypto.randomUUID(),
            sessionId: newSessionId,
            name: file.name,
            mimeType: file.mimeType,
            data: file.data || btoa('[Large file omitted from export]'),
            size: file.size || 0,
            createdAt: file.createdAt || Date.now(),
          };
          vfsStore.add(fileToInsert);
        }
      }
    };

    tx.oncomplete = () => {
      const resultId = sessionReq.result as number;
      resolve(resultId);
    };

    tx.onerror = (e) => {
      reject((e.target as IDBTransaction).error);
    };
  });
}

