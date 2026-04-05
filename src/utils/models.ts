/**
 * Available models for the Opticlick agent.
 * Gemini models are statically defined; Ollama models are discovered at runtime.
 */

export interface ModelOption {
  id: string;
  label: string;
  description: string;
  provider: 'gemini' | 'ollama';
  /** Ollama only: true when the model is currently loaded in memory (visible in /api/ps). */
  running?: boolean;
}

export const AVAILABLE_MODELS: ModelOption[] = [
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

export const DEFAULT_MODEL = AVAILABLE_MODELS[0].id;

export const OLLAMA_BASE_URL = 'http://localhost:11434';

/** Returns true if the model ID refers to a locally-running Ollama model. */
export function isOllamaModel(modelId: string): boolean {
  return modelId.startsWith('ollama:');
}

/** Converts an Ollama model name (e.g. "llama3.2:3b") to an internal model ID. */
export function ollamaModelId(name: string): string {
  return `ollama:${name}`;
}

/** Strips the "ollama:" prefix to get the raw Ollama model name. */
export function ollamaModelName(modelId: string): string {
  return modelId.replace(/^ollama:/, '');
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

export function getModelLabel(modelId: string, ollamaModels: ModelOption[] = []): string {
  const all = [...AVAILABLE_MODELS, ...ollamaModels];
  return all.find((m) => m.id === modelId)?.label ?? modelId;
}

export function getModelDescription(modelId: string, ollamaModels: ModelOption[] = []): string {
  const all = [...AVAILABLE_MODELS, ...ollamaModels];
  return all.find((m) => m.id === modelId)?.description ?? '';
}
