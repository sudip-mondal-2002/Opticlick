import { sideEffectRegistry, type SideEffectContext } from '../action-registry';
import type { AgentState } from '../agent-state';
import { UI_ACTION_TYPES, UI_ACTION_TYPES_NO_CLICK } from '../agent-state';

export async function sideEffectsNode(state: AgentState): Promise<Partial<AgentState>> {
  const { actions, rawToolCalls, sessionId, tabId, base64Image, step, coordinateMap, userPrompt } = state;
  let updatedState: Partial<AgentState> = {};

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const noElements = coordinateMap.length === 0;
    const isUi = noElements ? UI_ACTION_TYPES_NO_CLICK.has(action.type) : UI_ACTION_TYPES.has(action.type);
    if (isUi) continue;

    const toolCallId = rawToolCalls[i]?.id ?? '';
    const toolName = rawToolCalls[i]?.name ?? action.type;
    const handler = sideEffectRegistry.get(action.type);

    if (handler) {
      const activeState = {
        ...state,
        ...updatedState,
      };

      const ctx: SideEffectContext = {
        tabId: activeState.tabId ?? tabId,
        sessionId,
        step,
        userPrompt,
        toolCallId,
        toolName,
        coordinateMap,
        base64Image,
        state: activeState,
      };

      const update = await handler.execute(action, ctx);
      if (update) {
        updatedState = {
          ...updatedState,
          ...update,
        };
      }
    }
  }

  return updatedState;
}
