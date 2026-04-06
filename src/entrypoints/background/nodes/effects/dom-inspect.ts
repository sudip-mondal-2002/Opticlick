import { appendConversationTurn } from '@/utils/db';
import { log } from '@/utils/agent-log';
import { sendToTab } from '@/utils/tab-helpers';
import type { AgentAction } from '@/utils/types';
import type { EffectCtx } from './ctx';

type FetchDomAction = Extract<AgentAction, { type: 'fetch_dom' }>;

export async function handleFetchDom(action: FetchDomAction, ctx: EffectCtx): Promise<void> {
  const { sessionId, tabId, step, coordinateMap, userPrompt, toolCallId, toolName } = ctx;
  const domTarget = coordinateMap.find((c) => c.id === action.targetId);
  if (!domTarget) {
    await log(`fetch_dom — element #${action.targetId} not in coordinate map`, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `fetch_dom failed: element #${action.targetId} not found in coordinate map`,
      { toolCallId, toolName },
    );
    return;
  }
  await log(`Fetching DOM of element #${domTarget.id}…`, 'observe');
  try {
    const domResult = await sendToTab<{
      success: boolean; outerHTML?: string; tag?: string; truncated?: boolean; error?: string;
    }>(tabId, { type: 'GET_ELEMENT_DOM', x: domTarget.rect.x, y: domTarget.rect.y });
    if (domResult?.success && domResult.outerHTML) {
      const truncNote = domResult.truncated ? ' [truncated at 40 KB]' : '';
      await log(`DOM of #${domTarget.id} <${domResult.tag}> ready${truncNote}`, 'observe');
      await appendConversationTurn(
        sessionId, 'tool',
        `[Step ${step}] DOM of element #${domTarget.id} <${domResult.tag}>${truncNote}:\n${domResult.outerHTML}\n\nTask: ${userPrompt}`,
        { toolCallId, toolName },
      );
    } else {
      await appendConversationTurn(
        sessionId, 'tool',
        `fetch_dom failed: ${domResult?.error ?? 'unknown error'}`,
        { toolCallId, toolName },
      );
      await log(`DOM fetch failed — ${domResult?.error ?? 'unknown'}`, 'warn');
    }
  } catch (domErr) {
    await log(`DOM fetch error — ${(domErr as Error).message}`, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `fetch_dom error: ${(domErr as Error).message}`,
      { toolCallId, toolName },
    );
  }
}
