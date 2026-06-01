import { appendConversationTurn } from '@/utils/db';
import { dispatchDoubleClick } from '@/utils/cdp';
import { log } from '@/utils/agent-log';
import { sendToTab } from '@/utils/tab-helpers';
import { sleep } from '@/utils/sleep';
import { STEP_DELAY_MS } from '../../agent-state';
import type { AgentAction, CoordinateEntry } from '@/utils/types';
import type { ActionCtx } from './ctx';

type DoubleClickAction = Extract<AgentAction, { type: 'double_click' }>;

export async function handleDoubleClick(
  action: DoubleClickAction,
  ctx: ActionCtx,
  coordinateMap: CoordinateEntry[],
  tabIdRef: { current: number },
): Promise<number> {
  const { sessionId, step, userPrompt, toolCallId, toolName } = ctx;
  const { tabId } = ctx;

  const target = coordinateMap.find((c) => c.id === action.id);
  if (!target) {
    const errMsg = `Target ID ${action.id} not found in coordinate map — element may have disappeared.`;
    await log(errMsg, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `[ACTION FAILED - Step ${step}] ${errMsg} Choose a valid element ID. Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
    await sleep(STEP_DELAY_MS);
    return tabId;
  }

  await log(`Double-clicking element #${target.id} "${target.text}" at (${target.rect.x}, ${target.rect.y})`, 'act');

  try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }

  try {
    await dispatchDoubleClick(tabId, target.rect.x, target.rect.y);
  } catch (err) {
    const errMsg = (err as Error).message;
    await log(`Double-click on #${target.id} failed: ${errMsg}`, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `[ACTION FAILED - Step ${step}] Double-clicking element #${action.id} ("${target.text}") failed: "${errMsg}". Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
    await sleep(STEP_DELAY_MS);
    return tabId;
  }

  try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }

  await appendConversationTurn(
    sessionId, 'tool',
    `[Step ${step}] Double-clicked element #${action.id} ("${target.text}"). Task: ${userPrompt}`,
    { toolCallId, toolName },
  );

  await sleep(STEP_DELAY_MS);
  return tabId;
}