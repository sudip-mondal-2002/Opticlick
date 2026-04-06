import { appendConversationTurn } from '@/utils/db';
import { attachDebugger, dispatchScrollWheel } from '@/utils/cdp';
import {
  shouldPivot,
  scrollDeltaIsSignificant,
  computeScrollDelta,
  MAX_PIVOT_RETRIES,
} from '@/utils/navigation-guard';
import { log } from '@/utils/agent-log';
import { sendToTab, ensureContentScript } from '@/utils/tab-helpers';
import { sleep } from '@/utils/sleep';
import { STEP_DELAY_MS } from '../../agent-state';
import type { AgentAction, CoordinateEntry } from '@/utils/types';
import type { ActionRecord } from '@/utils/navigation-guard';
import type { ActionCtx } from './ctx';

type ScrollAction = Extract<AgentAction, { type: 'scroll' }>;

export async function handleScroll(
  action: ScrollAction,
  ctx: ActionCtx,
  actionHistory: ActionRecord[],
  coordinateMap: CoordinateEntry[],
): Promise<ActionRecord[]> {
  const { tabId, sessionId, step, userPrompt, toolCallId, toolName } = ctx;
  const scrollTargetId = action.scrollTargetId;

  if (shouldPivot(actionHistory, 'scroll', scrollTargetId)) {
    await log(`Scroll pivot: same scroll repeated ${MAX_PIVOT_RETRIES} times with no progress.`, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `[PIVOT REQUIRED - Step ${step}] This scroll has been attempted ${MAX_PIVOT_RETRIES} times with no progress. Try a different approach. Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
  } else {
    const { deltaX, deltaY } = computeScrollDelta(action.direction);
    let scrollX = 600, scrollY = 400;
    if (scrollTargetId != null) {
      const scrollTarget = coordinateMap.find((c) => c.id === scrollTargetId);
      if (scrollTarget) { scrollX = scrollTarget.rect.x; scrollY = scrollTarget.rect.y; }
    }
    const label = scrollTargetId
      ? `Scrolling ${action.direction} inside element #${scrollTargetId}`
      : `Scrolling page ${action.direction}`;
    await log(label, 'act');

    try {
      try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
      await attachDebugger(tabId);
      let beforeY = 0, afterY = 0;
      try {
        const r = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: 'window.scrollY', returnByValue: true,
        }) as { result: { value: number } };
        beforeY = r?.result?.value ?? 0;
      } catch { /* */ }
      await dispatchScrollWheel(tabId, scrollX, scrollY, deltaX, deltaY);
      await sleep(300);
      try {
        const r = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: 'window.scrollY', returnByValue: true,
        }) as { result: { value: number } };
        afterY = r?.result?.value ?? 0;
      } catch { /* */ }
      const feedback = scrollDeltaIsSignificant(beforeY, afterY)
        ? label
        : `${label} — page did not move (already at limit or content not scrollable)`;
      try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
      await appendConversationTurn(
        sessionId, 'tool',
        `[Step ${step}] ${feedback}. Task: ${userPrompt}`,
        { toolCallId, toolName },
      );
    } catch (actErr) {
      const errMsg = (actErr as Error).message;
      await log(`Scroll failed: ${errMsg}`, 'warn');
      await appendConversationTurn(
        sessionId, 'tool',
        `[ACTION FAILED - Step ${step}] Scroll failed: "${errMsg}". Task: ${userPrompt}`,
        { toolCallId, toolName },
      );
      try { await ensureContentScript(tabId); } catch { /* */ }
      try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
    }
  }

  await sleep(STEP_DELAY_MS);
  return [...actionHistory, { type: 'scroll', targetId: scrollTargetId }];
}
