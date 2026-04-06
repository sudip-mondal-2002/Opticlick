import type { CoordinateEntry } from '@/utils/types';

/** Shared context passed to every side-effect handler. */
export interface EffectCtx {
  sessionId: number;
  tabId: number;
  base64Image: string;
  step: number;
  coordinateMap: CoordinateEntry[];
  userPrompt: string;
  toolCallId: string;
  toolName: string;
}
