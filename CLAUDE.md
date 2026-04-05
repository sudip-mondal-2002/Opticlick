# Project: Opticlick Engine

## Overview
This project is a Manifest V3 (MV3) Chrome Extension that functions as an autonomous web agent. It uses the "Set-of-Mark" visual prompting technique and the Gemini 3.1 Pro model to navigate the web, analyze pages via screenshots, and execute actions by simulating hardware-level clicks via the Chrome DevTools Protocol.

## LLM & API Configuration
- **Model Selection:** Users can choose from Gemini/Gemma cloud models or locally-running Ollama models via the side panel dropdown:
  - Gemini 3.1 Flash Lite (default) — `gemini-3.1-flash-lite-preview`
  - Gemma 4 31B — `gemini-4-31b`
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
- Orchestrate the Think-Act-Observe loop: command annotations -> capture tab -> command cleanup -> fetch Gemini API -> execute click -> repeat.
- **State Management:** MV3 service workers terminate quickly. Maintain the execution state and coordinate mappings using `chrome.storage.session` (which survives service worker restarts). Use IndexedDB for long-term conversation history and large payloads.
- **Image Capture:** Use `chrome.tabs.captureVisibleTab` to generate base64 screenshots.

### 4. Execution Engine (Hardware-Level Simulation)
- **No Synthetic Events:** NEVER use standard `.click()` DOM events, as they will fail on modern SPAs (React/Vue/Angular).
- **Chrome Debugger API:** Use `chrome.debugger` to send `Input.dispatchMouseEvent` sequences (`mouseMoved`, `mousePressed`, `mouseReleased`) to simulate true hardware interrupts.
- **Coordinate Scaling:** **CRITICAL:** You must mathematically scale the LMM's target coordinates down by dividing them by `window.devicePixelRatio` before dispatching the CDP commands, otherwise clicks will miss on high-DPI/Retina displays.

### 5. Agent Tools (UI Actions)
- **Separate Click and Type Tools:** Click and type are now separate actions. Click focuses an element; type enters text into the focused element. This separation:
  - Enables better loop detection — repeated clicks to the same element can be identified and pivoted away from
  - Provides granular error handling — if click fails, type is not sent; if type fails, press_key can still be sent
  - Makes debugging easier — the action history clearly shows which element was clicked and what text was typed
- **UI Action Limit:** At most ONE UI action per turn (click, type, navigate, scroll, or press_key). Type must follow a click in sequence.
- **Typical Workflow:** Click (focus) → Type (enter text) → Press_key (e.g. Enter to submit)
- **Anti-Loop Rules:** The system tracks action history (`ActionRecord`) and uses `shouldPivot()` to detect repeated identical actions (3+ identical click/scroll pairs). When detected, the agent must switch strategies (navigate to a reconstructed URL, try a different interaction path).

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