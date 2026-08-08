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
import { uiActionRegistry, type UIActionContext } from '../action-registry';
import { appendConversationTurn } from '@/utils/db';

function comparableUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return value.replace(/#.*$/, '').replace(/\/$/, '');
  }
}

export async function uiActionNode(
  state: AgentState,
  tabIdRef: { current: number },
): Promise<Partial<AgentState>> {
  const { actions, rawToolCalls, sessionId, userPrompt, step, coordinateMap, actionHistory } = state;
  const { tabId } = state;
  const noElements = coordinateMap.length === 0;

  const uiAction = actions.find((a) =>
    noElements ? UI_ACTION_TYPES_NO_CLICK.has(a.type) : UI_ACTION_TYPES.has(a.type),
  );

  if (!uiAction) {
    await log('No actionable UI response from LLM. Retrying step…', 'warn');
    return { tabId };
  }

  const uiActionIdx = actions.findIndex((a) => a === uiAction);
  const destination = uiAction.type === 'navigate'
    ? uiAction.url
    : uiAction.type === 'click'
      ? coordinateMap.find((entry) => entry.id === uiAction.targetId)?.href
      : undefined;
  if (destination) {
    const visited = new Set((state.visitedUrls ?? []).map(comparableUrl));
    if (visited.has(comparableUrl(destination))) {
      const message = `Blocked navigation loop: ${destination} was already visited. Extract the answer from the current page and call finish; do not revisit it.`;
      await log(message, 'warn');
      await appendConversationTurn(sessionId, 'tool', `[ACTION BLOCKED - Step ${step}] ${message}`, {
        toolCallId: rawToolCalls[uiActionIdx]?.id ?? '',
        toolName: rawToolCalls[uiActionIdx]?.name ?? uiAction.type,
      });
      return { tabId, navigationBlocked: true };
    }
  }
  const handler = uiActionRegistry.get(uiAction.type);

  if (!handler) {
    await log(`Unknown UI action type: ${uiAction.type}`, 'warn');
    return { tabId };
  }

  const ctx: UIActionContext = {
    tabId,
    sessionId,
    step,
    userPrompt,
    toolCallId: rawToolCalls[uiActionIdx]?.id ?? '',
    toolName: rawToolCalls[uiActionIdx]?.name ?? uiAction.type,
    coordinateMap,
    actionHistory,
    tabIdRef,
  };

  const update = await handler.execute(uiAction, ctx);
  return { tabId: tabIdRef.current, ...update };
}
