# Project: Opticlick Engine

## Overview
This project is a Manifest V3 (MV3) Chrome Extension that functions as an autonomous web agent. It uses the "Set-of-Mark" visual prompting technique and multimodal LLM models (Gemini 3.1 Flash Lite by default, or Ollama models) to navigate the web, analyze pages via screenshots, and execute actions by simulating hardware-level clicks via the Chrome DevTools Protocol.

## LLM & API Configuration
- **Model Selection:** Users can choose from Gemini/Gemma cloud models or locally-running Ollama models via the side panel dropdown:
  - Gemini 3.1 Flash Lite (default) — `gemini-3.1-flash-lite-preview`
  - Gemma 4 31B — `gemma-4-31b-it`
  - Any Ollama models detected at `http://localhost:11434` (shown under "Ollama (Local)" section; requires models that support tool calling)
- **Model Persistence:** Selected model is stored in `chrome.storage.local` and persists across sessions. Default is Gemini 3.1 Flash Lite.
- **Ollama Detection:** On extension load, the side panel queries `http://localhost:11434/api/tags` (3 s timeout) to discover local models. If Ollama models are found and no Gemini key is stored, the first Ollama model is auto-selected. Internal Ollama model IDs use an `ollama:<name>` prefix (`isOllamaModel`, `ollamaModelId`, `ollamaModelName` helpers in `src/utils/models.ts`).
- **Authentication:** A Gemini API key is required only when a Gemini model is selected. Ollama models run locally and require no API key. The background loop (`loop.ts`) and the side panel gate both check `isOllamaModel(modelId)` before enforcing the key requirement.
- **Multimodal Payload:** The LMM takes the user's prompt alongside a base64-encoded screenshot and returns a target ID in structured JSON.

## Architecture Constraints & Rules

### 1. Manifest V3 Strictness
- Use an ephemeral Background Service Worker.
- Required permissions: `activeTab`, `scripting`, `debugger`, `storage`.
- Content scripts must be injected across all frames using `"all_frames": true` to penetrate cross-origin iframes.

### 2. Content Script (Annotation & Blocking)
- **Identify Targets:** Find all interactables (semantic tags, ARIA roles, `cursor: pointer`). You must recursively pierce open Shadow DOMs to find deeply nested components.
- **Filter Occlusions:** Use `document.elementFromPoint` to verify z-indexes and stacking contexts. Filter out hidden/occluded elements.
- **Render Overlay:** Draw a unified HTML5 `<canvas>` over the page with numbered bounding boxes. Do NOT mutate the host page's DOM structure with thousands of divs.
- **Block User Interaction:** Intercept user inputs while the agent is running using capturing event listeners (e.g., `document.addEventListener('click', (e) => e.preventDefault(), {capture: true});`).
- **Cleanup:** Destroy the canvas overlay immediately after the background script captures the screenshot.

### 3. Background Service Worker (State & Orchestration)
- Orchestrate the Think-Act-Observe loop: command annotations -> capture tab -> command cleanup -> fetch Gemini/Ollama API -> execute click -> repeat.
- **State Management:** MV3 service workers terminate quickly. Maintain the execution state and coordinate mappings using `chrome.storage.session` (which survives service worker restarts). Use IndexedDB for long-term conversation history and large payloads.
- **Image Capture:** Use `chrome.tabs.captureVisibleTab` to generate base64 screenshots. Also auto-save each step's annotated screenshot to VFS as `step_N.png`.
- **Conversation History:** Each turn is stored in IndexedDB with role (`user`/`model`/`tool`) and metadata. Model turns include `toolCalls: { id, name, args }[]` for function-call history reconstruction. Tool result turns include `toolCallId` and `toolName` to form valid Gemini/LangChain function-response pairs. This ensures the LLM can properly track which tool call produced which result.
- **URL Anchoring:** On loop start, the active tab's URL is captured and injected into every LLM prompt as `[CONTEXT: The task started on <url>. If you are on an unrelated page, navigate back.]` to help the agent stay task-focused and recover from navigation errors.

### 4. Execution Engine (Hardware-Level Simulation)
- **No Synthetic Events:** NEVER use standard `.click()` DOM events, as they will fail on modern SPAs (React/Vue/Angular).
- **Chrome Debugger API:** Use `chrome.debugger` to send `Input.dispatchMouseEvent` sequences (`mouseMoved`, `mousePressed`, `mouseReleased`) to simulate true hardware interrupts.
- **Coordinate Scaling:** **CRITICAL:** You must mathematically scale the LMM's target coordinates down by dividing them by `window.devicePixelRatio` before dispatching the CDP commands, otherwise clicks will miss on high-DPI/Retina displays.

### 5. Agent Tools
Tools are categorized into UI actions, DOM inspection, VFS mutations, memory, scratchpad, todo, and control.

#### UI Actions (at most ONE per turn)
- **`click`** — Hardware-level click on an annotated element by numeric ID. Supports:
  - `modifier` key: `ctrl` (Ctrl+Click, open in new tab), `meta` (Cmd on macOS or Win on Windows), `shift` (multi-select), `alt`.
  - `uploadFileId` (VFS file UUID) — instead of opening the OS file picker, injects the file contents into a `<input type="file">` element via Chrome Debugger Protocol.
- **`type`** — Types text into the currently focused element (after a prior click). Optional `clearField: true` performs Ctrl+A-replace instead of appending.
- **`navigate`** — Loads a full HTTP/HTTPS URL in the current tab.
- **`scroll`** — Mouse-wheel scroll in a direction (up/down/left/right). Optional `scrollTargetId` scrolls inside a specific element instead of the page.
- **`press_key`** — Dispatches a raw keyboard event (e.g., Enter, Escape, Tab, ArrowDown) without a prior click.

#### DOM Inspection
- **`fetch_dom`** — Requests the full `outerHTML` of an annotated element by numeric ID. Useful when the screenshot lacks detail (hidden attributes, link hrefs, table contents, clipped text). Returns up to 40 KB of HTML injected into the next conversation turn.

#### VFS Operations (executed BEFORE any UI action)
- **`vfs_save_screenshot`** — Persists the current step's annotated screenshot to VFS under a given filename.
- **`vfs_write`** — Creates or overwrites a file in VFS with optional MIME type (defaults to `text/plain`).
- **`vfs_delete`** — Removes a VFS file by its UUID.
- **`vfs_download`** — Fetches a remote HTTP/HTTPS URL directly into VFS, bypassing the browser's download dialog and OS file picker.

#### Memory Management (cross-session persistence)
- **`memory_upsert`** — Saves or merges a fact into long-term IndexedDB memory with fields: `key` (namespaced, e.g., `github/username`), `values[]`, `category` (account/preference/fact/other), optional `sourceUrl`. Values are deduplicated on merge.
- **`memory_delete`** — Removes a memory entry by key.

#### Scratchpad (in-session only, cleared at session end)
- **`note_write`** — Writes/updates a keyed note in the in-session scratchpad (VFS-backed as `__scratchpad.json`). Use for accumulating partial findings during a task.
- **`note_delete`** — Removes a scratchpad note by key.

#### Todo Management
- **`todo_create`** — Creates or fully replaces the session task plan on the first step (mandatory). Items have `id` (kebab-case), `title`, `status` (pending/in_progress/done/skipped), optional `notes`.
- **`todo_update`** — Applies partial updates to existing items. Called every turn to track progress.
- **`todo_add`** — Appends new tasks discovered mid-execution. Silently ignores duplicate IDs.

#### Control
- **`wait`** — Pauses execution for 100–10,000 ms to allow pages to load, animations to complete, or background requests to settle.
- **`ask_user`** — Pauses the agent and displays a clarification question to the user. The agent resumes automatically when the user replies. Use only for ambiguous goals, missing critical information, or decisions requiring human judgment. Ask one question at a time; do not re-ask the same question.
- **`finish`** — Declares the task complete. The `summary` field is the full final answer shown to the user.

#### Action Constraints
- **Separate Click and Type:** Click and type are separate actions. Click focuses an element; type enters text into the focused element. This separation enables loop detection, granular error handling, and clearer debugging.
- **One UI Action Per Turn:** At most one of `click`, `type`, `navigate`, `scroll`, `press_key` per turn. Combine freely with VFS, todo, DOM, memory, or scratchpad actions.
- **Typical Workflow:** Click (focus) → Type (enter text) → Press_key (submit)
- **Anti-Loop Rules:** The system tracks action history and uses `shouldPivot()` to detect repeated identical actions (3+ identical click/scroll pairs). When detected, the agent must switch strategies: navigate to a reconstructed URL, try a different interaction path, or ask the user for clarification.

### 6. Persistent Memory
- **Purpose:** Cross-session memory that lets the agent remember facts about the user (accounts, preferences, display names, etc.) across sessions.
- **Storage:** IndexedDB `memory` object store (`DB_VERSION = 4`). Each entry is a `MemoryEntry` with `key` (namespaced, e.g. `"github/username"`), `values` (string array for multi-account support), `category`, optional `sourceUrl`, and timestamps.
- **Agent Tools:** `memory_upsert` (save/merge values) and `memory_delete` (remove entry). Defined in `src/utils/tools/memory.ts`.
- **Context Injection:** All memory entries are loaded at loop start (`getAllMemories()`) and injected into every LLM prompt as a `── Long-term Memory ──` context block via `formatMemoryForPrompt()` in `src/utils/memory.ts`.
- **Upsert Semantics:** When the agent calls `memory_upsert` with an existing key, new values are merged and deduplicated into the existing array. This naturally handles multi-account discovery.
- **Module layout:** DB CRUD in `src/utils/db.ts`, formatting in `src/utils/memory.ts`, tool schemas in `src/utils/tools/memory.ts`, action handling in `src/entrypoints/background/loop.ts`.
- **Security Rule:** The LLM is instructed to NEVER store passwords, tokens, or API keys in memory.

### 7. In-Session Scratchpad Memory
- **Purpose:** Short-term memory for accumulating intermediate findings (e.g. issues extracted across multiple pages) during a single thread/session. Does NOT persist across sessions.
- **Storage:** Synced to VFS as `__scratchpad.json` to survive service worker restarts. Cleared automatically on session completion.
- **Agent Tools:** `note_write` (save/update note) and `note_delete` (remove note). Defined in `src/utils/tools/scratchpad.ts`.
- **Context Injection:** Injected into every LLM prompt as a `── Scratchpad ──` block via `formatScratchpadForPrompt()` in `src/utils/scratchpad.ts`.

### 8. File Upload Handling
- **File Chooser Suppression:** The background loop uses Chrome Debugger Protocol (`Page.setInterceptFileChooserDialog`) combined with JS-level overrides of `HTMLInputElement.prototype.click` and `window.showOpenFilePicker` to suppress any OS file picker dialogs.
- **VFS File Injection:** When the agent calls `click` with an `uploadFileId` parameter (a VFS file UUID), the loop uses `DOM.setFileInputFiles` to inject the file contents directly into the `<input type="file">` element. This bypasses the native file picker entirely.
- **Fallback:** For pages that require actual file operations, the agent can use `vfs_download` to fetch remote files into VFS, then reference them by filename or UUID in click actions.

### 9. Attachment Handling (User-Provided Files and Images)
- **Attachment Flow:** User-attached files arrive in the `START_AGENT` message as `AttachedFile[]` with fields `name`, `mimeType`, and base64-encoded `data`.
- **VFS Seeding:** All attachments are immediately saved to the session's VFS via `saveVFSFile()`, making them accessible by filename or UUID throughout the session.
- **Image Injection:** On step 1 only, image attachments (those whose `mimeType` starts with `image/`) are extracted and injected into the LLM prompt as inline multimodal content:
  - **Gemini format:** `{ type: 'image', url: 'data:image/png;base64,<data>' }`
  - **Ollama format:** `{ type: 'image_url', image_url: { url: 'data:...' } }`
- **Non-Image Attachments:** PDFs, CSVs, or other files are persisted in VFS and accessible to the agent via the VFS context block. The agent can reference them by filename or UUID in tool calls (e.g., `click` with `uploadFileId`), or use `vfs_download` semantics if needed.

## Development Workflow
- Follow standard asynchronous ES6 conventions.
- Manage message passing strictly with Promises using `chrome.runtime.sendMessage` and `chrome.tabs.sendMessage` to prevent race conditions during the task loop.
- Validate DOM stability (e.g., using `MutationObserver` to wait for network/DOM idle) before commanding the annotation engine to draw marks.

## Testing Requirements
- **Always run tests after making changes.** After completing any code modification, run the relevant test suite before considering the task done.
- Run unit tests with `npm test` and E2E tests with `npm run test:e2e` (or the equivalent commands in the project).
- If tests fail, fix the failures before finishing — do not leave the codebase in a broken state.
- **Write tests for every feature or bug fix.** New tools, actions, or pure utility functions must have corresponding unit tests. Integration or DOM tests are required when the change touches Chrome API wiring, content scripts, or the agent loop.
- When adding new functionality, verify that existing tests still pass and that new behavior is covered by tests.
- Test files live under `tests/unit/` (pure logic), `tests/integration/` (Chrome API stubs), or `tests/dom/` (jsdom). Match the file naming convention of existing tests (e.g. `tools-parseToolCall.test.ts`, `todo-pure.test.ts`).

## Keeping CLAUDE.md Up to Date

### When to update
- After adding a new module, script, or architectural component to the extension.
- After changing an API endpoint, LLM model, authentication method, or key configuration value.
- After establishing a new architectural constraint or pattern that future changes must follow.
- After deprecating or removing a rule that no longer applies.

### What to update
- **Overview:** Update if the extension's core purpose, technique, or primary model changes.
- **LLM & API Configuration:** Update the model ID, endpoint, or auth strategy whenever they change.
- **Architecture Constraints & Rules:** Add, modify, or remove numbered rules to reflect the current design decisions (e.g., new content script behaviour, new storage strategy, new CDP commands).
- **Development Workflow / Testing Requirements:** Update if the test commands, tooling, or workflow steps change.

### How to update
1. Edit this file directly in the same commit/PR as the code change it describes.
2. Be concise and prescriptive — write rules, not prose. Future agents must be able to follow them unambiguously.
3. Remove outdated rules entirely rather than leaving stale guidance alongside new guidance.
4. If a rule has important nuance or a known exception, capture it inline with a brief note (e.g., `**CRITICAL:**`, `**NOTE:**`).