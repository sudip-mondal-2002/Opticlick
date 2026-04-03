/**
 * Main agent loop — Think → Annotate → Capture → Reason → Act.
 */

import { appendConversationTurn, createSession, getConversationHistory, touchSession } from '@/utils/db';
import { callGemini } from '@/utils/gemini';
import { attachDebugger, detachDebugger, dispatchHardwareClick, getKeyCode } from '@/utils/cdp';
import { log } from '@/utils/agent-log';
import { getAgentState, setAgentState } from '@/utils/agent-state';
import {
  sendToTab,
  isTabInjectable,
  ensureContentScript,
  waitForTabLoad,
} from '@/utils/tab-helpers';
import { captureScreenshot } from '@/utils/screenshot';
import { waitForDOMIdle } from '@/utils/dom-idle';
import { sleep } from '@/utils/sleep';
import type { CoordinateEntry, DrawMarksResult } from '@/utils/types';

const MAX_STEPS = 20;
const STEP_DELAY_MS = 800;
const RATE_LIMIT_DELAY_MS = 10_000;
const MAX_EMPTY_RETRIES = 3;

export async function runAgentLoop(tabId: number, userPrompt: string, existingSessionId?: number): Promise<void> {
  // Create a new session or reuse an existing one for context continuity.
  const sessionId = existingSessionId ?? await createSession(userPrompt);
  await setAgentState({ status: 'running', tabId, step: 0, prompt: userPrompt, sessionId });
  await log(`Agent started`, 'observe');

  try {
    const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
    if (!geminiApiKey) {
      await log('No Gemini API key set. Open the extension and add your key.', 'error');
      await setAgentState({ status: 'error' });
      return;
    }

    // If the active tab is on a restricted page, try to extract a URL from the prompt
    if (!(await isTabInjectable(tabId))) {
      const urlMatch = userPrompt.match(/https?:\/\/[^\s"'<>]+/i);
      if (urlMatch) {
        const targetUrl = urlMatch[0].replace(/[.,;:!?)]+$/, '');
        await log(`Navigating to: ${targetUrl}`, 'act');
        await chrome.tabs.update(tabId, { url: targetUrl });
        await waitForTabLoad(tabId, 15_000, true);
      }
    }

    await ensureContentScript(tabId);
    await sendToTab(tabId, { type: 'BLOCK_INPUT' });

    let emptyRetries = 0;
    for (let step = 1; step <= MAX_STEPS; step++) {
      const state = await getAgentState();
      if (!state || state.status !== 'running') {
        await log('Agent stopped by user.', 'warn');
        break;
      }

      await setAgentState({ step });
      chrome.runtime.sendMessage({ type: 'AGENT_STATE_CHANGE' }).catch(() => {});

      // 1. Wait for DOM to settle
      await waitForDOMIdle(tabId);

      // 2. Draw Set-of-Mark annotations
      let drawResult: DrawMarksResult | undefined;
      try {
        drawResult = await sendToTab<DrawMarksResult>(tabId, { type: 'DRAW_MARKS' });
      } catch {
        await log('Re-injecting content script after navigation…', 'act');
        await ensureContentScript(tabId);
        drawResult = await sendToTab<DrawMarksResult>(tabId, { type: 'DRAW_MARKS' });
      }

      if (!drawResult) {
        await log('Content script not responding. Cannot annotate page.', 'error');
        break;
      }

      const { coordinateMap } = drawResult;

      if (!coordinateMap || coordinateMap.length === 0) {
        if (emptyRetries < MAX_EMPTY_RETRIES) {
          emptyRetries++;
          const waitMs = emptyRetries * 1500;
          await log(
            `No interactable elements found. Retrying in ${waitMs / 1000}s (${emptyRetries}/${MAX_EMPTY_RETRIES})…`,
            'warn',
          );
          await sleep(waitMs);
          step--;
          continue;
        }
        await log('No interactable elements found after retries. Giving up.', 'error');
        break;
      }
      emptyRetries = 0;

      await chrome.storage.session.set({ coordinateMap });

      // 3. Capture annotated screenshot
      const base64Image = await captureScreenshot(tabId);
      // Store for popup preview, keyed to current step
      await chrome.storage.session.set({ lastScreenshot: base64Image, lastScreenshotStep: step });
      await log('Screenshot captured — tap to preview', 'screenshot');

      // 4. Destroy overlay
      await sendToTab(tabId, { type: 'DESTROY_MARKS' });

      // 5. Fetch conversation history for this session
      const history = await getConversationHistory(sessionId);

      // 6. Call Gemini — thinking tokens are logged as [THINK] inside callGemini
      await log('Sending to Gemini…', 'observe');
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

      // Log the model's reasoning conclusion
      await log(decision.reasoning, 'think');
      await appendConversationTurn(sessionId, 'model', JSON.stringify(decision));
      await touchSession(sessionId);

      // 7. If done with no final action, finish
      const hasFinalAction =
        decision.targetId != null ||
        decision.navigateUrl ||
        decision.scroll ||
        decision.pressKey;
      if (decision.done && !hasFinalAction) {
        await log('Task complete!', 'observe');
        await setAgentState({ status: 'done' });
        break;
      }

      // 8a. Handle URL navigation
      if (decision.navigateUrl) {
        await log(`Navigating to: ${decision.navigateUrl}`, 'act');
        try {
          try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
          await detachDebugger(tabId);
          await chrome.tabs.update(tabId, { url: decision.navigateUrl });
          await waitForTabLoad(tabId, 15_000, true);
          await ensureContentScript(tabId);
          await sendToTab(tabId, { type: 'BLOCK_INPUT' });
          await appendConversationTurn(
            sessionId,
            'user',
            `[Step ${step}] Navigated to ${decision.navigateUrl}. Task: ${userPrompt}`,
          );
        } catch (actErr) {
          const errMsg = (actErr as Error).message;
          await log(`Navigation to ${decision.navigateUrl} failed: ${errMsg}`, 'warn');
          await appendConversationTurn(
            sessionId,
            'user',
            `[ACTION FAILED - Step ${step}] Navigation to "${decision.navigateUrl}" failed with error: "${errMsg}". The page state is unknown. Look at the new screenshot carefully and decide on a different approach. Task: ${userPrompt}`,
          );
          try { await ensureContentScript(tabId); } catch { /* */ }
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        }
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
        await log(`${label}`, 'act');

        try {
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
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
          await appendConversationTurn(
            sessionId,
            'user',
            `[Step ${step}] ${label}. Task: ${userPrompt}`,
          );
        } catch (actErr) {
          const errMsg = (actErr as Error).message;
          await log(`Scroll failed: ${errMsg}`, 'warn');
          await appendConversationTurn(
            sessionId,
            'user',
            `[ACTION FAILED - Step ${step}] Scroll action ("${label}") failed with error: "${errMsg}". Look at the new screenshot and decide on a different approach. Task: ${userPrompt}`,
          );
          try { await ensureContentScript(tabId); } catch { /* */ }
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        }
        await sleep(STEP_DELAY_MS);
        continue;
      }

      // 8c. Handle standalone pressKey (no click target)
      if (decision.pressKey && decision.targetId == null) {
        await log(`Pressing key: ${decision.pressKey}`, 'act');
        try {
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
          // Enter/Return may trigger a form submit / navigation — wait for the tab to settle
          if (decision.pressKey === 'Enter' || decision.pressKey === 'Return') {
            await sleep(600);
            await waitForTabLoad(tabId, 10_000, false);
            await ensureContentScript(tabId);
          }
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
          await appendConversationTurn(
            sessionId,
            'user',
            `[Step ${step}] Pressed key "${decision.pressKey}". Task: ${userPrompt}`,
          );
        } catch (actErr) {
          const errMsg = (actErr as Error).message;
          await log(`Key press "${decision.pressKey}" failed: ${errMsg}`, 'warn');
          await appendConversationTurn(
            sessionId,
            'user',
            `[ACTION FAILED - Step ${step}] Pressing key "${decision.pressKey}" failed with error: "${errMsg}". The page may have navigated to an error page or crashed. Look at the new screenshot carefully and decide on a different approach. Task: ${userPrompt}`,
          );
          // Try to recover — the tab may have navigated somewhere
          await waitForTabLoad(tabId, 10_000, false);
          try { await ensureContentScript(tabId); } catch { /* */ }
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        }
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
        `Clicking element #${target.id} "${target.text}" at (${target.rect.x}, ${target.rect.y})`,
        'act',
      );

      await sendToTab(tabId, { type: 'UNBLOCK_INPUT' });

      // Listen for new tabs opened by the click
      let newTabId: number | null = null;
      const newTabListener = (tab: chrome.tabs.Tab) => {
        if (tab.openerTabId === tabId) newTabId = tab.id ?? null;
      };
      chrome.tabs.onCreated.addListener(newTabListener);

      let actError: string | null = null;
      try {
        await dispatchHardwareClick(tabId, target.rect.x, target.rect.y);

        // 10. Type text if requested
        if (decision.typeText) {
          await log(`Typing: "${decision.typeText}"`, 'act');
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

        // 10b. Press key after click+type (e.g. Enter to submit)
        if (decision.pressKey) {
          await log(`Pressing key: ${decision.pressKey}`, 'act');
          await sleep(100);
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
          // Enter/Return may trigger navigation — wait for the tab to settle
          if (decision.pressKey === 'Enter' || decision.pressKey === 'Return') {
            await sleep(600);
            await waitForTabLoad(tabId, 10_000, false);
            await ensureContentScript(tabId);
          }
        }
      } catch (actErr_) {
        actError = (actErr_ as Error).message;
        await log(`Action on #${target.id} failed: ${actError}`, 'warn');
        // Try to recover from any mid-action navigation or frame crash
        await waitForTabLoad(tabId, 10_000, false);
        try { await ensureContentScript(tabId); } catch { /* */ }
      }

      await sleep(500);
      chrome.tabs.onCreated.removeListener(newTabListener);

      // 11. Follow new tab if opened
      if (newTabId) {
        await log(`Click opened new tab. Following it.`, 'observe');
        try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
        await detachDebugger(tabId);

        tabId = newTabId;
        await setAgentState({ tabId });
        await chrome.tabs.update(tabId, { active: true });
        await waitForTabLoad(tabId);
        await ensureContentScript(tabId);
        await sendToTab(tabId, { type: 'BLOCK_INPUT' });
        await appendConversationTurn(
          sessionId,
          'user',
          `[Step ${step}] Clicked #${decision.targetId} ("${target.text}") → opened new tab. Task: ${userPrompt}`,
        );
      } else if (actError) {
        try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        await appendConversationTurn(
          sessionId,
          'user',
          `[ACTION FAILED - Step ${step}] Clicking element #${decision.targetId} ("${target.text}") failed with error: "${actError}". The page may have navigated or crashed. Look at the new screenshot carefully and decide on a different approach. Task: ${userPrompt}`,
        );
      } else {
        try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        await appendConversationTurn(
          sessionId,
          'user',
          `[Step ${step}] Clicked element #${decision.targetId} ("${target.text}"). Task: ${userPrompt}`,
        );
      }

      await sleep(STEP_DELAY_MS);

      if (decision.done) {
        await log('Task complete!', 'observe');
        await setAgentState({ status: 'done' });
        break;
      }
    }
  } catch (err) {
    await log(`Unhandled agent error: ${(err as Error).message}`, 'error');
    await setAgentState({ status: 'error' });
  } finally {
    try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
    await detachDebugger(tabId);
    chrome.runtime.sendMessage({ type: 'AGENT_STATE_CHANGE' }).catch(() => {});
  }
}
