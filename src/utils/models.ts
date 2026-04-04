/**
 * Available Gemini models for the Opticlick agent.
 */

export interface ModelOption {
  id: string;
  label: string;
  description: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: 'gemini-3.1-flash-lite-preview',
    label: 'Gemini 3.1 Flash Lite',
    description: 'Fast and efficient for most tasks',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'Balanced speed and capabilities',
  },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    description: 'Lightweight version',
  },
  {
    id: 'gemini-4-31b',
    label: 'Gemma 4 31B',
    description: 'Larger model with enhanced reasoning',
  }
];

export const DEFAULT_MODEL = AVAILABLE_MODELS[0].id;

export function getModelLabel(modelId: string): string {
  return AVAILABLE_MODELS.find((m) => m.id === modelId)?.label ?? modelId;
}

export function getModelDescription(modelId: string): string {
  return AVAILABLE_MODELS.find((m) => m.id === modelId)?.description ?? '';
}
