/**
 * LangGraph state annotation and shared execution constants for the agent graph.
 */

import { Annotation } from '@langchain/langgraph';
import type { AnyModel, InlineImage } from '@/utils/llm';
import type { MemoryEntry } from '@/utils/db';
import type { ScratchpadEntry } from '@/utils/scratchpad';
import type { AgentAction, RawToolCall, TodoItem, CoordinateEntry, AttachedFile } from '@/utils/types';
import type { ActionRecord } from '@/utils/navigation-guard';

// ── Execution constants ───────────────────────────────────────────────────────

export const MAX_STEPS = 500;
export const STEP_DELAY_MS = 800;
export const RATE_LIMIT_DELAY_MS = 10_000;
export const MAX_EMPTY_RETRIES = 3;

// ── UI action type sets ───────────────────────────────────────────────────────

export const UI_ACTION_TYPES = new Set(['click', 'type', 'navigate', 'scroll', 'press_key']);
export const UI_ACTION_TYPES_NO_CLICK = new Set(['navigate', 'scroll', 'press_key']);

/** Returns true if the action list contains at least one UI action. */
export function hasUIAction(actions: AgentAction[], noElements = false): boolean {
  return actions.some((a) =>
    noElements ? UI_ACTION_TYPES_NO_CLICK.has(a.type) : UI_ACTION_TYPES.has(a.type),
  );
}

// ── State annotation ──────────────────────────────────────────────────────────

export const AgentStateAnnotation = Annotation.Root({
  // Session config (set once)
  tabId: Annotation<number>({ reducer: (_, b) => b }),
  sessionId: Annotation<number>({ reducer: (_, b) => b }),
  userPrompt: Annotation<string>({ reducer: (_, b) => b }),
  anchoredPrompt: Annotation<string>({ reducer: (_, b) => b }),
  model: Annotation<AnyModel>({ reducer: (_, b) => b }),
  attachments: Annotation<AttachedFile[]>({ reducer: (_, b) => b }),

  // Loop counters
  step: Annotation<number>({ reducer: (_, b) => b }),
  emptyRetries: Annotation<number>({ reducer: (_, b) => b }),
  actionHistory: Annotation<ActionRecord[]>({ reducer: (_, b) => b }),
  retryStep: Annotation<boolean>({ reducer: (_, b) => b }),

  // Per-step page data
  coordinateMap: Annotation<CoordinateEntry[]>({ reducer: (_, b) => b }),
  base64Image: Annotation<string>({ reducer: (_, b) => b }),
  inlineImages: Annotation<InlineImage[]>({ reducer: (_, b) => b }),

  // Agent memory (updated by side effects)
  currentTodo: Annotation<TodoItem[]>({ reducer: (_, b) => b }),
  memoryEntries: Annotation<MemoryEntry[]>({ reducer: (_, b) => b }),
  scratchpadEntries: Annotation<ScratchpadEntry[]>({ reducer: (_, b) => b }),

  // LLM output
  actions: Annotation<AgentAction[]>({ reducer: (_, b) => b }),
  rawToolCalls: Annotation<RawToolCall[]>({ reducer: (_, b) => b }),
  reasoning: Annotation<string>({ reducer: (_, b) => b }),
  done: Annotation<boolean>({ reducer: (_, b) => b }),

  // Control flow
  stopped: Annotation<boolean>({ reducer: (_, b) => b }),
  askUserQuestion: Annotation<string | undefined>({ reducer: (_, b) => b }),
  llmFailed: Annotation<boolean>({ reducer: (_, b) => b }),
});

export type AgentState = typeof AgentStateAnnotation.State;
