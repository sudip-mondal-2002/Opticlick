import { appendConversationTurn } from '@/utils/db';
import { attachDebugger, getKeyCode } from '@/utils/cdp';
import { log } from '@/utils/agent-log';
import { sendToTab, ensureContentScript, waitForTabLoad } from '@/utils/tab-helpers';
import { sleep } from '@/utils/sleep';
import { STEP_DELAY_MS } from '../../agent-state';
import type { AgentAction } from '@/utils/types';
import type { ActionCtx } from './ctx';

type PressKeyAction = Extract<AgentAction, { type: 'press_key' }>;

async function pressKeyCDP(tabId: number, key: string, waitForNav: boolean): Promise<void> {
  await attachDebugger(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key, windowsVirtualKeyCode: getKeyCode(key),
  });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'keyUp', key, windowsVirtualKeyCode: getKeyCode(key),
  });
  if (waitForNav) {
    await sleep(600);
    await waitForTabLoad(tabId, 10_000, false);
    await ensureContentScript(tabId);
  }
}

export async function handlePressKey(action: PressKeyAction, ctx: ActionCtx): Promise<void> {
  const { tabId, sessionId, step, userPrompt, toolCallId, toolName } = ctx;
  await log(`Pressing key: ${action.key}`, 'act');
  try {
    try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
    await pressKeyCDP(tabId, action.key, action.key === 'Enter' || action.key === 'Return');
    try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
    await appendConversationTurn(
      sessionId, 'tool',
      `[Step ${step}] Pressed key "${action.key}". Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
  } catch (actErr) {
    const errMsg = (actErr as Error).message;
    await log(`Key press "${action.key}" failed: ${errMsg}`, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `[ACTION FAILED - Step ${step}] Pressing key "${action.key}" failed: "${errMsg}". Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
    await waitForTabLoad(tabId, 10_000, false);
    try { await ensureContentScript(tabId); } catch { /* */ }
    try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
  }
  await sleep(STEP_DELAY_MS);
}
