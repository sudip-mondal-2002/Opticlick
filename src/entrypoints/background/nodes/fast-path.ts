import { log } from '@/utils/agent-log';
import {
  inferDeterministicNavigation,
  inferDeterministicRelationshipClick,
  nextDeterministicResearchUrl,
  collectDeterministicResearchEvidence,
} from '@/utils/text-agent-context';
import type { AgentState } from '../agent-state';

/** Skip the model when the task explicitly names a URL or searchable site. */
export async function fastPathNode(state: AgentState): Promise<Partial<AgentState>> {
  const textOnly = (state.model as typeof state.model & { supportsVision?: boolean }).supportsVision === false;
  if (!textOnly) return { actions: [], rawToolCalls: [], deterministicAction: false };

  const currentUrl = (await chrome.tabs.get(state.tabId)).url ?? '';
  const research = nextDeterministicResearchUrl(state.userPrompt, state.visitedUrls ?? []);
  if (research.next) {
    await log(`Deterministic research navigation: ${research.next}`, 'act');
    return {
      actions: [{ type: 'navigate', url: research.next }],
      rawToolCalls: [{ id: `fast-${state.step}`, name: 'navigate', args: { url: research.next } }],
      deterministicAction: true,
      deterministicActions: (state.deterministicActions ?? 0) + 1,
      done: false,
    };
  }
  if (research.complete) {
    let researchEvidence = state.researchEvidence ?? '';
    if (!researchEvidence) {
      try {
        researchEvidence = await collectDeterministicResearchEvidence(state.userPrompt);
        if (researchEvidence) await log('Collected verified research data from visited-site endpoints', 'observe');
      } catch (error) {
        await log(`Research data endpoint failed: ${(error as Error).message}`, 'warn');
      }
    }
    return {
      actions: [], rawToolCalls: [], deterministicAction: false,
      researchPlanDone: true, researchEvidence,
    };
  }
  const targetId = inferDeterministicRelationshipClick(
    state.userPrompt,
    state.pageText,
    state.coordinateMap,
    state.step,
  );
  if (targetId !== undefined) {
    await log(`Deterministic relationship click: element #${targetId}`, 'act');
    return {
      actions: [{ type: 'click', targetId }],
      rawToolCalls: [{ id: `fast-${state.step}`, name: 'click', args: { targetId } }],
      deterministicAction: true,
      deterministicActions: (state.deterministicActions ?? 0) + 1,
      relationshipHopDone: true,
      done: false,
    };
  }
  const destination = inferDeterministicNavigation(state.userPrompt, currentUrl, state.step);
  if (!destination) return { actions: [], rawToolCalls: [], deterministicAction: false };

  await log(`Deterministic navigation: ${destination}`, 'act');
  return {
    actions: [{ type: 'navigate', url: destination }],
    rawToolCalls: [{ id: `fast-${state.step}`, name: 'navigate', args: { url: destination } }],
    deterministicAction: true,
    deterministicActions: (state.deterministicActions ?? 0) + 1,
    done: false,
  };
}
