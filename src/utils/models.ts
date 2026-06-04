/**
 * Available models for the Opticlick agent.
 *
 * Gemini, Anthropic and OpenAI models are statically defined.
 * Ollama models are discovered at runtime.
 * Custom OpenAI-compatible endpoints are user-configured.
 *
 * Model-ID prefix convention:
 *   Gemini   — no prefix (e.g. "gemini-3.1-flash-lite-preview")
 *   Anthropic — "anthropic:" (e.g. "anthropic:claude-sonnet-4-20250514")
 *   OpenAI   — "openai:" (e.g. "openai:gpt-4.1")
 *   Custom   — "custom-openai:" (e.g. "custom-openai:<uuid>")
 *   Ollama   — "ollama:" (e.g. "ollama:llama3.2:3b")
 */

export type Provider = 'gemini' | 'anthropic' | 'openai' | 'custom-openai' | 'ollama';

export interface ModelOption {
  id: string;
  label: string;
  description: string;
  provider: Provider;
  /** Ollama only: true when the model is currently loaded in memory (visible in /api/ps). */
  running?: boolean;
}

export interface CustomOpenAIConfig {
  id: string;        // crypto.randomUUID()
  name: string;      // user-assigned display name, e.g. "Together AI"
  baseUrl: string;   // e.g. "https://api.together.xyz/v1"
  apiKey?: string;   // optional — some endpoints don't require a key
  modelName: string; // e.g. "meta-llama/Llama-3-70b-chat-hf"
}

// ── Static model lists ───────────────────────────────────────────────────────

export const GEMINI_MODELS: ModelOption[] = [
  {
    id: 'gemini-3.1-flash-lite-preview',
    label: 'Gemini 3.1 Flash Lite',
    description: 'Fast and efficient for most tasks',
    provider: 'gemini',
  },
  {
    id: 'gemma-4-31b-it',
    label: 'Gemma 4 31B',
    description: 'Larger model with enhanced reasoning',
    provider: 'gemini',
  },
];

export const ANTHROPIC_MODELS: ModelOption[] = [
  {
    id: 'anthropic:claude-sonnet-4-20250514',
    label: 'Claude Sonnet 4',
    description: 'Balanced speed and intelligence',
    provider: 'anthropic',
  },
  {
    id: 'anthropic:claude-haiku-4-20250514',
    label: 'Claude Haiku 4',
    description: 'Fast and cost-efficient',
    provider: 'anthropic',
  },
];

export const OPENAI_MODELS: ModelOption[] = [
  {
    id: 'openai:gpt-4.1',
    label: 'GPT-4.1',
    description: 'Flagship reasoning model',
    provider: 'openai',
  },
  {
    id: 'openai:gpt-4.1-mini',
    label: 'GPT-4.1 Mini',
    description: 'Fast and affordable',
    provider: 'openai',
  },
  {
    id: 'openai:o4-mini',
    label: 'o4-mini',
    description: 'Reasoning-optimized model',
    provider: 'openai',
  },
];

/** Backward-compatible aggregate of all statically-defined cloud models. */
export const AVAILABLE_MODELS: ModelOption[] = [
  ...GEMINI_MODELS,
  ...ANTHROPIC_MODELS,
  ...OPENAI_MODELS,
];

export const DEFAULT_MODEL = GEMINI_MODELS[0].id;

export const OLLAMA_BASE_URL = 'http://localhost:11434';

// ── Provider detection helpers ───────────────────────────────────────────────

/** Returns true if the model ID refers to a locally-running Ollama model. */
export function isOllamaModel(modelId: string): boolean {
  return modelId.startsWith('ollama:');
}

export function isAnthropicModel(modelId: string): boolean {
  return modelId.startsWith('anthropic:');
}

export function isOpenAIModel(modelId: string): boolean {
  return modelId.startsWith('openai:');
}

export function isCustomOpenAIModel(modelId: string): boolean {
  return modelId.startsWith('custom-openai:');
}

/** Canonical provider dispatch — returns the provider type for any model ID. */
export function getProviderForModel(modelId: string): Provider {
  if (isOllamaModel(modelId)) return 'ollama';
  if (isAnthropicModel(modelId)) return 'anthropic';
  if (isOpenAIModel(modelId)) return 'openai';
  if (isCustomOpenAIModel(modelId)) return 'custom-openai';
  return 'gemini';
}

// ── Model-name helpers ───────────────────────────────────────────────────────

/** Converts an Ollama model name (e.g. "llama3.2:3b") to an internal model ID. */
export function ollamaModelId(name: string): string {
  return `ollama:${name}`;
}

/** Strips the "ollama:" prefix to get the raw Ollama model name. */
export function ollamaModelName(modelId: string): string {
  return modelId.replace(/^ollama:/, '');
}

/** Strips the "anthropic:" prefix to get the raw Anthropic model name. */
export function anthropicModelName(modelId: string): string {
  return modelId.replace(/^anthropic:/, '');
}

/** Strips the "openai:" prefix to get the raw OpenAI model name. */
export function openaiModelName(modelId: string): string {
  return modelId.replace(/^openai:/, '');
}

/** Strips the "custom-openai:" prefix to get the config UUID. */
export function customOpenAIConfigId(modelId: string): string {
  return modelId.replace(/^custom-openai:/, '');
}

// ── Ollama runtime discovery ─────────────────────────────────────────────────

/**
 * Checks if Ollama is running by attempting to connect to its health endpoint.
 * Returns true if Ollama is reachable, false otherwise (and logs availability).
 * This is useful for early validation before starting the agent.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Queries the local Ollama daemon for available models, annotating each with
 * whether it is currently loaded in memory (via /api/ps).
 * Returns an empty array (silently) if Ollama is not running or unreachable.
 */
export async function fetchOllamaModels(): Promise<ModelOption[]> {
  try {
    const [tagsRes, psRes] = await Promise.all([
      fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${OLLAMA_BASE_URL}/api/ps`, { signal: AbortSignal.timeout(3000) }),
    ]);
    if (!tagsRes.ok) return [];

    const tagsData = (await tagsRes.json()) as {
      models?: Array<{ name: string; details?: { parameter_size?: string } }>;
    };

    // Build a set of currently-loaded model names from /api/ps
    const runningNames = new Set<string>();
    if (psRes.ok) {
      const psData = (await psRes.json()) as { models?: Array<{ name: string }> };
      for (const m of psData.models ?? []) runningNames.add(m.name);
    }

    return (tagsData.models ?? []).map((m) => ({
      id: ollamaModelId(m.name),
      label: m.name,
      description: m.details?.parameter_size
        ? `Local · ${m.details.parameter_size}`
        : 'Local Ollama model',
      provider: 'ollama' as const,
      running: runningNames.has(m.name),
    }));
  } catch {
    return [];
  }
}

// ── Label helpers ────────────────────────────────────────────────────────────

export function getModelLabel(
  modelId: string,
  ollamaModels: ModelOption[] = [],
  customConfigs: CustomOpenAIConfig[] = [],
): string {
  if (isCustomOpenAIModel(modelId)) {
    const configId = customOpenAIConfigId(modelId);
    return customConfigs.find((c) => c.id === configId)?.name ?? modelId;
  }
  const all = [...AVAILABLE_MODELS, ...ollamaModels];
  return all.find((m) => m.id === modelId)?.label ?? modelId;
}
