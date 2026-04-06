/**
 * Graph node: uiAction.
 *
 * Dispatches the single UI action (click, type, navigate, scroll, press_key)
 * returned by the LLM to the appropriate handler. When a click opens a new
 * tab, the mutable tabIdRef is updated so the file-chooser guard in loop.ts
 * always intercepts the right tab.
 */

import { log } from '@/utils/agent-log';
import type { AgentState } from '../agent-state';
import { UI_ACTION_TYPES, UI_ACTION_TYPES_NO_CLICK } from '../agent-state';
import { handleNavigate } from './actions/navigate';
import { handleScroll } from './actions/scroll';
import { handleType } from './actions/type';
import { handlePressKey } from './actions/press-key';
import { handleClick } from './actions/click';
import type { ActionCtx } from './actions/ctx';

export async function uiActionNode(
  state: AgentState,
  tabIdRef: { current: number },
): Promise<Partial<AgentState>> {
  const { actions, rawToolCalls, sessionId, userPrompt, step, coordinateMap, actionHistory } = state;
  let { tabId } = state;
  const noElements = coordinateMap.length === 0;

  const uiAction = actions.find((a) =>
    noElements ? UI_ACTION_TYPES_NO_CLICK.has(a.type) : UI_ACTION_TYPES.has(a.type),
  );

  if (!uiAction) {
    await log('No actionable UI response from LLM. Retrying step…', 'warn');
    return { tabId };
  }

  const uiActionIdx = actions.findIndex((a) => a === uiAction);
  const ctx: ActionCtx = {
    tabId,
    sessionId,
    step,
    userPrompt,
    toolCallId: rawToolCalls[uiActionIdx]?.id ?? '',
    toolName: rawToolCalls[uiActionIdx]?.name ?? uiAction.type,
  };

  if (uiAction.type === 'navigate') {
    await handleNavigate(uiAction, ctx);
    return { tabId };
  }

  if (uiAction.type === 'scroll') {
    const newHistory = await handleScroll(uiAction, ctx, actionHistory, coordinateMap);
    return { tabId, actionHistory: newHistory };
  }

  if (uiAction.type === 'type') {
    await handleType(uiAction, ctx);
    return { tabId };
  }

  if (uiAction.type === 'press_key') {
    await handlePressKey(uiAction, ctx);
    return { tabId };
  }

  if (uiAction.type === 'click') {
    tabId = await handleClick(uiAction, ctx, coordinateMap, tabIdRef);
    return { tabId };
  }

  return { tabId };
}
