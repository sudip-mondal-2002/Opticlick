/**
 * LLM streaming helpers: thinking-token flushing, response parsing, retry loop.
 *
 * Exports:
 *   thinkingFlushPoint — exported for unit testing
 *   thinkingDeltaOf    — exported for unit testing
 *   streamWithRetry    — called by callModel in llm.ts
 */

import type { BaseMessage, AIMessageChunk } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { parseToolCall } from './tools';
import type { AgentAction, AgentResult, RawToolCall } from './types';
import { getLangSmithTracer } from './langsmith-config';
import { sleep } from './sleep';

const MAX_API_RETRIES = 5;
const RATE_LIMIT_DELAY_MS = 10_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BoundModel = any;
type LogFn = (msg: string, level?: string) => Promise<void>;

// ── Thinking-token helpers ────────────────────────────────────────────────────

/**
 * Return the index at which to flush the buffered thinking text.
 * Flushes at the last sentence-end (. ! ?) if the buffer is long enough,
 * otherwise at the last word boundary, otherwise 0 (don't flush yet).
 * Exported for unit testing.
 */
export function thinkingFlushPoint(buf: string, minLen = 120): number {
  if (buf.length < minLen) return 0;
  for (let i = buf.length - 1; i >= minLen / 2; i--) {
    if ('.!?'.includes(buf[i]) && (i + 1 >= buf.length || buf[i + 1] === ' ' || buf[i + 1] === '\n')) {
      return i + 1;
    }
  }
  const lastSpace = buf.lastIndexOf(' ');
  return lastSpace > minLen / 2 ? lastSpace + 1 : 0;
}

/** Extract any thinking-token delta from a stream chunk. Exported for unit testing. */
export function thinkingDeltaOf(chunk: AIMessageChunk): string {
  const fromKwargs = (chunk.additional_kwargs?.thinking as string | undefined) ?? '';
  let fromContent = '';
  if (Array.isArray(chunk.content)) {
    for (const part of chunk.content as Array<{ type: string; thinking?: string }>) {
      if (part.type === 'thinking' && part.thinking) fromContent += part.thinking;
    }
  }
  return fromKwargs + fromContent;
}

// ── Response parsing ──────────────────────────────────────────────────────────

function parseResponse(response: AIMessageChunk): { reasoning: string; actions: AgentAction[]; rawToolCalls: RawToolCall[] } {
  const reasoning =
    typeof response.content === 'string'
      ? response.content
      : (response.content as Array<{ type: string; text?: string }>)
          .filter((p) => p.type === 'text')
          .map((p) => p.text ?? '')
          .join('');

  const toolCalls = response.tool_calls ?? [];
  if (toolCalls.length === 0) throw new Error('Model returned no tool calls — cannot determine action.');

  const rawToolCalls: RawToolCall[] = toolCalls.map((tc) => ({
    id: tc.id ?? '', name: tc.name, args: tc.args as Record<string, unknown>,
  }));

  const actions = toolCalls
    .map((tc) => parseToolCall(tc.name, tc.args as Record<string, unknown>))
    .filter((a): a is NonNullable<typeof a> => a !== null);

  return { reasoning: reasoning.trim(), actions, rawToolCalls };
}

// ── Retry loop ────────────────────────────────────────────────────────────────

/**
 * Stream the model response with exponential back-off on failure.
 * Thinking tokens are flushed to logFn at sentence boundaries as they arrive.
 * Rate-limit (429) errors use a longer base delay than general errors.
 *
 * When `config` is provided (LangGraph node context), its callbacks are used
 * so the LLM call is nested under the current graph node span in LangSmith.
 */
export async function streamWithRetry(
  modelWithTools: BoundModel,
  messages: BaseMessage[],
  logFn: LogFn,
  config?: RunnableConfig,
): Promise<{ reasoning: string; actions: AgentAction[]; rawToolCalls: RawToolCall[] }> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      const tracer = getLangSmithTracer();
      const streamConfig: RunnableConfig = config ?? (tracer ? { callbacks: [tracer] } : {});
      const stream = await modelWithTools.stream(messages, streamConfig);
      const chunks: AIMessageChunk[] = [];
      let thinkingBuf = '';
      let streamedThinkingChars = 0;

      for await (const rawChunk of stream) {
        const chunk = rawChunk as AIMessageChunk;
        const delta = thinkingDeltaOf(chunk);
        if (delta) {
          thinkingBuf += delta;
          streamedThinkingChars += delta.length;
          const flushAt = thinkingFlushPoint(thinkingBuf);
          if (flushAt > 0) {
            await logFn(thinkingBuf.slice(0, flushAt).trim(), 'think');
            thinkingBuf = thinkingBuf.slice(flushAt);
          }
        }
        chunks.push(chunk);
      }

      if (thinkingBuf.trim()) await logFn(thinkingBuf.trim(), 'think');
      if (chunks.length === 0) throw new Error('Empty stream response');

      const final = chunks.reduce((acc, c) => acc.concat(c));

      if (streamedThinkingChars === 0) {
        const mergedThinking = (final.additional_kwargs?.thinking as string | undefined) ?? '';
        if (mergedThinking.trim()) {
          const paragraphs = mergedThinking.split(/\n\n+/).filter((p) => p.trim());
          if (paragraphs.length > 3) {
            await logFn(paragraphs[0].trim(), 'think');
            await logFn(`[${paragraphs.length - 1} more thinking steps…]`, 'think');
          } else {
            for (const para of paragraphs) await logFn(para.trim(), 'think');
          }
        }
      }

      return parseResponse(final);
    } catch (err) {
      lastError = err as Error;
      const isRateLimit = lastError.message.includes('429') || lastError.message.toLowerCase().includes('rate limit');
      if (attempt < MAX_API_RETRIES) {
        if (isRateLimit) {
          const delay = RATE_LIMIT_DELAY_MS * attempt;
          await logFn(`Rate limited (attempt ${attempt}/${MAX_API_RETRIES}). Waiting ${delay / 1000}s…`, 'warn');
          await sleep(delay);
        } else {
          await logFn(`API attempt ${attempt} failed: ${lastError.message}. Retrying…`, 'warn');
          await sleep(1500 * attempt);
        }
      }
    }
  }

  throw lastError;
}

export type { AgentResult };
