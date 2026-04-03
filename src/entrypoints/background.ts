/**
 * Background Service Worker (MV3) — Opticlick Engine
 *
 * Orchestrates the Think → Annotate → Capture → Reason → Act loop.
 */

import { appendConversationTurn, getConversationHistory } from '@/utils/db';
import { callGemini } from '@/utils/gemini';
import {
  attachDebugger,
  detachDebugger,
  dispatchHardwareClick,
  getKeyCode,
} from '@/utils/cdp';
import type {
  AgentState,
  CoordinateEntry,
  DrawMarksResult,
  LogEntry,
} from '@/utils/types';

export default defineBackground(() => {
  // ── Config ──────────────────────────────────────────────────────────────────

  const MAX_STEPS = 20;
  const STEP_DELAY_MS = 800;
  const RATE_LIMIT_DELAY_MS = 10_000;

  // ── Session state helpers ───────────────────────────────────────────────────

  async function getAgentState(): Promise<AgentState | null> {
    const { agentState } = await chrome.storage.session.get('agentState');
    return (agentState as AgentState) ?? null;
  }

  async function setAgentState(patch: Partial<AgentState>): Promise<AgentState> {
    const current = (await getAgentState()) ?? ({} as AgentState);
    const next: AgentState = { ...current, ...patch };
    await chrome.storage.session.set({ agentState: next });
    return next;
  }

  async function clearAgentState(): Promise<void> {
    await chrome.storage.session.remove(['agentState', 'coordinateMap', 'agentLog']);
  }

  // ── Logging ─────────────────────────────────────────────────────────────────

  async function log(message: string, level: string = 'info'): Promise<void> {
    console.log(`[Opticlick][${level.toUpperCase()}] ${message}`);

    const { agentLog = [] } = (await chrome.storage.session.get('agentLog')) as {
      agentLog?: LogEntry[];
    };
    agentLog.push({ message, level: level as LogEntry['level'], ts: Date.now() });
    if (agentLog.length > 100) agentLog.splice(0, agentLog.length - 100);
    await chrome.storage.session.set({ agentLog });

    chrome.runtime.sendMessage({ type: 'AGENT_LOG', message, level }).catch(() => {});
  }

  // ── Tab messaging ───────────────────────────────────────────────────────────

  function sendToTab<T = unknown>(
    tabId: number,
    message: Record<string, unknown>,
    frameId = 0,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, { frameId }, (response: T) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // ── Tab URL validation ───────────────────────────────────────────────────────

  const UNINJECTABLE_PATTERNS = /^(about:|chrome:|chrome-extension:|edge:|brave:)/;

  async function isTabInjectable(tabId: number): Promise<boolean> {
    const tab = await chrome.tabs.get(tabId);
    return !!tab.url && !UNINJECTABLE_PATTERNS.test(tab.url);
  }

  /**
   * Wait until the tab has navigated to an injectable (http/https) page.
   * Resolves immediately if already on one.
   */
  async function waitForInjectableTab(tabId: number, timeoutMs = 30_000): Promise<void> {
    if (await isTabInjectable(tabId)) return;

    await log('Tab is on a restricted page — waiting for navigation…', 'warn');

    return new Promise((resolve, reject) => {
      let resolved = false;
      const done = (err?: Error) => {
        if (resolved) return;
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        err ? reject(err) : resolve();
      };

      const listener = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
        tab: chrome.tabs.Tab,
      ) => {
        if (updatedTabId !== tabId) return;
        if (
          changeInfo.status === 'complete' &&
          tab.url &&
          !UNINJECTABLE_PATTERNS.test(tab.url)
        ) {
          done();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      setTimeout(
        () => done(new Error('Timed out waiting for tab to navigate to an injectable page.')),
        timeoutMs,
      );
    });
  }

  // ── Content script injection guard ──────────────────────────────────────────

  async function ensureContentScript(tabId: number): Promise<void> {
    await waitForInjectableTab(tabId);
    try {
      await sendToTab(tabId, { type: 'PING' });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ['content-scripts/content.js'],
      });
      await sleep(300);
    }
  }

  // ── Screenshot capture ──────────────────────────────────────────────────────

  async function captureScreenshot(tabId: number): Promise<string> {
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png',
      quality: 90,
    });
    return dataUrl.replace(/^data:image\/png;base64,/, '');
  }

  // ── DOM stabilisation ───────────────────────────────────────────────────────

  function waitForDOMIdle(
    tabId: number,
    quietMs = 600,
    timeoutMs = 5000,
  ): Promise<void> {
    return chrome.scripting
      .executeScript({
        target: { tabId },
        func: (q: number, t: number) => {
          return new Promise<void>((resolve) => {
            let timer: ReturnType<typeof setTimeout>;
            const resetTimer = () => {
              clearTimeout(timer);
              timer = setTimeout(() => {
                observer.disconnect();
                resolve();
              }, q);
            };
            const observer = new MutationObserver(resetTimer);
            observer.observe(document.body || document.documentElement, {
              childList: true,
              subtree: true,
              attributes: true,
            });
            resetTimer();
            setTimeout(() => {
              observer.disconnect();
              resolve();
            }, t);
          });
        },
        args: [quietMs, timeoutMs],
      })
      .then(() => {});
  }

  // ── Utilities ───────────────────────────────────────────────────────────────

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForTabLoad(tabId: number, timeoutMs = 15_000): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      const listener = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
      ) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          done();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      chrome.tabs
        .get(tabId)
        .then((tab) => {
          if (tab.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            done();
          }
        })
        .catch(done);

      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        done();
      }, timeoutMs);
    });
  }

  // ── Main agent loop ─────────────────────────────────────────────────────────

  async function runAgentLoop(tabId: number, userPrompt: string): Promise<void> {
    await setAgentState({ status: 'running', tabId, step: 0, prompt: userPrompt });
    await log(`Agent started on tab ${tabId}`, 'ok');

    try {
      // Require API key before doing anything
      const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
      if (!geminiApiKey) {
        await log('No Gemini API key set. Open the extension and add your key.', 'error');
        await setAgentState({ status: 'error' });
        return;
      }
      // If the active tab is on a restricted page (about:blank, chrome://, etc.),
      // try to extract a URL from the user prompt and navigate there first.
      if (!(await isTabInjectable(tabId))) {
        const urlMatch = userPrompt.match(/https?:\/\/[^\s"'<>]+/i);
        if (urlMatch) {
          const targetUrl = urlMatch[0].replace(/[.,;:!?)]+$/, '');
          await log(`Tab is on a restricted page. Navigating to: ${targetUrl}`, 'ok');
          await chrome.tabs.update(tabId, { url: targetUrl });
          await waitForTabLoad(tabId);
        }
      }

      await ensureContentScript(tabId);
      await sendToTab(tabId, { type: 'BLOCK_INPUT' });

      for (let step = 1; step <= MAX_STEPS; step++) {
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
        let drawResult: DrawMarksResult | undefined;
        try {
          drawResult = await sendToTab<DrawMarksResult>(tabId, { type: 'DRAW_MARKS' });
        } catch {
          await log('Re-injecting content script after navigation…', 'warn');
          await ensureContentScript(tabId);
          drawResult = await sendToTab<DrawMarksResult>(tabId, { type: 'DRAW_MARKS' });
        }

        if (!drawResult) {
          await log(
            'drawResult is null/undefined — content script may not be responding from the main frame.',
            'error',
          );
          break;
        }

        const { coordinateMap } = drawResult;

        if (!coordinateMap || coordinateMap.length === 0) {
          await log('No interactable elements found.', 'warn');
          break;
        }

        await log(`Found ${coordinateMap.length} interactable elements.`);
        await chrome.storage.session.set({ coordinateMap });

        // 3. Capture annotated screenshot
        await log('Capturing screenshot…');
        const base64Image = await captureScreenshot(tabId);

        // 4. Destroy overlay
        await sendToTab(tabId, { type: 'DESTROY_MARKS' });
        await log('Overlay destroyed post-capture.');

        // 5. Fetch conversation history
        const history = await getConversationHistory(tabId);

        // 6. Call Gemini
        await log('Calling Gemini…');
        let decision;
        try {
          decision = await callGemini(geminiApiKey as string, base64Image, userPrompt, history, log);
        } catch (err) {
          await log(
            `Gemini call failed: ${(err as Error).message}. Will retry step.`,
            'error',
          );
          await sleep(RATE_LIMIT_DELAY_MS);
          continue;
        }

        await log(
          `Gemini → targetId=${decision.targetId}, done=${decision.done}: ${decision.reasoning}`,
        );
        await appendConversationTurn(tabId, 'model', JSON.stringify(decision));

        // 7. If done with no final action, finish
        const hasFinalAction =
          decision.targetId != null ||
          decision.navigateUrl ||
          decision.scroll ||
          decision.pressKey;
        if (decision.done && !hasFinalAction) {
          await log('Task complete!', 'ok');
          await setAgentState({ status: 'done' });
          break;
        }

        // 8a. Handle URL navigation
        if (decision.navigateUrl) {
          await log(`Navigating to: ${decision.navigateUrl}`, 'ok');
          try {
            await sendToTab(tabId, { type: 'UNBLOCK_INPUT' });
          } catch { /* */ }
          await detachDebugger(tabId);
          await chrome.tabs.update(tabId, { url: decision.navigateUrl });
          await waitForTabLoad(tabId);
          await ensureContentScript(tabId);
          await sendToTab(tabId, { type: 'BLOCK_INPUT' });
          await appendConversationTurn(
            tabId,
            'user',
            `[Step ${step}] Navigated to ${decision.navigateUrl}. Task: ${userPrompt}`,
          );
          await sleep(STEP_DELAY_MS);
          continue;
        }

        // 8b. Handle scroll
        if (decision.scroll) {
          const isVertical = decision.scroll === 'up' || decision.scroll === 'down';
          const sign = decision.scroll === 'up' || decision.scroll === 'left' ? -1 : 1;
          const deltaX = isVertical ? 0 : sign * 500;
          const deltaY = isVertical ? sign * 500 : 0;

          let scrollX = 600;
          let scrollY = 400;

          if (decision.scrollTargetId != null) {
            const scrollTarget = coordinateMap.find(
              (c: CoordinateEntry) => c.id === decision.scrollTargetId,
            );
            if (scrollTarget) {
              scrollX = scrollTarget.rect.x;
              scrollY = scrollTarget.rect.y;
            }
          }

          const label = decision.scrollTargetId
            ? `Scrolling ${decision.scroll} inside element #${decision.scrollTargetId}`
            : `Scrolling page ${decision.scroll}`;
          await log(`${label}…`, 'ok');

          await sendToTab(tabId, { type: 'UNBLOCK_INPUT' });
          await attachDebugger(tabId);
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: scrollX,
            y: scrollY,
            deltaX,
            deltaY,
          });
          await sleep(300);
          try {
            await sendToTab(tabId, { type: 'BLOCK_INPUT' });
          } catch { /* */ }
          await appendConversationTurn(
            tabId,
            'user',
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
            type: 'rawKeyDown',
            key: decision.pressKey,
            windowsVirtualKeyCode: getKeyCode(decision.pressKey),
          });
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: decision.pressKey,
            windowsVirtualKeyCode: getKeyCode(decision.pressKey),
          });
          try {
            await sendToTab(tabId, { type: 'BLOCK_INPUT' });
          } catch { /* */ }
          await appendConversationTurn(
            tabId,
            'user',
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
        const target = coordinateMap.find(
          (c: CoordinateEntry) => c.id === decision.targetId,
        );
        if (!target) {
          await log(`Target ID ${decision.targetId} not found in coordinate map.`, 'error');
          await setAgentState({ status: 'error' });
          break;
        }

        await log(
          `Clicking element #${target.id} "${target.text}" at CSS (${target.rect.x}, ${target.rect.y})`,
        );

        const cssX = target.rect.x;
        const cssY = target.rect.y;

        await sendToTab(tabId, { type: 'UNBLOCK_INPUT' });

        // Listen for new tabs opened by the click
        let newTabId: number | null = null;
        const newTabListener = (tab: chrome.tabs.Tab) => {
          if (tab.openerTabId === tabId) {
            newTabId = tab.id ?? null;
          }
        };
        chrome.tabs.onCreated.addListener(newTabListener);

        await dispatchHardwareClick(tabId, cssX, cssY);
        await log(`Hardware click dispatched to (${cssX}, ${cssY}).`, 'ok');

        // 10. Type text if requested
        if (decision.typeText) {
          await log(`Typing: "${decision.typeText}"`);
          await sleep(200);
          for (const char of decision.typeText) {
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'keyDown',
              text: char,
            });
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'keyUp',
              text: char,
            });
            await sleep(30);
          }
        }

        await sleep(500);
        chrome.tabs.onCreated.removeListener(newTabListener);

        // 11. Follow new tab if opened
        if (newTabId) {
          await log(`Click opened new tab (id=${newTabId}). Following it.`, 'ok');
          try {
            await sendToTab(tabId, { type: 'UNBLOCK_INPUT' });
          } catch { /* */ }
          await detachDebugger(tabId);

          tabId = newTabId;
          await setAgentState({ tabId });
          await chrome.tabs.update(tabId, { active: true });
          await waitForTabLoad(tabId);
          await ensureContentScript(tabId);
          await sendToTab(tabId, { type: 'BLOCK_INPUT' });

          await appendConversationTurn(
            tabId,
            'user',
            `[Step ${step}] Clicked #${decision.targetId} ("${target.text}") → opened new tab. Task: ${userPrompt}`,
          );
        } else {
          try {
            await sendToTab(tabId, { type: 'BLOCK_INPUT' });
          } catch { /* */ }
          await appendConversationTurn(
            tabId,
            'user',
            `[Step ${step}] Clicked element #${decision.targetId} ("${target.text}"). Task: ${userPrompt}`,
          );
        }

        await sleep(STEP_DELAY_MS);

        if (decision.done) {
          await log('Final action executed. Task complete!', 'ok');
          await setAgentState({ status: 'done' });
          break;
        }
      }
    } catch (err) {
      await log(`Unhandled agent error: ${(err as Error).message}`, 'error');
      await setAgentState({ status: 'error' });
    } finally {
      try {
        await sendToTab(tabId, { type: 'UNBLOCK_INPUT' });
      } catch { /* */ }
      await detachDebugger(tabId);
      chrome.runtime.sendMessage({ type: 'AGENT_STATE_CHANGE' }).catch(() => {});
      await log('Agent loop ended. User input restored.', 'ok');
    }
  }

  // ── Message router ──────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'START_AGENT') {
      const { tabId, prompt } = msg as { tabId: number; prompt: string };
      runAgentLoop(tabId, prompt).catch(async (err) => {
        await log(`Fatal: ${(err as Error).message}`, 'error');
      });
      sendResponse({ started: true });
    }

    if (msg.type === 'STOP_AGENT') {
      setAgentState({ status: 'stopped' }).then(() => {
        sendResponse({ stopped: true });
      });
    }

    return true;
  });
});
