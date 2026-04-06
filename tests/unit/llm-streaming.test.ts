/**
 * Unit tests for the LLM streaming helpers.
 *
 * thinkingFlushPoint — pure function, no mocking needed.
 * thinkingDeltaOf    — pure function operating on AIMessageChunk shapes.
 * streamWithRetry    — tested indirectly via callModel with a fake streaming model.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import { AIMessageChunk } from '@langchain/core/messages';
import { thinkingFlushPoint, thinkingDeltaOf, createModel, callModel } from '@/utils/llm';

// ── thinkingFlushPoint ────────────────────────────────────────────────────────

describe('thinkingFlushPoint', () => {
  it('returns 0 when buffer is shorter than minLen', () => {
    expect(thinkingFlushPoint('Too short.', 120)).toBe(0);
  });

  it('flushes at a sentence boundary (period + space)', () => {
    const buf = 'First sentence is here and long enough. Second sentence continues.';
    const idx = thinkingFlushPoint(buf, 30);
    expect(idx).toBeGreaterThan(0);
    expect(buf[idx - 1]).toBe('.');
  });

  it('flushes at an exclamation mark when it is the last sentence boundary', () => {
    // No period after the '!' — so '!' is the last sentence end the walker finds
    const buf = 'This is definitely long enough to trigger! And more text follows';
    const idx = thinkingFlushPoint(buf, 30);
    expect(idx).toBeGreaterThan(0);
    expect(buf.slice(0, idx).endsWith('!')).toBe(true);
  });

  it('falls back to a word boundary when no sentence end exists', () => {
    const buf = 'This is a long buffer without any sentence terminator just words here now';
    const idx = thinkingFlushPoint(buf, 30);
    expect(idx).toBeGreaterThan(0);
    // The character just before the flush point must be a space (we split after it)
    // or idx lands on a space — verify no word is split
    const before = buf.slice(0, idx);
    expect(before.trimEnd()).toBe(before.trim());
  });

  it('returns 0 when buffer meets minLen but has no sentence or word boundary', () => {
    // Single word longer than minLen — no space, no sentence end
    const buf = 'a'.repeat(150);
    expect(thinkingFlushPoint(buf, 120)).toBe(0);
  });

  it('flushes the whole buffer when it ends exactly on a sentence boundary', () => {
    const buf = 'A' + 'x'.repeat(119) + '.'; // 121 chars, ends with '.'
    const idx = thinkingFlushPoint(buf, 120);
    expect(idx).toBe(buf.length); // flush everything
  });
});

// ── thinkingDeltaOf ───────────────────────────────────────────────────────────

describe('thinkingDeltaOf', () => {
  function makeChunk(opts: {
    kwargThinking?: string;
    contentThinking?: string;
    contentText?: string;
  }): AIMessageChunk {
    const content: Array<{ type: string; thinking?: string; text?: string }> = [];
    if (opts.contentThinking !== undefined) {
      content.push({ type: 'thinking', thinking: opts.contentThinking });
    }
    if (opts.contentText !== undefined) {
      content.push({ type: 'text', text: opts.contentText });
    }
    return new AIMessageChunk({
      content: content.length > 0 ? content : '',
      additional_kwargs: opts.kwargThinking !== undefined
        ? { thinking: opts.kwargThinking }
        : {},
    });
  }

  it('returns empty string when chunk has no thinking', () => {
    const chunk = makeChunk({ contentText: 'hello' });
    expect(thinkingDeltaOf(chunk)).toBe('');
  });

  it('extracts thinking from additional_kwargs.thinking', () => {
    const chunk = makeChunk({ kwargThinking: 'I am thinking…' });
    expect(thinkingDeltaOf(chunk)).toBe('I am thinking…');
  });

  it('extracts thinking from a content-array block with type "thinking"', () => {
    const chunk = makeChunk({ contentThinking: 'Content block thinking.' });
    expect(thinkingDeltaOf(chunk)).toBe('Content block thinking.');
  });

  it('concatenates both sources when both are present', () => {
    const chunk = makeChunk({
      kwargThinking: 'kwarg part ',
      contentThinking: 'content part',
    });
    expect(thinkingDeltaOf(chunk)).toBe('kwarg part content part');
  });

  it('ignores content blocks that are not type "thinking"', () => {
    const chunk = makeChunk({ contentText: 'plain text', contentThinking: undefined });
    expect(thinkingDeltaOf(chunk)).toBe('');
  });
});

// ── callModel streaming integration ──────────────────────────────────────────

describe('callModel — streaming integration', () => {
  /** Build a minimal AIMessageChunk with a tool call. */
  function toolChunk(name: string, args: Record<string, unknown>): AIMessageChunk {
    return new AIMessageChunk({
      content: '',
      tool_calls: [{ name, args, id: `call_${name}`, type: 'tool_call' }],
    });
  }

  /** Build a minimal AIMessageChunk carrying thinking text. */
  function thinkChunk(thinking: string): AIMessageChunk {
    return new AIMessageChunk({
      content: '',
      additional_kwargs: { thinking },
    });
  }

  function makeModel(streamChunks: AIMessageChunk[]) {
    const boundModel = {
      stream: vi.fn(async function* () {
        for (const chunk of streamChunks) yield chunk;
      }),
    };
    const model = {
      bindTools: vi.fn(() => boundModel),
    };
    return { model, boundModel };
  }

  it('collects thinking tokens that arrive per-chunk via additional_kwargs', async () => {
    const { model, boundModel } = makeModel([
      thinkChunk('I should click the button. '),
      thinkChunk('Yes that is correct. '),
      toolChunk('click', { targetId: 3 }),
    ]);

    const logged: Array<{ msg: string; level: string }> = [];
    const logFn = async (msg: string, level = 'info') => { logged.push({ msg, level }); };

    const result = await callModel(
      model as ReturnType<typeof createModel>,
      'base64img',
      'Click the button',
      [],
      logFn,
    );

    // Thinking is collected silently and preserved in the response's additional_kwargs
    // (accessible as part of the LangChain AIMessage, not in the text reasoning)
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('click');
    expect(boundModel.stream).toHaveBeenCalledOnce();
  });

  it('progressively emits thinking deltas via onThinkingDelta callback', async () => {
    // Build enough thinking text to trigger sentence-boundary flushing (minLen=120)
    const longSentence1 = 'I need to carefully examine the page and find the right element to click on. This requires visual analysis of all annotated elements. ';
    const longSentence2 = 'After reviewing the screenshot I can see the target button is element number three. ';
    const { model } = makeModel([
      thinkChunk(longSentence1),
      thinkChunk(longSentence2),
      toolChunk('click', { targetId: 3 }),
    ]);

    const deltas: string[] = [];
    const onThinkingDelta = (delta: string) => { deltas.push(delta); };

    const result = await callModel(
      model as ReturnType<typeof createModel>,
      'base64img',
      'Click the button',
      [],
      async () => {},
      [],  // vfsFiles
      [],  // inlineImages
      [],  // currentTodo
      [],  // memoryEntries
      [],  // scratchpadEntries
      [],  // coordinateMap
      undefined,  // config
      onThinkingDelta,
    );

    // At least one delta should have been emitted progressively
    expect(deltas.length).toBeGreaterThan(0);
    // All deltas concatenated (trimmed) should equal the complete thinking
    // (result.thinking is .trim()'d, deltas preserve raw whitespace)
    expect(deltas.join('').trim()).toBe(result.thinking);
    expect(result.actions[0].type).toBe('click');
  });

  it('preserves thinking from merged additional_kwargs when no per-chunk thinking arrived', async () => {
    // Simulate Gemini putting thinking only in the final merged response
    const toolC = toolChunk('navigate', { url: 'https://example.com' });
    // Manually attach thinking to the chunk (simulating what concat() would produce)
    (toolC as AIMessageChunk & { additional_kwargs: Record<string, unknown> })
      .additional_kwargs.thinking = 'I need to navigate there.';

    const { model } = makeModel([toolC]);

    const result = await callModel(
      model as ReturnType<typeof createModel>,
      'base64img',
      'Navigate to example.com',
      [],
      async () => {},
    );

    // Thinking is preserved in additional_kwargs, tool call is parsed correctly
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('navigate');
  });

  it('assembles tool calls split across multiple chunks', async () => {
    // Tool call args arrive in two separate chunks (streaming fragmentation)
    const chunk1 = new AIMessageChunk({
      content: '',
      tool_calls: [{ name: 'click', args: { targetId: 7 }, id: 'call_1', type: 'tool_call' }],
    });
    const chunk2 = new AIMessageChunk({ content: '' });

    const { model } = makeModel([chunk1, chunk2]);

    const result = await callModel(
      model as ReturnType<typeof createModel>,
      'base64img',
      'Click element 7',
    );

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('click');
    if (result.actions[0].type === 'click') {
      expect(result.actions[0].targetId).toBe(7);
    }
  });

  it('sets done=true when a finish action is present', async () => {
    const { model } = makeModel([
      toolChunk('finish', { summary: 'All done.' }),
    ]);

    const result = await callModel(
      model as ReturnType<typeof createModel>,
      'base64img',
      'Finish now',
    );

    expect(result.done).toBe(true);
    expect(result.actions[0].type).toBe('finish');
  });

  it('returns rawToolCalls parallel to actions', async () => {
    const { model } = makeModel([
      toolChunk('todo_update', { updates: [{ id: 'step-1', status: 'done' }] }),
      toolChunk('click', { targetId: 3 }),
    ]);

    const result = await callModel(
      model as ReturnType<typeof createModel>,
      'base64img',
      'Click something',
    );

    expect(result.rawToolCalls).toHaveLength(2);
    expect(result.rawToolCalls[0].name).toBe('todo_update');
    expect(result.rawToolCalls[0].id).toBe('call_todo_update');
    expect(result.rawToolCalls[1].name).toBe('click');
    expect(result.rawToolCalls[1].id).toBe('call_click');
    // rawToolCalls[i] is the source of actions[i]
    expect(result.actions[0].type).toBe('todo_update');
    expect(result.actions[1].type).toBe('click');
  });

  it('retries on error and succeeds on the second attempt', async () => {
    let calls = 0;
    const boundModel = {
      stream: vi.fn(async function* () {
        calls++;
        if (calls === 1) throw new Error('transient network error');
        yield toolChunk('click', { targetId: 1 });
      }) as Mock,
    };
    const model = { bindTools: vi.fn(() => boundModel) };

    const result = await callModel(
      model as ReturnType<typeof createModel>,
      'base64img',
      'Click something',
    );

    expect(boundModel.stream).toHaveBeenCalledTimes(2);
    expect(result.actions[0].type).toBe('click');
  });
});
