import { describe, it, expect } from 'vitest';
import { createSession, appendConversationTurn, getConversationHistory } from '@/utils/db';
import type { ConversationTurn } from '@/utils/db';

describe('appendConversationTurn + getConversationHistory', () => {
  it('returns empty array for a new session with no turns', async () => {
    const id = await createSession('Empty');
    const history = await getConversationHistory(id);
    expect(history).toEqual([]);
  });

  it('appends a turn and retrieves it', async () => {
    const id = await createSession('Single');
    await appendConversationTurn(id, 'user', 'Hello');
    const history = await getConversationHistory(id);
    expect(history).toHaveLength(1);
  });

  it('preserves role and content', async () => {
    const id = await createSession('RoleContent');
    await appendConversationTurn(id, 'assistant', 'I clicked button 3.');
    const [turn] = await getConversationHistory(id);
    expect(turn.role).toBe('assistant');
    expect(turn.content).toBe('I clicked button 3.');
  });

  it('filters by sessionId — does not return turns from another session', async () => {
    const id1 = await createSession('Session 1');
    const id2 = await createSession('Session 2');
    await appendConversationTurn(id1, 'user', 'Turn for session 1');
    await appendConversationTurn(id2, 'user', 'Turn for session 2');
    const history1 = await getConversationHistory(id1);
    const history2 = await getConversationHistory(id2);
    expect(history1).toHaveLength(1);
    expect(history1[0].content).toBe('Turn for session 1');
    expect(history2).toHaveLength(1);
    expect(history2[0].content).toBe('Turn for session 2');
  });

  it('multiple turns are returned in insertion order', async () => {
    const id = await createSession('Multi');
    await appendConversationTurn(id, 'user', 'First');
    await appendConversationTurn(id, 'assistant', 'Second');
    await appendConversationTurn(id, 'user', 'Third');
    const history = await getConversationHistory(id);
    expect(history.map((t) => t.content)).toEqual(['First', 'Second', 'Third']);
  });

  it('stores a timestamp on each turn', async () => {
    const id = await createSession('TS');
    const before = Date.now();
    await appendConversationTurn(id, 'user', 'Hi');
    const after = Date.now();
    const [turn] = await getConversationHistory(id);
    expect(turn.ts).toBeGreaterThanOrEqual(before);
    expect(turn.ts).toBeLessThanOrEqual(after);
  });

  it('stores toolCalls on a model turn and retrieves them', async () => {
    const id = await createSession('ToolCalls');
    const toolCalls: ConversationTurn['toolCalls'] = [
      { id: 'tc1', name: 'click', args: { targetId: 5 } },
      { id: 'tc2', name: 'todo_update', args: { updates: [] } },
    ];
    await appendConversationTurn(id, 'model', 'I will click element 5.', { toolCalls });
    const [turn] = await getConversationHistory(id);
    expect(turn.role).toBe('model');
    expect(turn.toolCalls).toHaveLength(2);
    expect(turn.toolCalls![0].id).toBe('tc1');
    expect(turn.toolCalls![0].name).toBe('click');
    expect(turn.toolCalls![1].name).toBe('todo_update');
  });

  it('stores toolCallId and toolName on a tool result turn', async () => {
    const id = await createSession('ToolResult');
    await appendConversationTurn(id, 'tool', 'Clicked element 5.', {
      toolCallId: 'tc1',
      toolName: 'click',
    });
    const [turn] = await getConversationHistory(id);
    expect(turn.role).toBe('tool');
    expect(turn.toolCallId).toBe('tc1');
    expect(turn.toolName).toBe('click');
  });

  it('does not add undefined fields when extra is omitted', async () => {
    const id = await createSession('NoExtra');
    await appendConversationTurn(id, 'user', 'plain turn');
    const [turn] = await getConversationHistory(id);
    expect(turn.toolCalls).toBeUndefined();
    expect(turn.toolCallId).toBeUndefined();
    expect(turn.toolName).toBeUndefined();
  });

  it('stores mixed model + tool turns in order', async () => {
    const id = await createSession('Mixed');
    await appendConversationTurn(id, 'model', 'reasoning', {
      toolCalls: [{ id: 'id1', name: 'navigate', args: { url: 'https://example.com' } }],
    });
    await appendConversationTurn(id, 'tool', 'Navigated to https://example.com.', {
      toolCallId: 'id1',
      toolName: 'navigate',
    });
    const history = await getConversationHistory(id);
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('model');
    expect(history[0].toolCalls![0].id).toBe('id1');
    expect(history[1].role).toBe('tool');
    expect(history[1].toolCallId).toBe('id1');
  });
});
