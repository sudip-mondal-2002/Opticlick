# Project: Opticlick Engine

## Overview
This project is a Manifest V3 (MV3) Chrome Extension that functions as an autonomous web agent. It uses the "Set-of-Mark" visual prompting technique and the Gemini 3.1 Pro model to navigate the web, analyze pages via screenshots, and execute actions by simulating hardware-level clicks via the Chrome DevTools Protocol.

## LLM & API Configuration
- **Primary LLM:** Gemini 3.1 Pro. Strictly use the `gemini-3.1-pro-preview` endpoint for multimodal requests.
- **Authentication:** Before running tests or API calls, ensure the user has provided a valid Gemini API token or Google Cloud service credential in the local environment variables.
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

## Development Workflow
- Follow standard asynchronous ES6 conventions.
- Manage message passing strictly with Promises using `chrome.runtime.sendMessage` and `chrome.tabs.sendMessage` to prevent race conditions during the task loop.
- Validate DOM stability (e.g., using `MutationObserver` to wait for network/DOM idle) before commanding the annotation engine to draw marks.