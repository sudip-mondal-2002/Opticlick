# Opticlick Engine

An autonomous web agent Chrome extension that uses the **Set-of-Mark** visual prompting technique and multimodal LLMs to navigate the web, analyze pages via screenshots, and execute actions via hardware-level simulation through the Chrome DevTools Protocol.

---

## Table of Contents

1. [Overview](#overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Extension Components](#extension-components)
   - [Background Service Worker](#background-service-worker)
   - [Content Script](#content-script)
   - [Side Panel UI](#side-panel-ui)
4. [The Agent Graph](#the-agent-graph)
   - [Graph Nodes](#graph-nodes)
   - [Control Flow](#control-flow)
5. [LLM Integration](#llm-integration)
   - [Models](#models)
   - [Context Assembly](#context-assembly)
   - [Streaming & Parsing](#streaming--parsing)
6. [Agent Tools](#agent-tools)
7. [Set-of-Mark Annotation](#set-of-mark-annotation)
   - [Element Discovery](#element-discovery)
   - [Canvas Overlay](#canvas-overlay)
8. [Hardware Input Simulation](#hardware-input-simulation)
9. [Persistence & State](#persistence--state)
   - [IndexedDB Schema](#indexeddb-schema)
   - [Virtual File System (VFS)](#virtual-file-system-vfs)
   - [Long-term Memory](#long-term-memory)
   - [In-Session Scratchpad](#in-session-scratchpad)
   - [Task Todo List](#task-todo-list)
10. [Screenshot Capture](#screenshot-capture)
11. [File Handling](#file-handling)
12. [Safety & Loop Detection](#safety--loop-detection)
13. [Directory Structure](#directory-structure)
14. [Development](#development)

---

## Overview

Opticlick is a Manifest V3 Chrome Extension that acts as a fully autonomous web agent. Given a natural-language task, the agent:

1. Annotates the live page with numbered bounding boxes (Set-of-Mark)
2. Takes a screenshot of the annotated page
3. Sends the screenshot + task context to an LLM
4. Parses the LLM's structured tool-call response
5. Executes the chosen action via CDP hardware simulation
6. Repeats until the task is complete

The agent supports **Gemini** cloud models (including extended thinking) and locally-running **Ollama** models.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                         │
│                                                                 │
│  ┌──────────────┐     messages      ┌──────────────────────────┐│
│  │  Side Panel  │ ◄──────────────── │  Background Service      ││
│  │  (React UI)  │ ─────────────── ► │  Worker (Orchestrator)   ││
│  └──────────────┘                   └──────────┬───────────────┘│
│                                                │                │
│                         ┌──────────────────────┤                │
│                         │  chrome.tabs.sendMessage              │
│                         ▼                      │                │
│                ┌─────────────────┐             │                │
│                │ Content Script  │             │ CDP            │
│                │ (All Frames)    │             │ Input.dispatch │
│                │                 │             │ MouseEvent     │
│                │ - Annotate DOM  │             │                │
│                │ - Block input   │             ▼                │
│                │ - Shadow DOM    │   ┌──────────────────┐       │
│                └─────────────────┘   │  Active Web Tab  │       │
│                                      └──────────────────┘       │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                     IndexedDB                              │ │
│  │  sessions | conversations | VFS | memory                   │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
                   ┌─────────────────────┐
                   │  LLM APIs           │
                   │  Gemini (Google AI) │
                   │  Ollama (localhost) │
                   └─────────────────────┘
```

---

## Extension Components

### Background Service Worker

**Entry:** [src/entrypoints/background.ts](src/entrypoints/background.ts)

The MV3 service worker is the orchestration hub. It:

- Listens for `START_AGENT` and `STOP_AGENT` messages from the side panel
- Intercepts `chrome.downloads` events during active sessions, routing files into VFS instead of the Downloads folder
- Manages the side panel lifecycle (`chrome.sidePanel.open`)
- Delegates agent execution to `runAgentLoop()` in [src/entrypoints/background/loop.ts](src/entrypoints/background/loop.ts)

The loop sets up the full session context before handing off to the LangGraph state machine:

```
runAgentLoop(tabId, userPrompt, sessionId?, attachments?, modelId?)
  ├─ Create / resume session in IndexedDB
  ├─ Seed VFS with user-attached files
  ├─ Load persisted todo / memory / scratchpad
  ├─ Create LLM model instance
  ├─ Navigate away from restricted pages (chrome://, etc.)
  ├─ Inject content script + block user input
  ├─ Attach Chrome Debugger (CDP)
  ├─ Install file-chooser intercept guard
  ├─ Build LangGraph and stream to completion
  └─ Finally: unblock input, detach debugger, clear temp VFS files
```

State that must survive service-worker restarts (MV3 workers are ephemeral) is persisted either in `chrome.storage.session` (transient agent status, log entries) or IndexedDB (conversation history, VFS, memory).

---

### Content Script

**Entry:** [src/entrypoints/content.ts](src/entrypoints/content.ts)

Injected into every frame (`all_frames: true`) on every URL. Handles messages from the background:

| Message | Handler |
|---|---|
| `DRAW_MARKS` | Annotate interactables, return coordinate map |
| `DESTROY_MARKS` | Remove canvas overlay |
| `BLOCK_INPUT` | Install capturing event listeners to prevent user clicks |
| `UNBLOCK_INPUT` | Remove input blockers |
| `GET_ELEMENT_DOM` | Return `outerHTML` of element at given coordinates |
| `UPLOAD_FILE` | Inject file into `<input type="file">` via CDP |
| `PING` | Confirm content script is alive |

The annotation and visibility logic lives in [src/entrypoints/content/](src/entrypoints/content/):

- [overlay.ts](src/entrypoints/content/overlay.ts) — Discovers elements, renders canvas, returns coordinate map
- [interactables.ts](src/entrypoints/content/interactables.ts) — Classifies elements as interactive (tags, ARIA roles, tabindex, cursor, event listeners)
- [visibility.ts](src/entrypoints/content/visibility.ts) — Computes visible rects and checks for occlusion
- [blocker.ts](src/entrypoints/content/blocker.ts) — Installs/removes capturing event listeners
- [theme.ts](src/entrypoints/content/theme.ts) — Detects dark/light mode for annotation colors

---

### Side Panel UI

**Entry:** [src/entrypoints/sidepanel/App.tsx](src/entrypoints/sidepanel/App.tsx)

A React application rendered in Chrome's native side panel. Provides:

- **API key setup** — First-run Gemini key entry
- **Model selection** — Dropdown populated with Gemini models + auto-detected Ollama models
- **Chat interface** — Task prompt input with file attachment support
- **Live agent stream** — Real-time logs, thinking tokens, step progress
- **Session history** — Past sessions with conversation replay

The side panel communicates bidirectionally with the background via `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`.

---

## The Agent Graph

The agent loop is implemented as a **LangGraph state machine** defined in [src/entrypoints/background/agent-graph.ts](src/entrypoints/background/agent-graph.ts).

### Graph Nodes

```
                    ┌──────────┐
                    │ stepSetup│ ◄─────────────────────────────┐
                    └────┬─────┘                               │
                         │                                     │
                    ┌────▼──────────────┐                      │
                    │ drawAnnotations   │                      │
                    └────┬──────────────┘                      │
                         │                                     │
                    ┌────▼──────────────┐                      │
                    │ captureAndDestroy │                      │
                    └────┬──────────────┘                      │
                         │                                     │
                    ┌────▼──────┐                              │
                    │  reason   │ (LLM call)                   │
                    └────┬──────┘                              │
                         │                                     │
                    ┌────▼──────────┐                          │
                    │  sideEffects  │ (non-UI actions)         │
                    └────┬──────────┘                          │
                         │                                     │
           ┌─────────────┼──────────────┐                      │
           │             │              │                      │
    ┌──────▼────┐  ┌─────▼───-─┐  ┌──-──▼─────┐                │
    │ uiAction  │  │ awaitUser │  │ complete  │                │
    └──────┬────┘  └──────┬────┘  └───────────┘                │
           │              │                                    │
           └──────────────┴────────────────────────────────────┘
```

### Graph Nodes

| Node | File | Responsibility |
|---|---|---|
| `stepSetup` | [nodes/setup.ts](src/entrypoints/background/nodes/setup.ts) | Check stop flag, increment step counter, re-attach debugger, wait for DOM idle |
| `drawAnnotations` | [nodes/setup.ts](src/entrypoints/background/nodes/setup.ts) | Send `DRAW_MARKS` to content script, retry with backoff if zero elements found, return coordinate map |
| `captureAndDestroy` | [nodes/observe.ts](src/entrypoints/background/nodes/observe.ts) | Capture annotated screenshot via CDP, save to VFS as `step_N.png`, destroy overlay |
| `reason` | [nodes/observe.ts](src/entrypoints/background/nodes/observe.ts) | Assemble LLM context (system prompt + history + screenshot), call model, persist turns to IndexedDB |
| `sideEffects` | [nodes/side-effects.ts](src/entrypoints/background/nodes/side-effects.ts) | Execute all non-UI actions in order: VFS ops, todo updates, memory, scratchpad, DOM inspection, wait, ask_user setup, finish acknowledgement |
| `uiAction` | [nodes/ui-action.ts](src/entrypoints/background/nodes/ui-action.ts) | Dispatch the single UI action (click / type / navigate / scroll / press_key); update `tabIdRef` if a new tab opened |
| `awaitUser` | [nodes/control.ts](src/entrypoints/background/nodes/control.ts) | Suspend execution; the loop resumes when the user replies |
| `complete` | [nodes/control.ts](src/entrypoints/background/nodes/control.ts) | Log completion, clear session VFS (preserving todo/scratchpad), broadcast finish to side panel |

### Control Flow

After `sideEffects`, the router checks `AgentState` to choose the next node:

- `ask_user` tool called → `awaitUser`
- `finish` tool called → `complete`
- UI action present → `uiAction` → back to `stepSetup`
- No UI action → back to `stepSetup` (sideEffects-only turn)

The loop continues until `complete` is reached, the stop flag is set (`chrome.storage.session`), or the step counter exceeds `MAX_STEPS` (500).

---

## LLM Integration

### Models

**[src/utils/llm.ts](src/utils/llm.ts)** provides a unified model factory:

| Model | Class | Notes |
|---|---|---|
| `gemini-3.1-flash-lite-preview` (default) | `ChatGoogleGenerativeAI` | Cloud, requires API key |
| `gemma-4-31b-it` | `ChatGoogleGenerativeAI` | Cloud, requires API key |
| `ollama:<name>` | `ChatOllama` | Local, `http://localhost:11434`, no key needed |

Gemini models are configured with `thinkingConfig: { thinkingLevel: 'HIGH' }` to enable extended reasoning. All models use `temperature: 0.1` for deterministic outputs.

Model selection and API keys are persisted in `chrome.storage.local`. On extension load, the side panel queries Ollama at `http://localhost:11434/api/tags` (3 s timeout) to auto-populate local models.

### Context Assembly

Each LLM call is built by **[src/utils/prompt.ts](src/utils/prompt.ts)**:

```
SystemMessage(SYSTEM_INSTRUCTIONS)          ← ~260-line cognitive framework
  + buildHistory(indexedDB turns)           ← Full conversation so far
  + HumanMessage:
      Task: {userPrompt}                    ← Original user request
      [CONTEXT: started on <url>]           ← URL anchor for navigation recovery
      VFS: {file listings}                  ← Available files
      Todo: {status icon per task}          ← Current plan
      Memory: {grouped by category}         ← Cross-session facts
      Scratchpad: {working notes}           ← In-session state
      CoordinateMap: {id → tag/text/rect}   ← Interactable elements on page
      Screenshot (base64 inline image)      ← Annotated page view
```

History is reconstructed from IndexedDB conversation turns into LangChain message types (`HumanMessage`, `AIMessage`, `ToolMessage`) with proper `tool_call_id` chaining so the LLM can track which tool call produced which result.

### Streaming & Parsing

**[src/utils/llm-stream.ts](src/utils/llm-stream.ts)** streams the model response:

1. Accumulates thinking/reasoning tokens and broadcasts `AGENT_THINKING_DELTA` messages to the side panel in real time
2. Parses `tool_calls` array from the stream into typed `AgentAction` objects via `parseToolCall()`
3. Returns `{ reasoning, thinking, actions, done, rawToolCalls }` to the `reason` node

The raw LangChain tool call objects are stored alongside the AI turn in IndexedDB so that `buildHistory()` can reconstruct valid `ToolMessage` pairs in subsequent turns.

---

## Agent Tools

Tools are defined per-category in [src/utils/tools/](src/utils/tools/) as LangChain tool objects with Zod schemas, and aggregated in [src/utils/tools/index.ts](src/utils/tools/index.ts).

### UI Actions (at most one per turn)

| Tool | Description |
|---|---|
| `click` | Hardware click on an annotated element by ID. Supports `modifier` keys and `uploadFileId` for file injection |
| `type` | Type text into the focused element. `clearField: true` selects all before typing |
| `navigate` | Load a full URL in the current tab |
| `scroll` | Wheel-scroll the page or a specific element in a direction |
| `press_key` | Dispatch a raw key event (Enter, Escape, Tab, ArrowDown, etc.) |

### DOM Inspection

| Tool | Description |
|---|---|
| `fetch_dom` | Return up to 40 KB of `outerHTML` for an element by ID — used when the screenshot lacks detail |

### VFS Operations (any number per turn, executed before UI actions)

| Tool | Description |
|---|---|
| `vfs_save_screenshot` | Save the current step's screenshot to VFS under a given filename |
| `vfs_write` | Create or overwrite a VFS file with given content and MIME type |
| `vfs_delete` | Remove a VFS file by UUID |
| `vfs_download` | Fetch a remote URL directly into VFS, bypassing the OS download dialog |

### Memory

| Tool | Description |
|---|---|
| `memory_upsert` | Save or merge a fact into long-term IndexedDB memory (`key`, `values[]`, `category`) |
| `memory_delete` | Remove a memory entry by key |

### Scratchpad

| Tool | Description |
|---|---|
| `note_write` | Write or update a keyed note in the in-session scratchpad |
| `note_delete` | Remove a scratchpad note by key |

### Todo

| Tool | Description |
|---|---|
| `todo_create` | Create the full task plan (mandatory on turn 1) |
| `todo_update` | Apply partial status/notes updates to existing items |
| `todo_add` | Append new tasks discovered mid-execution |

### Control

| Tool | Description |
|---|---|
| `wait` | Pause for 100–10,000 ms |
| `ask_user` | Pause and display a clarification question; resume on user reply |
| `finish` | Declare task complete; `summary` is shown to the user |

---

## Set-of-Mark Annotation

### Element Discovery

**[src/entrypoints/content/interactables.ts](src/entrypoints/content/interactables.ts)** classifies elements as interactive if they match any of:

- Semantic HTML tags: `a`, `button`, `input`, `select`, `textarea`, `label`, `summary`, `details`
- ARIA roles: `button`, `link`, `menuitem`, `tab`, `checkbox`, `radio`, `combobox`, `listbox`, `option`, `switch`, `treeitem`
- Non-negative `tabindex`
- Computed style `cursor: pointer`
- Direct `onclick` attribute

**[src/entrypoints/content/overlay.ts](src/entrypoints/content/overlay.ts)** walks the full DOM with `TreeWalker` and **recursively pierces open Shadow DOMs** to discover components inside web components and custom elements.

### Canvas Overlay

Once elements are collected:

1. Each element's bounding box is computed and clipped to the visible viewport via `getVisibleRect()`
2. Occluded elements (covered by overlays, modals, or higher z-index siblings) are filtered out using `document.elementFromPoint()`
3. A single fixed-position `<canvas>` (z-index: max) is created — no DOM mutation with thousands of divs
4. Each visible element gets a **numbered bounding box** (blue rectangle) and a **badge with its numeric ID**
5. The coordinate map `CoordinateEntry[]` is returned to the background for inclusion in the LLM prompt

The LLM sees both the annotated screenshot (visual) and the coordinate map (structured metadata) and responds with the numeric ID of the element to interact with.

---

## Hardware Input Simulation

**[src/utils/cdp/input.ts](src/utils/cdp/input.ts)** dispatches true hardware-level events via Chrome DevTools Protocol — never synthetic DOM events — which is essential for modern SPAs (React/Vue/Angular) that check `isTrusted`.

### Click Sequence

```
Input.dispatchMouseEvent (mouseMoved   → center of element)
Input.dispatchMouseEvent (mousePressed → button: left)
Input.dispatchMouseEvent (mouseReleased)
```

**Critical:** Coordinates from the LLM are in CSS pixels at the current device pixel ratio. Before dispatching CDP commands, coordinates are divided by `window.devicePixelRatio` to correct for high-DPI / Retina displays.

Modifier keys (`ctrl`, `meta`, `shift`, `alt`) are passed through the CDP `modifiers` bitmask, enabling Ctrl+Click to open links in a new tab.

### Text Input

Text is typed character-by-character via `Runtime.evaluate` using `Input.insertText` (or `Input.dispatchKeyEvent` for special characters). `clearField: true` first dispatches `Ctrl+A` to select all existing content before typing.

### Scroll

`Input.dispatchScrollEvent` with delta vectors, optionally targeted to a specific element's center coordinates.

---

## Persistence & State

### IndexedDB Schema

Opened via [src/utils/db/core.ts](src/utils/db/core.ts) with `DB_VERSION = 4`:

| Object Store | Key | Content |
|---|---|---|
| `sessions` | `id` (UUID) | Session metadata: title, URL, model, timestamps |
| `conversations` | `id` (UUID) | Turns: role, content, toolCalls, toolCallId, toolName, sessionId |
| `VFS_STORE` | `id` (UUID) | Files: name, mimeType, base64 data, sessionId, timestamps |
| `memory` | `id` (UUID) | Memory entries: key, values[], category, sourceUrl, timestamps |

### Virtual File System (VFS)

**[src/utils/db/vfs.ts](src/utils/db/vfs.ts)** — An IndexedDB-backed virtual filesystem scoped to each session.

Files are identified by UUID and looked up by name within a session. Key reserved filenames:

| File | Purpose |
|---|---|
| `step_N.png` | Annotated screenshot for step N |
| `__todo.json` | Persisted task list (excluded from cleanup) |
| `__scratchpad.json` | Session working notes (excluded from cleanup) |

The VFS provides the agent with a persistent workspace for: user-attached files, downloaded resources, extracted data, and intermediate outputs — all accessible across service-worker restarts.

**Download interception** in `background.ts` hooks `chrome.downloads.onCreated`: when a download is triggered during an active session, the download is cancelled and the file content is fetched and stored in VFS instead.

### Long-term Memory

**[src/utils/db/memory.ts](src/utils/db/memory.ts)** — Cross-session persistence in the `memory` object store.

```typescript
interface MemoryEntry {
  key: string;        // Namespaced, e.g. "github/username" or "amazon/default_address"
  values: string[];   // Array for multi-account support
  category: string;   // "account" | "preference" | "fact" | "other"
  sourceUrl?: string;
}
```

`memory_upsert` merges new values into the existing array (deduplicated), so the agent naturally accumulates multiple accounts or addresses under one key.

All entries are injected into every LLM prompt via `formatMemoryForPrompt()` in [src/utils/memory.ts](src/utils/memory.ts) as a `── Long-term Memory ──` context block grouped by category.

**Security constraint:** The system prompt and tool schema explicitly prohibit storing passwords, tokens, API keys, full card numbers, or SSNs.

### In-Session Scratchpad

**[src/utils/scratchpad.ts](src/utils/scratchpad.ts)** — Short-term working memory for accumulating intermediate findings (extracted prices, issue lists, form values, API responses) during a single task.

Backed by `__scratchpad.json` in VFS so it survives service-worker restarts. Cleared automatically when the session completes.

Injected into every LLM prompt as a `── Scratchpad ──` context block.

### Task Todo List

**[src/utils/todo.ts](src/utils/todo.ts)** — A structured task decomposition persisted as `__todo.json` in VFS.

```typescript
interface TodoItem {
  id: string;       // Kebab-case identifier
  title: string;
  status: 'pending' | 'in_progress' | 'done' | 'skipped';
  notes?: string;
}
```

The agent **must** call `todo_create` on turn 1 with the full decomposed plan, then call `todo_update` every turn to mark progress. This gives the LLM a persistent view of what remains, preventing goal drift across many steps.

---

## Screenshot Capture

**[src/utils/screenshot.ts](src/utils/screenshot.ts)** uses a two-strategy approach:

```
Strategy 1: CDP compositor (no flicker)
  chrome.debugger → Page.captureScreenshot({ fromSurface: true })
  └─ Accept if image size >= 6 KB (valid frame)

Strategy 2: Fallback (may briefly activate tab)
  chrome.tabs.update({ active: true })
  chrome.tabs.captureVisibleTab()
  Restore previously-active tab

Retry up to 3× with backoff: 300 ms → 800 ms → 1500 ms
```

Using `fromSurface: true` reads from the GPU compositor buffer, producing a screenshot without flickering the visible tab — critical for non-disruptive background operation.

---

## File Handling

### User Attachments

Files attached in the side panel arrive in the `START_AGENT` message as `AttachedFile[]` with `name`, `mimeType`, and base64 `data`. They are immediately seeded into the session's VFS.

On step 1 only, **image attachments** are also injected into the LLM prompt as inline multimodal content so the agent can see what the user uploaded.

### File Upload Injection

When the agent calls `click` with an `uploadFileId` parameter, the flow is:

1. Background retrieves the file from VFS by UUID
2. Writes it to a temporary disk path via CDP `IO` domain
3. Uses `DOM.setFileInputFiles` to inject the file path directly into the `<input type="file">` element
4. The OS file picker never opens

A preemptive guard is also installed via `Page.setInterceptFileChooserDialog` + JS-level overrides of `HTMLInputElement.prototype.click` and `window.showOpenFilePicker` to suppress any unexpected file dialogs.

---

## Safety & Loop Detection

**[src/utils/navigation-guard.ts](src/utils/navigation-guard.ts)** tracks the action history per session. If the same click or scroll action appears 3+ times consecutively (`shouldPivot()`), the agent is flagged to change strategy rather than repeat the same failing action.

The system prompt includes explicit guidance for these situations:

- Try a different element or interaction path
- Navigate to a reconstructed URL directly
- Call `ask_user` if the ambiguity requires human judgment

The agent is also constrained to **one UI action per turn**, which makes each step individually auditable and provides a clear retry boundary.

---

## Development

### Prerequisites

- Node.js 20+
- A Gemini API key (for cloud models) **or** Ollama running locally

### Build & Run

```bash
npm install

# Development (hot reload)
npm run dev

# Production build
npm run build

# Package for submission
npm run zip
```

Load the unpacked extension from `.output/chrome-mv3/` in `chrome://extensions` with Developer Mode enabled.

### Testing

```bash
# Unit + integration + DOM + e2e tests 
npm test

# Lint
npm run lint
npm run lint:fix
```

Tests are organized under `tests/`:

- `tests/unit/` — Pure logic: tool parsing, todo mutations, scratchpad, memory formatting, navigation guard
- `tests/integration/` — Chrome API stubs: CDP input, screenshots, IndexedDB, agent state
- `tests/dom/` — jsdom: element discovery, visibility, occlusion detection
- `tests/e2e/` — Real Chromium: full agent loop

### Environment Variables

Optional LangSmith tracing (for debugging LLM calls):

```
VITE_LANGSMITH_TRACING=true
VITE_LANGSMITH_ENDPOINT=https://api.smith.langchain.com
VITE_LANGSMITH_API_KEY=<your key>
VITE_LANGSMITH_PROJECT=opticlick
```
