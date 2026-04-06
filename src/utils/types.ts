/** Coordinate entry returned by the content script annotator. */
export interface CoordinateEntry {
  id: number;
  tag: string;
  text: string;
  /** For <input> elements, the value of the `type` attribute (e.g. "file", "text"). */
  inputType?: string;
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

/** A single item in the agent's task todo list. */
export interface TodoItem {
  /** Short kebab-case identifier, e.g. "navigate-to-login". */
  id: string;
  /** Human-readable task title. */
  title: string;
  status: 'pending' | 'in_progress' | 'done' | 'skipped';
  /** Optional observation or note the agent adds when working on this item. */
  notes?: string;
}

/** A partial update to apply to an existing TodoItem. */
export interface TodoUpdate {
  id: string;
  status?: TodoItem['status'];
  notes?: string;
}

/**
 * Discriminated union of every action the agent can take in a single turn.
 * UI actions (click/navigate/scroll/press_key) are mutually exclusive;
 * VFS, DOM, and todo actions may be combined freely with each other and
 * with at most one UI action per turn.
 */
export type AgentAction =
  // ── UI actions ──────────────────────────────────────────────────────────
  | {
      type: 'click';
      /** Numeric ID of the annotated element. */
      targetId: number;
      /**
       * Modifier key held during the click (uses CDP bitmask).
       * Use 'ctrl' for Ctrl+Click (open in new tab, multi-select) on all platforms.
       * Use 'meta' for Cmd+Click on macOS or Win+Click on Windows.
       */
      modifier?: 'ctrl' | 'meta' | 'shift' | 'alt';
      /** VFS file ID or filename to inject into a file input. */
      uploadFileId?: string;
    }
  | {
      type: 'type';
      /** Text to type into the currently focused element (after a prior click). */
      text: string;
      /**
       * When true, selects all existing content (Ctrl+A) before typing,
       * so text replaces the field value instead of appending to it.
       */
      clearField?: boolean;
    }
  | { type: 'navigate'; url: string }
  | {
      type: 'scroll';
      direction: 'up' | 'down' | 'left' | 'right';
      /** If set, scroll inside this element instead of the page. */
      scrollTargetId?: number;
    }
  | { type: 'press_key'; key: string }
  // ── DOM inspection ───────────────────────────────────────────────────────
  | { type: 'fetch_dom'; targetId: number }
  // ── VFS mutations ────────────────────────────────────────────────────────
  | { type: 'vfs_save_screenshot'; name: string }
  | { type: 'vfs_write'; name: string; content: string; mimeType?: string }
  | { type: 'vfs_delete'; fileId: string }
  | { type: 'vfs_download'; url: string; name?: string }
  // ── Memory management ─────────────────────────────────────────────────────
  | { type: 'memory_upsert'; key: string; values: string[]; category: string; sourceUrl?: string }
  | { type: 'memory_delete'; key: string }
  // ── Scratchpad ────────────────────────────────────────────────────────────
  | { type: 'note_write'; key: string; value: string }
  | { type: 'note_delete'; key: string }
  // ── Todo management ──────────────────────────────────────────────────────
  | { type: 'todo_create'; items: TodoItem[] }
  | { type: 'todo_update'; updates: TodoUpdate[] }
  | { type: 'todo_add'; items: TodoItem[] }
  // ── Control ──────────────────────────────────────────────────────────────
  | { type: 'finish'; summary: string }
  | {
      type: 'wait';
      /** Milliseconds to pause before the next action (100–10 000). */
      ms: number;
    }
  | {
      type: 'ask_user';
      /** The clarification question to display to the user. */
      question: string;
    };

/** A single raw tool call as returned by the LLM (before parsing into AgentAction). */
export interface RawToolCall {
  /** Tool call ID assigned by the model (used to link function_response in history). */
  id: string;
  /** Tool name as declared in the schema (e.g. "click", "todo_update"). */
  name: string;
  /** Raw arguments object from the model. */
  args: Record<string, unknown>;
}

/** Structured result returned by callModel. */
export interface AgentResult {
  /** Model's step-by-step reasoning (from text content or thinking tokens). */
  reasoning: string;
  /** Ordered list of actions for the loop to execute. */
  actions: AgentAction[];
  /** True when a `finish` action is present. */
  done: boolean;
  /**
   * Raw tool calls in the same order as `actions`.
   * rawToolCalls[i] is the untyped source of actions[i].
   * Used to persist proper function_call / function_response history.
   */
  rawToolCalls: RawToolCall[];
}

/** Persisted agent state in chrome.storage.session. */
export interface AgentState {
  status: 'idle' | 'running' | 'done' | 'stopped' | 'error';
  tabId?: number;
  step: number;
  prompt?: string;
  sessionId?: number;
}

/** A stored chat session. */
export interface Session {
  id?: number;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/** Log entry stored in chrome.storage.session. */
export interface LogEntry {
  message: string;
  level: 'think' | 'act' | 'observe' | 'screenshot' | 'info' | 'ok' | 'warn' | 'error';
  ts: number;
}

/** A file attached to a chat prompt to be seeded into the VFS. */
export interface AttachedFile {
  name: string;
  mimeType: string;
  /** Base64-encoded data (no data-URL prefix). */
  data: string;
}

/** Messages flowing between popup / background / content. */
export type Message =
  | { type: 'START_AGENT'; tabId: number; prompt: string; sessionId?: number; attachments?: AttachedFile[]; modelId?: string }
  | { type: 'STOP_AGENT' }
  | { type: 'AGENT_LOG'; message: string; level: string }
  | { type: 'AGENT_STATE_CHANGE' }
  | { type: 'DRAW_MARKS' }
  | { type: 'DESTROY_MARKS' }
  | { type: 'BLOCK_INPUT' }
  | { type: 'UNBLOCK_INPUT' }
  | { type: 'PING' }
  | {
      type: 'GET_ELEMENT_DOM';
      /** CSS-pixel center X of the target element. */
      x: number;
      /** CSS-pixel center Y of the target element. */
      y: number;
    }
  | {
      type: 'ASK_USER';
      /** The question the agent wants to ask the user. */
      question: string;
    }
  | {
      type: 'USER_REPLY';
      /** The user's answer to the agent's question. */
      reply: string;
    }
  | {
      type: 'PLAY_SOUND';
      sound: 'finish' | 'ask';
    }
  | {
      type: 'UPLOAD_FILE';
      /** CSS-pixel center X of the target file input. */
      x: number;
      /** CSS-pixel center Y of the target file input. */
      y: number;
      fileName: string;
      mimeType: string;
      /** Base64-encoded file data (no data-URL prefix). */
      base64Data: string;
    };
