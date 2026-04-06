/**
 * LLM integration — model factories and the main callModel entry point.
 *
 * Pipeline: SYSTEM_INSTRUCTIONS + buildHistory + buildUserMessage
 *   → streamWithRetry → AgentResult
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import { SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AGENT_TOOLS } from './tools';
import type { AgentAction, TodoItem, CoordinateEntry, RawToolCall } from './types';
import type { VFSFile, MemoryEntry, ConversationTurn } from './db';
import type { ScratchpadEntry } from './scratchpad';
import { DEFAULT_MODEL, OLLAMA_BASE_URL, isOllamaModel, ollamaModelName } from './models';
import { SYSTEM_INSTRUCTIONS } from './system-prompt';
import { buildHistory, buildUserMessage } from './prompt';
import { streamWithRetry } from './llm-stream';

// Re-export for backward compatibility with tests that import from this module
export { thinkingFlushPoint, thinkingDeltaOf } from './llm-stream';

const THINKING_LEVEL = 'HIGH';

export interface InlineImage {
  name: string;
  mimeType: string;
  /** Base64-encoded data (no data-URL prefix). */
  data: string;
}

export interface LLMResult {
  reasoning: string;
  thinking: string;
  actions: AgentAction[];
  done: boolean;
  rawToolCalls: RawToolCall[];
}

export type AnyModel = ChatGoogleGenerativeAI | ChatOllama;

// ── Model factories ───────────────────────────────────────────────────────────

export function createModel(apiKey: string, modelId?: string): ChatGoogleGenerativeAI {
  const model = modelId ?? DEFAULT_MODEL;
  const supportsThinking = !model.includes('gemini-4-');

  interface ModelConfig {
    model: string; apiKey: string; temperature: number; maxRetries: number;
    thinkingConfig?: { thinkingLevel: 'THINKING_LEVEL_UNSPECIFIED' | 'LOW' | 'MEDIUM' | 'HIGH'; includeThoughts: boolean };
  }
  const config: ModelConfig = { model, apiKey, temperature: 0.1, maxRetries: 0 };
  if (supportsThinking) config.thinkingConfig = { thinkingLevel: THINKING_LEVEL, includeThoughts: true };
  return new ChatGoogleGenerativeAI(config);
}

export function createOllamaModel(modelId: string): ChatOllama {
  return new ChatOllama({ model: ollamaModelName(modelId), baseUrl: OLLAMA_BASE_URL, temperature: 0.1 });
}

/** Unified factory — returns Gemini or Ollama model based on the model ID. */
export function createAnyModel(apiKey: string | null, modelId: string): AnyModel {
  if (isOllamaModel(modelId)) return createOllamaModel(modelId);
  if (!apiKey) throw new Error('Gemini API key required for Gemini models');
  return createModel(apiKey, modelId);
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function callModel(
  model: AnyModel,
  base64Image: string,
  userPrompt: string,
  history: ConversationTurn[] = [],
  logFn: (msg: string, level?: string) => Promise<void> = async () => {},
  vfsFiles: VFSFile[] = [],
  inlineImages: InlineImage[] = [],
  currentTodo: TodoItem[] = [],
  memoryEntries: MemoryEntry[] = [],
  scratchpadEntries: ScratchpadEntry[] = [],
  coordinateMap: CoordinateEntry[] = [],
  config?: RunnableConfig,
  onThinkingDelta?: (delta: string) => void,
): Promise<LLMResult> {
  const ollamaFormat = model instanceof ChatOllama;
  const messages: BaseMessage[] = [
    new SystemMessage(SYSTEM_INSTRUCTIONS),
    ...buildHistory(history),
    buildUserMessage(userPrompt, vfsFiles, currentTodo, inlineImages, base64Image, memoryEntries, scratchpadEntries, ollamaFormat, coordinateMap),
  ];
  const modelWithTools = model.bindTools([...AGENT_TOOLS]);
  const { reasoning, thinking, actions, rawToolCalls } = await streamWithRetry(modelWithTools, messages, logFn, config, onThinkingDelta);
  return { reasoning, thinking, actions, done: actions.some((a: AgentAction) => a.type === 'finish'), rawToolCalls };
}
