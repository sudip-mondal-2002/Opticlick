/**
 * LangGraph agent state machine for Opticlick.
 *
 * Graph flow:
 *   START → stepSetup → drawAnnotations → captureAndDestroy
 *         → reason → sideEffects → uiAction → [stepSetup | END]
 *
 * Special paths:
 *   - ask_user:         sideEffects → awaitUser → stepSetup
 *   - done (no UI):     sideEffects → complete → END
 *   - done (after UI):  uiAction    → complete → END
 *   - stopped / max:    stepSetup   → END
 *   - screenshot fail:  captureAndDestroy → stepSetup (retry)
 *   - LLM fail:         reason      → stepSetup (retry)
 *   - empty elements:   drawAnnotations retries then proceeds without marks
 */

import { StateGraph, END } from '@langchain/langgraph';
import { AgentStateAnnotation, hasUIAction } from './agent-state';
import type { AgentState } from './agent-state';
import { stepSetupNode, drawAnnotationsNode } from './nodes/setup';
import { captureAndDestroyNode, reasonNode } from './nodes/observe';
import { sideEffectsNode } from './nodes/side-effects';
import { uiActionNode } from './nodes/ui-action';
import { awaitUserNode, completeNode } from './nodes/control';

// Re-export so loop.ts can use the type without importing agent-state directly
export type { AgentState } from './agent-state';

// ── Routing functions ─────────────────────────────────────────────────────────

function routeAfterSetup(state: AgentState): string {
  return state.stopped ? END : 'drawAnnotations';
}

function routeAfterDraw(state: AgentState): string {
  if (state.stopped) return END;
  return state.retryStep ? 'stepSetup' : 'captureAndDestroy';
}

function routeAfterCapture(state: AgentState): string {
  return state.retryStep ? 'stepSetup' : 'reason';
}

function routeAfterReason(state: AgentState): string {
  return state.llmFailed ? 'stepSetup' : 'sideEffects';
}

function routeAfterSideEffects(state: AgentState): string {
  if (state.askUserQuestion) return 'awaitUser';
  const noElements = state.coordinateMap.length === 0;
  const uiPresent = hasUIAction(state.actions, noElements);
  if (state.done && !uiPresent) return 'complete';
  if (uiPresent) return 'uiAction';
  return 'stepSetup'; // side-effects-only or no-action turn
}

function routeAfterUIAction(state: AgentState): string {
  return state.done || state.stopped ? 'complete' : 'stepSetup';
}

function routeAfterAwaitUser(state: AgentState): string {
  return state.stopped ? END : 'stepSetup';
}

// ── Graph construction ────────────────────────────────────────────────────────

/**
 * Build and compile the agent graph.
 *
 * @param tabIdRef Mutable reference to the current tabId. uiActionNode updates
 *   it when a click opens a new tab so the file-chooser guard in loop.ts always
 *   targets the correct tab.
 */
export function buildAgentGraph(tabIdRef: { current: number }) {
  const uiActionNodeBound = (state: AgentState) => uiActionNode(state, tabIdRef);

  return new StateGraph(AgentStateAnnotation)
    .addNode('stepSetup', stepSetupNode)
    .addNode('drawAnnotations', drawAnnotationsNode)
    .addNode('captureAndDestroy', captureAndDestroyNode)
    .addNode('reason', reasonNode)
    .addNode('sideEffects', sideEffectsNode)
    .addNode('uiAction', uiActionNodeBound)
    .addNode('awaitUser', awaitUserNode)
    .addNode('complete', completeNode)
    .addEdge('__start__', 'stepSetup')
    .addConditionalEdges('stepSetup', routeAfterSetup)
    .addConditionalEdges('drawAnnotations', routeAfterDraw)
    .addConditionalEdges('captureAndDestroy', routeAfterCapture)
    .addConditionalEdges('reason', routeAfterReason)
    .addConditionalEdges('sideEffects', routeAfterSideEffects)
    .addConditionalEdges('uiAction', routeAfterUIAction)
    .addEdge('complete', END)
    .addConditionalEdges('awaitUser', routeAfterAwaitUser)
    .compile();
}
