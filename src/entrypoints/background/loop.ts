/**
 * Main agent loop — Think → Annotate → Capture → Reason → Act.
 */

import { appendConversationTurn, getConversationHistory } from '@/utils/db';
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

export async function runAgentLoop(tabId: number, userPrompt: string): Promise<void> {
  await setAgentState({ status: 'running', tabId, step: 0, prompt: userPrompt });
  await log(`Agent started on tab ${tabId}`, 'ok');

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
        await log(`Tab is on a restricted page. Navigating to: ${targetUrl}`, 'ok');
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
        if (emptyRetries < MAX_EMPTY_RETRIES) {
          emptyRetries++;
          const waitMs = emptyRetries * 1500;
          await log(
            `No interactable elements found. Retrying in ${waitMs / 1000}s (${emptyRetries}/${MAX_EMPTY_RETRIES})…`,
            'warn',
          );
          await sleep(waitMs);
          // Re-run this step (don't increment step counter)
          step--;
          continue;
        }
        await log('No interactable elements found after retries. Giving up.', 'error');
        break;
      }
      emptyRetries = 0; // reset on success

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

      const extras = [
        decision.typeText && `typeText="${decision.typeText.slice(0, 40)}"`,
        decision.pressKey && `pressKey=${decision.pressKey}`,
        decision.navigateUrl && `nav=${decision.navigateUrl}`,
        decision.scroll && `scroll=${decision.scroll}`,
      ].filter(Boolean).join(', ');
      await log(
        `Gemini → targetId=${decision.targetId}, done=${decision.done}${extras ? `, ${extras}` : ''}: ${decision.reasoning}`,
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
        try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
        await detachDebugger(tabId);
        await chrome.tabs.update(tabId, { url: decision.navigateUrl });
        await waitForTabLoad(tabId, 15_000, true);
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
        try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        await appendConversationTurn(
          tabId,
          'user',
          `[Step ${step}] ${label}. Task: ${userPrompt}`,
        );
        await sleep(STEP_DELAY_MS);
        continue;
      }

      // 8c. Handle standalone pressKey (no click target)
      if (decision.pressKey && decision.targetId == null) {
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
        try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
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

      await sendToTab(tabId, { type: 'UNBLOCK_INPUT' });

      // Listen for new tabs opened by the click
      let newTabId: number | null = null;
      const newTabListener = (tab: chrome.tabs.Tab) => {
        if (tab.openerTabId === tabId) newTabId = tab.id ?? null;
      };
      chrome.tabs.onCreated.addListener(newTabListener);

      await dispatchHardwareClick(tabId, target.rect.x, target.rect.y);
      await log(`Hardware click dispatched to (${target.rect.x}, ${target.rect.y}).`, 'ok');

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

      // 10b. Press key after click+type (e.g. Enter to submit)
      if (decision.pressKey) {
        await log(`Pressing key: ${decision.pressKey}`, 'ok');
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
      }

      await sleep(500);
      chrome.tabs.onCreated.removeListener(newTabListener);

      // 11. Follow new tab if opened
      if (newTabId) {
        await log(`Click opened new tab (id=${newTabId}). Following it.`, 'ok');
        try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
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
        try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
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
    try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
    await detachDebugger(tabId);
    chrome.runtime.sendMessage({ type: 'AGENT_STATE_CHANGE' }).catch(() => {});
    await log('Agent loop ended. User input restored.', 'ok');
  }
}
