import { vi } from 'vitest';
import { AIMessageChunk } from '@langchain/core/messages';

/** Build a minimal AIMessageChunk with a tool call. */
export function toolChunk(name: string, args: Record<string, unknown>): AIMessageChunk {
  return new AIMessageChunk({
    content: '',
    tool_calls: [{ name, args, id: `call_${name}`, type: 'tool_call' }],
  });
}

/** Build a minimal AIMessageChunk carrying thinking text. */
export function thinkChunk(thinking: string): AIMessageChunk {
  return new AIMessageChunk({
    content: '',
    additional_kwargs: { thinking },
  });
}

/** Build a minimal AIMessageChunk carrying text content. */
export function textChunk(text: string): AIMessageChunk {
  return new AIMessageChunk({
    content: text,
  });
}

/**
 * Creates a fake model mimicking ChatGoogleGenerativeAI (or ChatOpenAI/ChatAnthropic).
 * Returns an object that can be passed to callModel.
 */
export function makeFakeGeminiModel(chunks: AIMessageChunk[]) {
  const boundModel = {
    stream: vi.fn(async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    }),
  };
  const model = {
    bindTools: vi.fn(() => boundModel),
  };
  return model;
}
