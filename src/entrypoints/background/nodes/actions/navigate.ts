import { appendConversationTurn } from '@/utils/db';
import { detachDebugger } from '@/utils/cdp';
import { log } from '@/utils/agent-log';
import { sendToTab, ensureContentScript, waitForTabLoad, retryTabUpdate } from '@/utils/tab-helpers';
import { sleep } from '@/utils/sleep';
import { STEP_DELAY_MS } from '../../agent-state';
import type { AgentAction } from '@/utils/types';
import type { ActionCtx } from './ctx';

type NavigateAction = Extract<AgentAction, { type: 'navigate' }>;

export async function handleNavigate(action: NavigateAction, ctx: ActionCtx): Promise<void> {
  const { tabId, sessionId, step, userPrompt, toolCallId, toolName } = ctx;
  await log(`Navigating to: ${action.url}`, 'act');
  try {
    try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
    await detachDebugger(tabId);
    await retryTabUpdate(tabId, { url: action.url });
    await waitForTabLoad(tabId, 15_000, true);
    await ensureContentScript(tabId);
    await sendToTab(tabId, { type: 'BLOCK_INPUT' });
    await appendConversationTurn(
      sessionId, 'tool',
      `[Step ${step}] Navigated to ${action.url}. Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
  } catch (actErr) {
    const errMsg = (actErr as Error).message;
    await log(`Navigation to ${action.url} failed: ${errMsg}`, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `[ACTION FAILED - Step ${step}] Navigation to "${action.url}" failed: "${errMsg}". Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
    try { await ensureContentScript(tabId); } catch { /* */ }
    try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
  }
  await sleep(STEP_DELAY_MS);
}
