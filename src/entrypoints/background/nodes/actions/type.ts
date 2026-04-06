import { appendConversationTurn } from '@/utils/db';
import { typeTextCDP } from '@/utils/cdp';
import { log } from '@/utils/agent-log';
import { sendToTab, ensureContentScript } from '@/utils/tab-helpers';
import { sleep } from '@/utils/sleep';
import { STEP_DELAY_MS } from '../../agent-state';
import type { AgentAction } from '@/utils/types';
import type { ActionCtx } from './ctx';

type TypeAction = Extract<AgentAction, { type: 'type' }>;

export async function handleType(action: TypeAction, ctx: ActionCtx): Promise<void> {
  const { tabId, sessionId, step, userPrompt, toolCallId, toolName } = ctx;
  await log(`Typing: "${action.text}"`, 'act');
  try {
    try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
    await typeTextCDP(tabId, action.text, action.clearField ?? false);
    try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
    await appendConversationTurn(
      sessionId, 'tool',
      `[Step ${step}] Typed: "${action.text}". Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
  } catch (actErr) {
    const errMsg = (actErr as Error).message;
    await log(`Typing failed: ${errMsg}`, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `[ACTION FAILED - Step ${step}] Typing "${action.text}" failed: "${errMsg}". Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
    try { await ensureContentScript(tabId); } catch { /* */ }
    try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
  }
  await sleep(STEP_DELAY_MS);
}
