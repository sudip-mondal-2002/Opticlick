import { describe, it, expect } from 'vitest';
import { createSession, appendConversationTurn, getConversationHistory } from '@/utils/db';

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
});
