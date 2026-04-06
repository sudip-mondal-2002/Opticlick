/**
 * Graph nodes: awaitUser and complete.
 *
 * awaitUser — pauses execution and polls chrome.storage.session until the
 *             user replies to an ask_user question.
 * complete  — logs the finish summary, plays a sound, and marks the session done.
 */

import { appendConversationTurn } from '@/utils/db';
import { log } from '@/utils/agent-log';
import { getAgentState, setAgentState } from '@/utils/agent-state';
import { sleep } from '@/utils/sleep';
import type { AgentAction } from '@/utils/types';
import type { AgentState } from '../agent-state';
import { STEP_DELAY_MS } from '../agent-state';

// ── Node: awaitUser ───────────────────────────────────────────────────────────

export async function awaitUserNode(state: AgentState): Promise<Partial<AgentState>> {
  const { sessionId, actions, rawToolCalls } = state;
  const askActionIdx = actions.findIndex((a) => a.type === 'ask_user');
  if (askActionIdx < 0) return {};

  const askAction = actions[askActionIdx] as Extract<AgentAction, { type: 'ask_user' }>;

  chrome.runtime.sendMessage({ type: 'ASK_USER', question: askAction.question }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'PLAY_SOUND', sound: 'ask' }).catch(() => {});

  const sessionStorage = chrome.storage.session;
  await sessionStorage.remove('userReply');

  const reply = await new Promise<string>((resolve) => {
    const interval = setInterval(() => {
      void (async () => {
        const agentState = await getAgentState();
        if (!agentState || agentState.status !== 'running') {
          clearInterval(interval);
          resolve('');
          return;
        }
        const data = (await sessionStorage.get('userReply')) as { userReply?: string };
        if (data.userReply !== undefined) {
          clearInterval(interval);
          await sessionStorage.remove('userReply');
          resolve(data.userReply);
        }
      })();
    }, 500);
  });

  if (!reply) {
    await log('Agent stopped while waiting for user reply.', 'warn');
    return { stopped: true };
  }

  await log(`User replied: ${reply}`, 'observe');
  await appendConversationTurn(
    sessionId,
    'tool',
    `User answered: ${reply}`,
    {
      toolCallId: rawToolCalls[askActionIdx]?.id ?? '',
      toolName: rawToolCalls[askActionIdx]?.name ?? 'ask_user',
    },
  );

  await sleep(STEP_DELAY_MS);
  return { askUserQuestion: undefined };
}

// ── Node: complete ────────────────────────────────────────────────────────────

export async function completeNode(state: AgentState): Promise<Partial<AgentState>> {
  const finishAction = state.actions.find(
    (a): a is Extract<AgentAction, { type: 'finish' }> => a.type === 'finish',
  );
  if (finishAction?.summary) await log(finishAction.summary, 'ok');
  await log('Task complete!', 'ok');
  chrome.runtime.sendMessage({ type: 'PLAY_SOUND', sound: 'finish' }).catch(() => {});
  await setAgentState({ status: 'done' });
  return {};
}
