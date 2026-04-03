/**
 * Background Service Worker (MV3) — Opticlick Engine
 *
 * Orchestrates the Think → Annotate → Capture → Reason → Act loop.
 */

import { log } from '@/utils/agent-log';
import { setAgentState } from '@/utils/agent-state';
import { runAgentLoop } from './background/loop';

export default defineBackground(() => {
  let loopRunning = false;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'START_AGENT') {
      if (loopRunning) {
        log('Agent is already running — ignoring duplicate start.', 'warn');
        sendResponse({ started: false, reason: 'already_running' });
        return true;
      }
      const { tabId, prompt } = msg as { tabId: number; prompt: string };
      loopRunning = true;
      runAgentLoop(tabId, prompt)
        .catch(async (err) => {
          await log(`Fatal: ${(err as Error).message}`, 'error');
        })
        .finally(() => {
          loopRunning = false;
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
