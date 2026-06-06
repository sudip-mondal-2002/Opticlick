import { openDB, CONV_STORE, CONV_BY_SESSION_INDEX } from './core';

export interface ConversationTurn {
  id?: number;
  sessionId: number;
  role: string;
  content: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  toolCallId?: string;
  toolName?: string;
  ts: number;
}

export async function appendConversationTurn(
  sessionId: number,
  role: string,
  content: string,
  extra?: {
    toolCalls?: ConversationTurn['toolCalls'];
    toolCallId?: string;
    toolName?: string;
  },
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONV_STORE, 'readwrite');
    const turn: Omit<ConversationTurn, 'id'> = {
      sessionId, role, content, ts: Date.now(),
      ...(extra?.toolCalls != null && { toolCalls: extra.toolCalls }),
      ...(extra?.toolCallId != null && { toolCallId: extra.toolCallId }),
      ...(extra?.toolName != null && { toolName: extra.toolName }),
    };
    tx.objectStore(CONV_STORE).add(turn);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject((e.target as IDBTransaction).error);
  });
}

export async function getConversationHistory(sessionId: number): Promise<ConversationTurn[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CONV_STORE, 'readonly');
    const store = tx.objectStore(CONV_STORE);

    if (store.indexNames.contains(CONV_BY_SESSION_INDEX)) {
      const req = store.index(CONV_BY_SESSION_INDEX).getAll(sessionId);
      req.onsuccess = (e) => resolve((e.target as IDBRequest).result as ConversationTurn[]);
      req.onerror = (e) => reject((e.target as IDBRequest).error);
      return;
    }

    const req = store.getAll();
    req.onsuccess = (e) =>
      resolve(((e.target as IDBRequest).result as ConversationTurn[]).filter((r) => r.sessionId === sessionId));
    req.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}
