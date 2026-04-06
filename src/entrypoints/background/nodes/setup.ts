/**
 * Graph nodes: stepSetup and drawAnnotations.
 *
 * stepSetup    — checks stop conditions, increments step, re-installs file guard,
 *               waits for DOM idle.
 * drawAnnotations — sends DRAW_MARKS to the content script; handles empty-element
 *                   retries with progressive back-off.
 */

import { attachDebugger } from '@/utils/cdp';
import { log } from '@/utils/agent-log';
import { getAgentState, setAgentState } from '@/utils/agent-state';
import { sendToTab, ensureContentScript } from '@/utils/tab-helpers';
import { waitForDOMIdle } from '@/utils/dom-idle';
import { sleep } from '@/utils/sleep';
import type { DrawMarksResult } from '@/utils/types';
import type { AgentState } from '../agent-state';
import { MAX_STEPS, MAX_EMPTY_RETRIES } from '../agent-state';

// ── Node: stepSetup ───────────────────────────────────────────────────────────

export async function stepSetupNode(state: AgentState): Promise<Partial<AgentState>> {
  const agentState = await getAgentState();
  if (!agentState || agentState.status !== 'running') {
    await log('Agent stopped by user.', 'warn');
    return { stopped: true };
  }

  // Increment step unless we're retrying the same step
  const newStep = state.retryStep ? state.step : state.step + 1;
  if (newStep > MAX_STEPS) {
    await log(`Reached maximum step limit (${MAX_STEPS}). Stopping.`, 'warn');
    return { stopped: true, step: newStep };
  }

  await setAgentState({ step: newStep });
  chrome.runtime.sendMessage({ type: 'AGENT_STATE_CHANGE' }).catch(() => {});

  // Re-attach debugger and re-enable file chooser interception
  try {
    await attachDebugger(state.tabId);
    await chrome.debugger.sendCommand(
      { tabId: state.tabId },
      'Page.setInterceptFileChooserDialog',
      { enabled: true },
    );
  } catch { /* will be re-attached when needed */ }

  // Re-install JS-level file dialog block after navigation
  try {
    await chrome.debugger.sendCommand({ tabId: state.tabId }, 'Runtime.evaluate', {
      expression: `(() => {
        if (window.__opticlick_fileBlock) return;
        window.__opticlick_origClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function() {
          if (this.type === 'file') { window.__opticlick_fileInput = this; return; }
          return window.__opticlick_origClick.call(this);
        };
        if (window.showOpenFilePicker) {
          window.__opticlick_origPicker = window.showOpenFilePicker;
          window.showOpenFilePicker = () => Promise.reject(new DOMException('Aborted', 'AbortError'));
        }
        window.__opticlick_clickGuard = (e) => {
          const el = e.target;
          if (el.tagName === 'INPUT' && el.type === 'file') { e.preventDefault(); window.__opticlick_fileInput = el; return; }
          const label = el.closest ? el.closest('label') : null;
          if (label) {
            const forId = label.getAttribute('for');
            let inp = forId ? document.getElementById(forId) : null;
            if (!inp) inp = label.querySelector('input[type="file"]');
            if (inp && inp.tagName === 'INPUT' && inp.type === 'file') { e.preventDefault(); window.__opticlick_fileInput = inp; return; }
          }
        };
        document.addEventListener('click', window.__opticlick_clickGuard, { capture: true });
        window.__opticlick_fileBlock = true;
      })()`,
    });
  } catch { /* page may be navigating */ }

  await waitForDOMIdle(state.tabId);
  return { step: newStep, retryStep: false, llmFailed: false };
}

// ── Node: drawAnnotations ─────────────────────────────────────────────────────

export async function drawAnnotationsNode(state: AgentState): Promise<Partial<AgentState>> {
  let drawResult: DrawMarksResult | undefined;
  try {
    drawResult = await sendToTab<DrawMarksResult>(state.tabId, { type: 'DRAW_MARKS' });
  } catch {
    await log('Re-injecting content script after navigation…', 'act');
    await ensureContentScript(state.tabId);
    drawResult = await sendToTab<DrawMarksResult>(state.tabId, { type: 'DRAW_MARKS' });
  }

  if (!drawResult) {
    await log('Content script not responding. Cannot annotate page.', 'error');
    return { stopped: true, coordinateMap: [] };
  }

  const { coordinateMap } = drawResult;

  if (!coordinateMap || coordinateMap.length === 0) {
    const newEmptyRetries = state.emptyRetries + 1;
    if (newEmptyRetries <= MAX_EMPTY_RETRIES) {
      const waitMs = newEmptyRetries * 1500;
      await log(
        `No interactable elements found. Retrying in ${waitMs / 1000}s (${newEmptyRetries}/${MAX_EMPTY_RETRIES})…`,
        'warn',
      );
      await sleep(waitMs);
      return { coordinateMap: [], emptyRetries: newEmptyRetries, retryStep: true };
    }
    // Exhausted retries — proceed with empty coordinate map (plain screenshot path)
    await log('No interactable elements found after retries. Sending screenshot to LLM for guidance…', 'warn');
    await chrome.storage.session.set({ coordinateMap: [] });
    return { coordinateMap: [], emptyRetries: newEmptyRetries };
  }

  await chrome.storage.session.set({ coordinateMap });
  return { coordinateMap, emptyRetries: 0 };
}
