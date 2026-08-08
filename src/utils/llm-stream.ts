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
import type { AgentAction, RawToolCall } from './types';
import { getLangSmithTracer } from './langsmith-config';
import { sleep } from './sleep';

const MAX_API_RETRIES = 5;
const RATE_LIMIT_DELAY_MS = 10_000;

/** Parse provider retry hints such as "225ms", "1.5s", or "18m6.048s". */
export function retryAfterMs(message: string): number | undefined {
  const match = message.match(/(?:try again|retry)\s+in\s+(?:(\d+(?:\.\d+)?)m)?\s*(\d+(?:\.\d+)?)\s*(ms|s|seconds?)/i);
  if (!match) return undefined;
  const minutes = Number(match[1] ?? 0);
  const value = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(value) || minutes < 0 || value < 0) return undefined;
  const unitMs = match[3].toLowerCase() === 'ms' ? value : value * 1000;
  return Math.ceil(minutes * 60_000 + unitMs);
}

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
    for (const part of chunk.content as Array<{ type: string; thinking?: string; text?: string }>) {
      if (part.type === 'thinking') fromContent += part.thinking ?? part.text ?? '';
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

/** Parse the one-line command grammar used by low-token text agents. */
function parseTextCommand(response: AIMessageChunk): { reasoning: string; actions: AgentAction[]; rawToolCalls: RawToolCall[] } {
  const content = typeof response.content === 'string'
    ? response.content
    : (response.content as Array<{ type: string; text?: string }>)
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('');
  const cleaned = content.replace(/```(?:text)?/gi, '').replace(/```/g, '').trim();
  const line = cleaned.split(/\r?\n/).map((value) => value.trim()).find(Boolean) ?? '';
  const match = line.match(/^(?:action\s*[:=]\s*)?(CLICK|TYPE|GO|SCROLL|KEY|DONE|[CTGSKF])(?:\s+|\|)([\s\S]*)$/i);
  if (!match) throw new Error(`Invalid compact command: ${line.slice(0, 120)}`);
  const value = match[2].trim();
  let args: Record<string, unknown>;
  switch (match[1].toUpperCase()) {
    case 'C':
    case 'CLICK': args = { command: `click ${value}` }; break;
    case 'T':
    case 'TYPE': args = { command: `type ${value}` }; break;
    case 'G':
    case 'GO': args = { command: `go ${value}` }; break;
    case 'S':
    case 'SCROLL': args = { command: `scroll ${value || 'down'}` }; break;
    case 'K':
    case 'KEY': args = { command: `key ${value}` }; break;
    default: args = { command: `finish ${value}` }; break;
  }
  const action = parseToolCall('browser_action', args);
  if (!action) throw new Error(`Unsupported compact command: ${line.slice(0, 120)}`);
  return {
    reasoning: line,
    actions: [action],
    rawToolCalls: [{ id: 'compact-command', name: 'browser_action', args }],
  };
}

function parseResearchAnswer(response: AIMessageChunk): { reasoning: string; actions: AgentAction[]; rawToolCalls: RawToolCall[] } {
  const content = typeof response.content === 'string'
    ? response.content
    : (response.content as Array<{ type: string; text?: string }>)
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('');
  const answer = content.trim();
  if (answer.length < 12) throw new Error('Research model returned an empty or incomplete answer.');
  const args = { summary: answer };
  return {
    reasoning: answer,
    actions: [{ type: 'finish', summary: answer }],
    rawToolCalls: [{ id: 'research-answer', name: 'browser_action', args }],
  };
}

// ── Retry loop ────────────────────────────────────────────────────────────────

/**
 * Stream the model response with exponential back-off on failure.
 * Thinking tokens are progressively flushed to the sidebar via
 * `onThinkingDelta` (sentence-boundary batching via `thinkingFlushPoint`),
 * giving the user a live streaming experience. The complete thinking text
 * is also returned so the caller can persist it in the graph state.
 *
 * Rate-limit (429) errors use a longer base delay than general errors.
 *
 * LangSmith tracing: When `config` is provided from a LangGraph node, we
 * strip its callbacks before passing to `.stream()`. This prevents the
 * LangSmith tracer from recording each thinking delta as a separate
 * "Reasoning" fragment. The consolidated thinking is returned in the
 * graph state and appears in the node-level trace instead.
 * For standalone calls (no config), the tracer is used directly.
 */
export async function streamWithRetry(
  modelWithTools: BoundModel,
  messages: BaseMessage[],
  logFn: LogFn,
  config?: RunnableConfig,
  onThinkingDelta?: (delta: string) => void,
  responseMode: 'tools' | 'text-command' | 'research-answer' = 'tools',
): Promise<{ reasoning: string; thinking: string; actions: AgentAction[]; rawToolCalls: RawToolCall[] }> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      const tracer = getLangSmithTracer();
      // Preserve LangGraph callbacks so each model call remains nested under
      // its reasoning node and the distributed dataset trace.
      let streamConfig: RunnableConfig;
      if (config) {
        streamConfig = config;
      } else {
        streamConfig = tracer ? { callbacks: [tracer] } : {};
      }
      const stream = await modelWithTools.stream(messages, streamConfig);
      const chunks: AIMessageChunk[] = [];
      let collectedThinking = '';
      let thinkingBuffer = '';

      for await (const rawChunk of stream) {
        const chunk = rawChunk as AIMessageChunk;
        const delta = thinkingDeltaOf(chunk);
        if (delta) {
          collectedThinking += delta;
          thinkingBuffer += delta;

          // Progressively flush thinking at sentence boundaries
          if (onThinkingDelta) {
            const flushAt = thinkingFlushPoint(thinkingBuffer);
            if (flushAt > 0) {
              onThinkingDelta(thinkingBuffer.slice(0, flushAt));
              thinkingBuffer = thinkingBuffer.slice(flushAt);
            }
          }
        }
        chunks.push(chunk);
      }

      // Flush any remaining thinking text
      if (onThinkingDelta && thinkingBuffer.trim()) {
        onThinkingDelta(thinkingBuffer);
      }

      if (chunks.length === 0) throw new Error('Empty stream response');

      const final = chunks.reduce((acc, c) => acc.concat(c));

      const usage = final.usage_metadata;
      if (usage) {
        const cached = usage.input_token_details?.cache_read ?? 0;
        await logFn(
          `LLM tokens: input=${usage.input_tokens ?? 0}, cached=${cached}, output=${usage.output_tokens ?? 0}`,
          'debug',
        );
      }

      // Preserve collected thinking in the final chunk's additional_kwargs
      // so it stays unified as a single trace attribute in LangSmith
      if (collectedThinking.trim()) {
        final.additional_kwargs = { ...final.additional_kwargs, thinking: collectedThinking };
      }

      const parsed = responseMode === 'text-command'
        ? parseTextCommand(final)
        : responseMode === 'research-answer'
          ? parseResearchAnswer(final)
          : parseResponse(final);
      return { ...parsed, thinking: collectedThinking.trim() };
    } catch (err) {
      lastError = err as Error;
      // Payload/token-limit errors are deterministic. Retrying the identical
      // request only burns the case timeout and provider quota.
      if (lastError.message.includes('413') || lastError.message.toLowerCase().includes('request too large')) {
        throw lastError;
      }
      // A daily quota cannot recover inside a case's timeout. Retrying it made
      // every remaining benchmark case burn ~4 minutes after the first TPD
      // exhaustion. Propagate immediately so the harness records the blocker.
      if (/tokens per day|\bTPD\b/i.test(lastError.message)) {
        throw lastError;
      }
      // The provider has already rejected this exact tool contract. Replaying
      // identical messages four more times wastes TPM and cannot repair a
      // schema/name mismatch; let the agent fail fast with the real cause.
      if (/tool call validation failed|attempted to call tool|tool calling.+not supported/i.test(lastError.message)) {
        throw lastError;
      }
      const isRateLimit = lastError.message.includes('429') || lastError.message.toLowerCase().includes('rate limit');
      if (attempt < MAX_API_RETRIES) {
        if (isRateLimit) {
          // Groq returns precise sub-second retry hints; Cerebras often does
          // not. Honor the provider hint and retain conservative fallback
          // backoff when no hint is available.
          const hintedDelay = retryAfterMs(lastError.message);
          const delay = hintedDelay === undefined
            ? RATE_LIMIT_DELAY_MS * attempt
            : Math.max(300, hintedDelay + 100);
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
