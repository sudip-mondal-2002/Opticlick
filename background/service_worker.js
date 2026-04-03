/**
 * service_worker.js — Opticlick Background Service Worker (MV3)
 *
 * Orchestrates the Think → Annotate → Capture → Reason → Act loop.
 *
 * State durability:
 *  - chrome.storage.session  : active loop state, coordinate map, step counter
 *  - IndexedDB (OpticlickDB)  : full conversation history, large payloads
 *
 * Gemini endpoint: gemini-2.5-flash (multimodal)
 */

// ── Config ───────────────────────────────────────────────────────────────────

const GEMINI_API_KEY      = 'AIzaSyDxh0MN-x0ig_iVueZou3pMQrOr65mHA_c';
const GEMINI_MODEL        = 'gemini-3.1-flash-lite-preview';
const GEMINI_ENDPOINT     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
const MAX_STEPS           = 20;   // Hard safety cap per task
const STEP_DELAY_MS       = 800;  // Brief pause between steps for DOM settle
const RATE_LIMIT_DELAY_MS = 10000; // Back-off on 429
const MAX_API_RETRIES     = 5;

// ── IndexedDB helper ──────────────────────────────────────────────────────────

const DB_NAME    = 'OpticlickDB';
const DB_VERSION = 1;
const STORE_NAME = 'conversations';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function appendConversationTurn(tabId, role, content) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add({ tabId, role, content, ts: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

async function getConversationHistory(tabId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = (e) => resolve(
      e.target.result.filter(r => r.tabId === tabId)
    );
    req.onerror = (e) => reject(e.target.error);
  });
}

// ── Session state helpers ─────────────────────────────────────────────────────

async function getAgentState() {
  const { agentState } = await chrome.storage.session.get('agentState');
  return agentState || null;
}

async function setAgentState(patch) {
  const current = await getAgentState() || {};
  const next    = { ...current, ...patch };
  await chrome.storage.session.set({ agentState: next });
  return next;
}

async function clearAgentState() {
  await chrome.storage.session.remove(['agentState', 'coordinateMap', 'agentLog']);
}

// ── Logging ───────────────────────────────────────────────────────────────────

async function log(message, level = 'info') {
  console.log(`[Opticlick][${level.toUpperCase()}] ${message}`);

  // Append to rolling session log (last 100 entries)
  const { agentLog = [] } = await chrome.storage.session.get('agentLog');
  agentLog.push({ message, level, ts: Date.now() });
  if (agentLog.length > 100) agentLog.splice(0, agentLog.length - 100);
  await chrome.storage.session.set({ agentLog });

  // Broadcast to popup if open
  chrome.runtime.sendMessage({ type: 'AGENT_LOG', message, level }).catch(() => {});
}

// ── Tab messaging ─────────────────────────────────────────────────────────────

function sendToTab(tabId, message, frameId = 0) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ── Content script injection guard ───────────────────────────────────────────

async function ensureContentScript(tabId) {
  try {
    await sendToTab(tabId, { type: 'PING' });
  } catch (_) {
    // Not injected yet — inject now
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content/annotator.js'],
    });
    // Small wait for script to initialise
    await sleep(300);
  }
}

// ── Chrome Debugger attachment ────────────────────────────────────────────────

const attachedDebuggers = new Set();

async function attachDebugger(tabId) {
  if (attachedDebuggers.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  attachedDebuggers.add(tabId);
}

async function detachDebugger(tabId) {
  if (!attachedDebuggers.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch (_) { /* tab may have closed */ }
  attachedDebuggers.delete(tabId);
}

// ── Hardware-level click via CDP ──────────────────────────────────────────────

/**
 * Simulate a physical mouse click using Input.dispatchMouseEvent.
 * Coordinates MUST be pre-scaled (CSS pixels, not physical pixels).
 */
async function dispatchHardwareClick(tabId, cssX, cssY) {
  await attachDebugger(tabId);

  const base = { x: cssX, y: cssY, button: 'left', clickCount: 1 };

  // 1. Move cursor to target
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    ...base, type: 'mouseMoved', buttons: 0,
  });

  // 2. Press
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    ...base, type: 'mousePressed', buttons: 1,
  });

  // 3. Release
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    ...base, type: 'mouseReleased', buttons: 0,
  });
}

// ── Screenshot capture ────────────────────────────────────────────────────────

async function captureScreenshot(tabId) {
  // captureVisibleTab requires the tab to be active
  const tab = await chrome.tabs.get(tabId);
  const windowId = tab.windowId;

  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: 'png',
    quality: 90,
  });

  // Strip the data URI prefix to get raw base64
  return dataUrl.replace(/^data:image\/png;base64,/, '');
}

// ── Gemini API call ───────────────────────────────────────────────────────────

const SYSTEM_INSTRUCTIONS = `You are an autonomous web agent that can browse ANY website.

You are given a screenshot of a webpage where all interactable elements have been
numbered with purple bounding boxes (the Set-of-Mark technique).

Your task: decide the NEXT ACTION to accomplish the user's goal. You have these capabilities:
1. Click a numbered element by setting "targetId".
2. Type text into the focused element by setting "typeText".
3. Navigate to ANY URL by setting "navigateUrl" — use this when the current page is NOT the right site, or when the user provides a URL in their task. You can go to any website.
4. Scroll by setting "scroll" to "up", "down", "left", or "right". To scroll INSIDE a specific scrollable element (e.g. a sidebar, code block, or panel), also set "scrollTargetId" to that element's number. Without scrollTargetId the entire page scrolls.
5. Press a keyboard key by setting "pressKey" (e.g. "Enter", "Tab", "Escape").

IMPORTANT:
- You can ALWAYS navigate to a different URL. If the current page is not relevant to the task, use "navigateUrl" to go there. NEVER give up or set "done" to true just because the current page is wrong.
- If you cannot see the element you need, scroll first before giving up.
- Only set "done" to true when the user's task has been fully accomplished.
- Respond ONLY with valid JSON. No markdown, no prose.
- Format:
  {
    "targetId": <number | null>,
    "done": <boolean>,
    "reasoning": "<brief explanation>",
    "typeText": "<text to type, optional>",
    "navigateUrl": "<full URL, optional>",
    "scroll": "<'up' | 'down' | 'left' | 'right', optional>",
    "scrollTargetId": "<number — element to scroll inside, optional>",
    "pressKey": "<key name, optional>"
  }`;

async function callGemini(base64Image, userPrompt, history = []) {
  // Build conversation parts from history
  const contents = [];

  for (const turn of history) {
    contents.push({
      role:  turn.role,
      parts: [{ text: turn.content }],
    });
  }

  // Current turn: screenshot + task
  contents.push({
    role: 'user',
    parts: [
      { text: `User task: ${userPrompt}\n\nAnalyze the annotated screenshot and respond in JSON.` },
      {
        inlineData: {
          mimeType: 'image/png',
          data:     base64Image,
        },
      },
    ],
  });

  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_INSTRUCTIONS }],
    },
    contents,
    generationConfig: {
      temperature:     0.1,
      responseMimeType: 'application/json',
    },
  };

  let lastError;
  for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      const resp = await fetch(GEMINI_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (resp.status === 429) {
        const delay = RATE_LIMIT_DELAY_MS * attempt;
        lastError = new Error(`Gemini rate limit (429) after ${attempt} attempts`);
        await log(`Rate limited by Gemini (attempt ${attempt}/${MAX_API_RETRIES}). Waiting ${delay / 1000}s…`, 'warn');
        await sleep(delay);
        continue;
      }

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Gemini API error ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const data        = await resp.json();
      const rawText     = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('Empty response from Gemini.');

      return JSON.parse(rawText);

    } catch (err) {
      lastError = err;
      if (attempt < MAX_API_RETRIES) {
        await log(`API attempt ${attempt} failed: ${err.message}. Retrying…`, 'warn');
        await sleep(1500 * attempt);
      }
    }
  }

  throw lastError;
}

// ── DOM stabilisation helper ──────────────────────────────────────────────────

/**
 * Wait for the tab's DOM to be idle by injecting a MutationObserver
 * that resolves once there have been no mutations for `quietMs` ms.
 */
function waitForDOMIdle(tabId, quietMs = 600, timeoutMs = 5000) {
  return chrome.scripting.executeScript({
    target: { tabId },
    func:   (quietMs, timeoutMs) => {
      return new Promise((resolve) => {
        let timer;
        const resetTimer = () => {
          clearTimeout(timer);
          timer = setTimeout(() => { observer.disconnect(); resolve(); }, quietMs);
        };
        const observer = new MutationObserver(resetTimer);
        observer.observe(document.body || document.documentElement, {
          childList: true, subtree: true, attributes: true,
        });
        resetTimer();
        setTimeout(() => { observer.disconnect(); resolve(); }, timeoutMs);
      });
    },
    args: [quietMs, timeoutMs],
  });
}

// ── Key code map for CDP ──────────────────────────────────────────────────────

const KEY_CODES = {
  Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
  ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
  Space: 32, Home: 36, End: 35, PageUp: 33, PageDown: 34,
};

function getKeyCode(keyName) {
  return KEY_CODES[keyName] || keyName.charCodeAt(0);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for a tab to finish loading (status === 'complete').
 * Resolves immediately if already loaded, otherwise waits for the onUpdated event.
 */
function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => { if (!resolved) { resolved = true; resolve(); } };

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        done();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    // Check if already loaded
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        done();
      }
    }).catch(done);

    // Safety timeout
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      done();
    }, timeoutMs);
  });
}

// ── Main agent loop ───────────────────────────────────────────────────────────

async function runAgentLoop(tabId, userPrompt) {
  await setAgentState({ status: 'running', tabId, step: 0, prompt: userPrompt });
  await log(`Agent started on tab ${tabId}`, 'ok');

  try {
    await ensureContentScript(tabId);

    // Block user inputs for the duration
    await sendToTab(tabId, { type: 'BLOCK_INPUT' });

    for (let step = 1; step <= MAX_STEPS; step++) {

      // Check for stop signal
      const state = await getAgentState();
      if (!state || state.status !== 'running') {
        await log('Agent stopped by user.', 'warn');
        break;
      }

      await setAgentState({ step });
      await log(`── Step ${step} ──────────────────────────`, 'info');
      chrome.runtime.sendMessage({ type: 'AGENT_STATE_CHANGE' }).catch(() => {});

      // 1. Wait for DOM to settle
      await log('Waiting for DOM idle…');
      await waitForDOMIdle(tabId);

      // 2. Draw Set-of-Mark annotations
      await log('Drawing Set-of-Mark annotations…');
      let drawResult;
      try {
        drawResult = await sendToTab(tabId, { type: 'DRAW_MARKS' });
      } catch (err) {
        // Content script may have been unloaded (navigation). Re-inject.
        await log('Re-injecting content script after navigation…', 'warn');
        await ensureContentScript(tabId);
        drawResult = await sendToTab(tabId, { type: 'DRAW_MARKS' });
      }

      if (!drawResult) {
        await log('drawResult is null/undefined — content script may not be responding from the main frame.', 'error');
        break;
      }

      await log(`drawResult keys: ${JSON.stringify(Object.keys(drawResult))}`);

      const { coordinateMap, dpr } = drawResult;

      if (!coordinateMap || coordinateMap.length === 0) {
        await log(`No interactable elements found (coordinateMap=${JSON.stringify(coordinateMap)}). Check the browser console for [Opticlick] filter breakdown.`, 'warn');
        break;
      }

      await log(`Found ${coordinateMap.length} interactable elements.`);

      // Persist coordinate map to session storage
      await chrome.storage.session.set({ coordinateMap });

      // 3. Capture annotated screenshot
      await log('Capturing screenshot…');
      const base64Image = await captureScreenshot(tabId);

      // 4. Destroy overlay immediately after capture
      await sendToTab(tabId, { type: 'DESTROY_MARKS' });
      await log('Overlay destroyed post-capture.');

      // 5. Fetch conversation history from IndexedDB
      const history = await getConversationHistory(tabId);

      // 6. Call Gemini
      await log('Calling Gemini 2.5 Flash…');
      let decision;
      try {
        decision = await callGemini(base64Image, userPrompt, history);
      } catch (err) {
        await log(`Gemini call failed: ${err.message}. Will retry step.`, 'error');
        await sleep(RATE_LIMIT_DELAY_MS);
        continue;
      }

      await log(`Gemini → targetId=${decision.targetId}, done=${decision.done}: ${decision.reasoning}`);

      // Persist model turn to IndexedDB
      await appendConversationTurn(tabId, 'model', JSON.stringify(decision));

      // 7. If done=true but there's still a final action, execute it first
      const hasFinalAction = decision.targetId != null || decision.navigateUrl || decision.scroll || decision.pressKey;
      if (decision.done && !hasFinalAction) {
        await log('Task complete!', 'ok');
        await setAgentState({ status: 'done' });
        break;
      }

      // 8. Handle URL navigation (LLM wants to go to a different site)
      if (decision.navigateUrl) {
        await log(`Navigating to: ${decision.navigateUrl}`, 'ok');
        try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch (_) {}
        await detachDebugger(tabId);
        await chrome.tabs.update(tabId, { url: decision.navigateUrl });
        // Wait for the new page to finish loading
        await waitForTabLoad(tabId);
        await ensureContentScript(tabId);
        await sendToTab(tabId, { type: 'BLOCK_INPUT' });
        await appendConversationTurn(
          tabId, 'user',
          `[Step ${step}] Navigated to ${decision.navigateUrl}. Task: ${userPrompt}`,
        );
        await sleep(STEP_DELAY_MS);
        continue;
      }

      // 8b. Handle scroll (page or within a specific element)
      if (decision.scroll) {
        const isVertical = decision.scroll === 'up' || decision.scroll === 'down';
        const sign = (decision.scroll === 'up' || decision.scroll === 'left') ? -1 : 1;
        const deltaX = isVertical ? 0 : sign * 500;
        const deltaY = isVertical ? sign * 500 : 0;

        // Position mouse over the target element so it receives the wheel event,
        // or fall back to viewport centre for page-level scrolling.
        // Service worker has no window — use sensible viewport centre defaults
        let scrollX = 600;
        let scrollY = 400;

        if (decision.scrollTargetId != null) {
          const scrollTarget = coordinateMap.find(c => c.id === decision.scrollTargetId);
          if (scrollTarget) {
            scrollX = scrollTarget.rect.x;
            scrollY = scrollTarget.rect.y;
          }
        }

        const label = decision.scrollTargetId
          ? `Scrolling ${decision.scroll} inside element #${decision.scrollTargetId} at (${scrollX}, ${scrollY})`
          : `Scrolling page ${decision.scroll}`;
        await log(`${label}…`, 'ok');

        await sendToTab(tabId, { type: 'UNBLOCK_INPUT' });
        await attachDebugger(tabId);
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: scrollX, y: scrollY, deltaX, deltaY,
        });
        await sleep(300);
        try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch (_) {}
        await appendConversationTurn(
          tabId, 'user',
          `[Step ${step}] ${label}. Task: ${userPrompt}`,
        );
        await sleep(STEP_DELAY_MS);
        continue;
      }

      // 8c. Handle pressKey
      if (decision.pressKey) {
        await log(`Pressing key: ${decision.pressKey}`, 'ok');
        await sendToTab(tabId, { type: 'UNBLOCK_INPUT' });
        await attachDebugger(tabId);
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'rawKeyDown', key: decision.pressKey,
          windowsVirtualKeyCode: getKeyCode(decision.pressKey),
        });
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: decision.pressKey,
          windowsVirtualKeyCode: getKeyCode(decision.pressKey),
        });
        try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch (_) {}
        await appendConversationTurn(
          tabId, 'user',
          `[Step ${step}] Pressed key "${decision.pressKey}". Task: ${userPrompt}`,
        );
        await sleep(STEP_DELAY_MS);
        continue;
      }

      if (decision.targetId == null) {
        await log('No actionable response from LLM. Retrying step…', 'warn');
        continue;
      }

      // 9. Resolve target coordinates
      const target = coordinateMap.find(c => c.id === decision.targetId);
      if (!target) {
        await log(`Target ID ${decision.targetId} not found in coordinate map.`, 'error');
        await setAgentState({ status: 'error' });
        break;
      }

      await log(`Clicking element #${target.id} "${target.text}" at CSS (${target.rect.x}, ${target.rect.y})`);

      const cssX = target.rect.x;
      const cssY = target.rect.y;

      // Temporarily lift the interaction blocker so our CDP events aren't
      // caught by the capturing preventDefault listeners.
      await sendToTab(tabId, { type: 'UNBLOCK_INPUT' });

      // Install a listener to catch new tabs opened by the click
      let newTabId = null;
      const newTabListener = (tab) => {
        if (tab.openerTabId === tabId) {
          newTabId = tab.id;
        }
      };
      chrome.tabs.onCreated.addListener(newTabListener);

      await dispatchHardwareClick(tabId, cssX, cssY);
      await log(`Hardware click dispatched to (${cssX}, ${cssY}).`, 'ok');

      // 10. If the LLM also wants to type text, inject it via CDP
      if (decision.typeText) {
        await log(`Typing: "${decision.typeText}"`);
        await sleep(200);
        for (const char of decision.typeText) {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyDown', text: char,
          });
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyUp', text: char,
          });
          await sleep(30);
        }
      }

      // Brief wait to catch any new tab that was spawned
      await sleep(500);
      chrome.tabs.onCreated.removeListener(newTabListener);

      // 11. If a new tab was opened by the click, follow it
      if (newTabId) {
        await log(`Click opened new tab (id=${newTabId}). Following it.`, 'ok');

        // Clean up old tab
        try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch (_) {}
        await detachDebugger(tabId);

        // Switch agent to the new tab
        tabId = newTabId;
        await setAgentState({ tabId });
        await chrome.tabs.update(tabId, { active: true });
        await waitForTabLoad(tabId);
        await ensureContentScript(tabId);
        await sendToTab(tabId, { type: 'BLOCK_INPUT' });

        await appendConversationTurn(
          tabId, 'user',
          `[Step ${step}] Clicked #${decision.targetId} ("${target.text}") → opened new tab. Now on new tab. Task: ${userPrompt}`,
        );
      } else {
        // Re-block user input on same tab
        try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch (_) {}

        await appendConversationTurn(
          tabId, 'user',
          `[Step ${step}] Clicked element #${decision.targetId} ("${target.text}"). Task: ${userPrompt}`,
        );
      }

      // Brief pause before next loop iteration
      await sleep(STEP_DELAY_MS);

      // Check done AFTER executing the final action
      if (decision.done) {
        await log('Final action executed. Task complete!', 'ok');
        await setAgentState({ status: 'done' });
        break;
      }
    }

  } catch (err) {
    await log(`Unhandled agent error: ${err.message}`, 'error');
    await setAgentState({ status: 'error' });
  } finally {
    // Always restore user control and detach debugger
    try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch (_) {}
    await detachDebugger(tabId);
    chrome.runtime.sendMessage({ type: 'AGENT_STATE_CHANGE' }).catch(() => {});
    await log('Agent loop ended. User input restored.', 'ok');
  }
}

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_AGENT') {
    const { tabId, prompt } = msg;

    // Fire and forget — loop runs asynchronously
    runAgentLoop(tabId, prompt).catch(async (err) => {
      await log(`Fatal: ${err.message}`, 'error');
    });

    sendResponse({ started: true });
  }

  if (msg.type === 'STOP_AGENT') {
    setAgentState({ status: 'stopped' }).then(() => {
      sendResponse({ stopped: true });
    });
  }

  return true; // Keep message channel open
});

// ── Debugger detach listener (tab closed / navigate) ─────────────────────────

chrome.debugger.onDetach.addListener(({ tabId }) => {
  attachedDebuggers.delete(tabId);
});
