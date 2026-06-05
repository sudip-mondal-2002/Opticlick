import { describe, it, expect } from 'vitest';
import { buildHistory, buildUserMessage } from '@/utils/prompt';
import { ToolMessage, AIMessage, HumanMessage } from '@langchain/core/messages';
import type { ConversationTurn, VFSFile, MemoryEntry } from '@/utils/db';
import type { TodoItem, CoordinateEntry } from '@/utils/types';
import type { ScratchpadEntry } from '@/utils/scratchpad';

describe('buildHistory', () => {
  it('converts tool turns to ToolMessages', () => {
    const turns: ConversationTurn[] = [
      { role: 'tool', content: 'vfs file read success', toolCallId: 'call_1', toolName: 'vfs_read' },
    ];
    const msgs = buildHistory(turns);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toBeInstanceOf(ToolMessage);
    expect((msgs[0] as ToolMessage).tool_call_id).toBe('call_1');
    expect((msgs[0] as ToolMessage).name).toBe('vfs_read');
    expect((msgs[0] as ToolMessage).content).toBe('vfs file read success');
  });

  it('converts assistant turns with tool calls to AIMessages with tool_calls', () => {
    const turns: ConversationTurn[] = [
      {
        role: 'model',
        content: 'I need to click this button.',
        toolCalls: [{ id: 'call_2', name: 'click', args: { targetId: 1 } }],
      },
    ];
    const msgs = buildHistory(turns);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toBeInstanceOf(AIMessage);
    expect((msgs[0] as AIMessage).content).toBe('I need to click this button.');
    expect((msgs[0] as AIMessage).tool_calls).toEqual([
      { id: 'call_2', name: 'click', args: { targetId: 1 }, type: 'tool_call' },
    ]);
  });

  it('converts assistant turns without tool calls to plain AIMessages', () => {
    const turns: ConversationTurn[] = [
      { role: 'model', content: 'Task accomplished' },
    ];
    const msgs = buildHistory(turns);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toBeInstanceOf(AIMessage);
    expect((msgs[0] as AIMessage).content).toBe('Task accomplished');
  });

  it('converts human turns to HumanMessages', () => {
    const turns: ConversationTurn[] = [
      { role: 'user', content: 'Find hotels' },
    ];
    const msgs = buildHistory(turns);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toBeInstanceOf(HumanMessage);
    expect((msgs[0] as HumanMessage).content).toBe('Find hotels');
  });

  it('falls back to empty string when toolCallId is undefined on a tool turn', () => {
    // Covers `turn.toolCallId ?? ''` branch — some legacy DB entries may lack this field.
    const turns: ConversationTurn[] = [
      { role: 'tool', content: 'result data', toolCallId: undefined as unknown as string, toolName: 'vfs_read' },
    ];
    const msgs = buildHistory(turns);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as ToolMessage;
    expect(msg).toBeInstanceOf(ToolMessage);
    expect(msg.tool_call_id).toBe('');
  });
});

describe('buildUserMessage', () => {
  const fakeBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  it('assembles human message with prompt, empty lists, and screenshot', () => {
    const msg = buildUserMessage('Search for cat videos', [], [], [], fakeBase64);
    expect(msg).toBeInstanceOf(HumanMessage);

    const content = msg.content as any[];
    expect(content).toHaveLength(3); // text, instruction text, and screenshot image block
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('Search for cat videos');
    expect(content[0].text).toContain('**Virtual Filesystem (VFS)** — currently empty');
    expect(content[0].text).toContain('**Todo List** — not created yet');

    expect(content[1].type).toBe('text');
    expect(content[1].text).toContain('Analyze the annotated screenshot');

    expect(content[2].type).toBe('image');
    expect(content[2].url).toBe(`data:image/png;base64,${fakeBase64}`);
  });

  it('extracts start URL context correctly', () => {
    const prompt = 'Click submit\n\n[CONTEXT: The task started on https://google.com. If you are on an unrelated page, navigate back.]';
    const msg = buildUserMessage(prompt, [], [], [], fakeBase64);
    const text = (msg.content as any[])[0].text;
    expect(text).toContain('CONTEXT');
    expect(text).toContain('https://google.com');
    expect(text).toContain('Click submit');
    expect(text).not.toContain('[CONTEXT:');
  });

  it('formats non-empty VFS files correctly', () => {
    const files: VFSFile[] = [
      { id: '1', name: 'data.txt', mimeType: 'text/plain', size: 100, createdAt: 1700000000000 },
    ];
    const msg = buildUserMessage('prompt', files, [], [], fakeBase64);
    const text = (msg.content as any[])[0].text;
    expect(text).toContain('**Virtual Filesystem (VFS)** — current contents:');
    expect(text).toContain('| `data.txt` |');
  });

  it('formats todo list correctly', () => {
    const todo: TodoItem[] = [
      { id: 't1', title: 'Task 1', status: 'done', notes: 'Done note' },
    ];
    const msg = buildUserMessage('prompt', [], todo, [], fakeBase64);
    const text = (msg.content as any[])[0].text;
    expect(text).toContain('Todo List');
    expect(text).toContain('Task 1');
    expect(text).toContain('Done note');
  });

  it('formats memory and scratchpad entries correctly', () => {
    const memories: MemoryEntry[] = [
      { key: 'usr', values: ['john'], category: 'account', createdAt: 0, updatedAt: 0 },
    ];
    const scratch: ScratchpadEntry[] = [
      { key: 'note1', value: 'temp val', updatedAt: 0 },
    ];
    const msg = buildUserMessage('prompt', [], [], [], fakeBase64, memories, scratch);
    const text = (msg.content as any[])[0].text;
    expect(text).toContain('Long-term Memory');
    expect(text).toContain('usr');
    expect(text).toContain('john');
    expect(text).toContain('Scratchpad');
    expect(text).toContain('note1');
    expect(text).toContain('temp val');
  });

  it('includes annotated elements and formats images using OpenAI-compatible format', () => {
    const coordinates: CoordinateEntry[] = [
      { id: 3, tag: 'input', text: 'Search box', rect: { x: 0, y: 0, left: 0, top: 0, width: 10, height: 10 }, inputType: 'text' },
    ];
    const msg = buildUserMessage('prompt', [], [], [], fakeBase64, [], [], true, coordinates);
    const content = msg.content as any[];

    expect(content[1].text).toContain('Annotated Elements');
    expect(content[1].text).toContain('`[3]` `input(text)` — "Search box"');

    expect(content[2].type).toBe('image_url');
    expect(content[2].image_url.url).toBe(`data:image/png;base64,${fakeBase64}`);
  });

  it('includes inline reference images with OpenAI format', () => {
    const inline = [
      { name: 'ref.jpg', mimeType: 'image/jpeg', data: 'abc' },
    ];
    const msg = buildUserMessage('prompt', [], [], inline, fakeBase64, [], [], true);
    const content = msg.content as any[];

    // Text referencing inline images
    expect(content[1].text).toContain('User-provided reference images');
    expect(content[2].text).toContain('[ref.jpg]');
    // Inline image
    expect(content[3].type).toBe('image_url');
    expect(content[3].image_url.url).toBe('data:image/jpeg;base64,abc');
  });
});
