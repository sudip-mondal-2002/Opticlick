/** Coordinate entry returned by the content script annotator. */
export interface CoordinateEntry {
  id: number;
  tag: string;
  text: string;
  rect: {
    x: number;
    y: number;
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

/** Result returned from DRAW_MARKS message. */
export interface DrawMarksResult {
  success: boolean;
  coordinateMap: CoordinateEntry[];
  dpr: number;
}

/** Gemini LLM decision payload. */
export interface AgentDecision {
  targetId: number | null;
  done: boolean;
  reasoning: string;
  typeText?: string;
  navigateUrl?: string;
  scroll?: 'up' | 'down' | 'left' | 'right';
  scrollTargetId?: number;
  pressKey?: string;
}

/** Persisted agent state in chrome.storage.session. */
export interface AgentState {
  status: 'idle' | 'running' | 'done' | 'stopped' | 'error';
  tabId?: number;
  step: number;
  prompt?: string;
}

/** Log entry stored in chrome.storage.session. */
export interface LogEntry {
  message: string;
  level: 'think' | 'act' | 'observe' | 'screenshot' | 'info' | 'ok' | 'warn' | 'error';
  ts: number;
}

/** Messages flowing between popup / background / content. */
export type Message =
  | { type: 'START_AGENT'; tabId: number; prompt: string }
  | { type: 'STOP_AGENT' }
  | { type: 'AGENT_LOG'; message: string; level: string }
  | { type: 'AGENT_STATE_CHANGE' }
  | { type: 'DRAW_MARKS' }
  | { type: 'DESTROY_MARKS' }
  | { type: 'BLOCK_INPUT' }
  | { type: 'UNBLOCK_INPUT' }
  | { type: 'PING' };
