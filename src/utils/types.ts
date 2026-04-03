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

/** A text file Gemini wants to write into the VFS. */
export interface VFSWriteOp {
  /** Filename including extension (e.g. "notes.txt", "data.json"). */
  name: string;
  /** UTF-8 text content to store. */
  content: string;
  /** MIME type — defaults to "text/plain" if omitted. */
  mimeType?: string;
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
  /** VFS file ID to upload to the targeted file input element. */
  uploadFileId?: string;

  // ── VFS mutations (executed before any UI action this turn) ──────────────
  /** Save the current step screenshot to the VFS under this filename. */
  vfsSaveScreenshot?: string;
  /** Write (create or overwrite) a text file in the VFS. */
  vfsWrite?: VFSWriteOp;
  /** Delete a VFS file by its ID. */
  vfsDelete?: string;
  /**
   * Download a file from a URL and store it in the VFS.
   * The service worker fetches the URL directly — no browser download dialog.
   */
  vfsDownload?: {
    url: string;
    /** Optional filename override. Defaults to the filename derived from the URL or Content-Disposition header. */
    name?: string;
  };
  /**
   * Ask the extension to return the outer HTML of an annotated element.
   * The result is injected into conversation history so Gemini can read
   * link hrefs, table rows, form fields, etc. on the next step.
   */
  fetchDOM?: number;

  // ── Todo list management ─────────────────────────────────────────────────
  /**
   * Create (or fully replace) the session todo list.
   * MUST be set on step 1 when no todo list exists yet.
   * Set the first item you are about to work on to "in_progress"; all others "pending".
   */
  todoCreate?: TodoItem[];
  /**
   * Apply partial updates to existing todo items.
   * Combine with any UI action — e.g. mark previous item "done" and next "in_progress".
   */
  todoUpdate?: TodoUpdate[];
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
  | { type: 'START_AGENT'; tabId: number; prompt: string; sessionId?: number; attachments?: AttachedFile[] }
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
