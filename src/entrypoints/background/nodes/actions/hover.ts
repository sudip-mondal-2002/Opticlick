import { appendConversationTurn } from '@/utils/db';
import { dispatchHover } from '@/utils/cdp';
import { log } from '@/utils/agent-log';
import { sendToTab } from '@/utils/tab-helpers';
import { sleep } from '@/utils/sleep';
import { STEP_DELAY_MS } from '../../agent-state';
import type { AgentAction, CoordinateEntry } from '@/utils/types';
import type { ActionCtx } from './ctx';

type HoverAction = Extract<AgentAction, { type: 'hover' }>;

export async function handleHover(
  action: HoverAction,
  ctx: ActionCtx,
  coordinateMap: CoordinateEntry[],
): Promise<void> {
  const { sessionId, step, userPrompt, toolCallId, toolName, tabId } = ctx;

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
    return;
  }

  await log(`Hovering over element #${target.id} "${target.text}" at (${target.rect.x}, ${target.rect.y}) for ${action.durationMs}ms`, 'act');

  try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }

  try {
    await dispatchHover(tabId, target.rect.x, target.rect.y, action.durationMs);
  } catch (err) {
    const errMsg = (err as Error).message;
    await log(`Hover on #${target.id} failed: ${errMsg}`, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `[ACTION FAILED - Step ${step}] Hovering over element #${action.id} ("${target.text}") failed: "${errMsg}". Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
    await sleep(STEP_DELAY_MS);
    return;
  }

  try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }

  await appendConversationTurn(
    sessionId, 'tool',
    `[Step ${step}] Hovered over element #${action.id} ("${target.text}") for ${action.durationMs}ms. Task: ${userPrompt}`,
    { toolCallId, toolName },
  );

  await sleep(STEP_DELAY_MS);
}