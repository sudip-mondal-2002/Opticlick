/**
 * LLM integration — model factories and the main callModel entry point.
 *
 * Pipeline: SYSTEM_INSTRUCTIONS + buildHistory + buildUserMessage
 *   → streamWithRetry → AgentResult
 */

import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AGENT_TOOLS } from './tools';
import type { AgentAction, TodoItem, CoordinateEntry, RawToolCall } from './types';
import type { VFSFile, MemoryEntry, ConversationTurn } from './db';
import type { ScratchpadEntry } from './scratchpad';
import {
  DEFAULT_MODEL,
  OLLAMA_BASE_URL,
  ollamaModelName,
  anthropicModelName,
  openaiModelName,
  customOpenAIConfigId,
  getProviderForModel,
} from './models';
import type { CustomOpenAIConfig } from './models';
import { SYSTEM_INSTRUCTIONS } from './system-prompt';
import { buildHistory, buildUserMessage } from './prompt';
import { streamWithRetry } from './llm-stream';

const THINKING_LEVEL = 'HIGH';
const ANTHROPIC_THINKING_BUDGET = 10000;

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

export type AnyModel = ChatGoogleGenerativeAI | ChatOllama | ChatAnthropic | ChatOpenAI;

export interface ApiKeys {
  geminiApiKey?: string | null;
  anthropicApiKey?: string | null;
  openaiApiKey?: string | null;
  customOpenaiConfigs?: CustomOpenAIConfig[];
}

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

export function createAnthropicModel(apiKey: string, modelId: string): ChatAnthropic {
  return new ChatAnthropic({
    model: anthropicModelName(modelId),
    anthropicApiKey: apiKey,
    temperature: 0.1,
    maxRetries: 0,
    thinking: { type: 'enabled', budget_tokens: ANTHROPIC_THINKING_BUDGET },
  });
}

export function createOpenAIModel(apiKey: string, modelId: string): ChatOpenAI {
  const model = openaiModelName(modelId);
  const isOSeries = model.startsWith('o');
  // o-series models use reasoning_effort instead of temperature
  if (isOSeries) {
    return new ChatOpenAI({
      model,
      openAIApiKey: apiKey,
      maxRetries: 0,
      modelKwargs: { reasoning_effort: 'medium' },
    });
  }
  return new ChatOpenAI({ model, openAIApiKey: apiKey, temperature: 0.1, maxRetries: 0 });
}

export function createCustomOpenAIModel(config: CustomOpenAIConfig): ChatOpenAI {
  return new ChatOpenAI({
    model: config.modelName,
    openAIApiKey: config.apiKey || 'not-needed',
    temperature: 0.1,
    maxRetries: 0,
    configuration: { baseURL: config.baseUrl },
  });
}

/** Unified factory — returns the appropriate LangChain model based on the model ID. */
export function createAnyModel(keys: ApiKeys, modelId: string): AnyModel {
  const provider = getProviderForModel(modelId);
  switch (provider) {
    case 'ollama':
      return createOllamaModel(modelId);
    case 'anthropic':
      if (!keys.anthropicApiKey) throw new Error('Anthropic API key required for Claude models');
      return createAnthropicModel(keys.anthropicApiKey, modelId);
    case 'openai':
      if (!keys.openaiApiKey) throw new Error('OpenAI API key required for OpenAI models');
      return createOpenAIModel(keys.openaiApiKey, modelId);
    case 'custom-openai': {
      const configId = customOpenAIConfigId(modelId);
      const config = keys.customOpenaiConfigs?.find((c) => c.id === configId);
      if (!config) throw new Error(`Custom OpenAI config "${configId}" not found`);
      return createCustomOpenAIModel(config);
    }
    case 'gemini':
    default:
      if (!keys.geminiApiKey) throw new Error('Gemini API key required for Gemini models');
      return createModel(keys.geminiApiKey, modelId);
  }
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
  // Only Gemini uses native image format; all others use OpenAI-compatible image_url format
  const useImageUrlFormat = !(model instanceof ChatGoogleGenerativeAI);
  const messages: BaseMessage[] = [
    new SystemMessage(SYSTEM_INSTRUCTIONS),
    ...buildHistory(history),
    buildUserMessage(userPrompt, vfsFiles, currentTodo, inlineImages, base64Image, memoryEntries, scratchpadEntries, useImageUrlFormat, coordinateMap),
  ];
  const modelWithTools = model.bindTools([...AGENT_TOOLS]);
  const { reasoning, thinking, actions, rawToolCalls } = await streamWithRetry(modelWithTools, messages, logFn, config, onThinkingDelta);
  return { reasoning, thinking, actions, done: actions.some((a: AgentAction) => a.type === 'finish'), rawToolCalls };
}
