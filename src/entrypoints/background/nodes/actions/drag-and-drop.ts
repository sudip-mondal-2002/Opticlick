import { appendConversationTurn } from '@/utils/db';
import { dispatchDragAndDrop } from '@/utils/cdp';
import { log } from '@/utils/agent-log';
import { sendToTab, ensureContentScript } from '@/utils/tab-helpers';
import { sleep } from '@/utils/sleep';
import { STEP_DELAY_MS } from '../../agent-state';
import type { AgentAction, CoordinateEntry } from '@/utils/types';
import type { ActionCtx } from './ctx';

type DragAndDropAction = Extract<AgentAction, { type: 'drag_and_drop' }>;

interface Point {
  x: number;
  y: number;
}

function isValidPoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function resolveTargetPoint(action: DragAndDropAction, coordinateMap: CoordinateEntry[]): { point?: Point; label?: string; error?: string } {
  if (action.targetId != null) {
    const target = coordinateMap.find((c) => c.id === action.targetId);
    if (!target) {
      return { error: `Target ID ${action.targetId} not found in coordinate map - element may have disappeared.` };
    }
    return {
      point: { x: target.rect.x, y: target.rect.y },
      label: `element #${target.id} "${target.text}"`,
    };
  }

  if (action.targetX == null || action.targetY == null) {
    return { error: 'Drag target must specify either targetId or both targetX and targetY.' };
  }

  const point = { x: action.targetX, y: action.targetY };
  if (!isValidPoint(point)) {
    return { error: `Invalid drag target coordinates (${action.targetX}, ${action.targetY}).` };
  }

  return {
    point,
    label: `coordinates (${point.x}, ${point.y})`,
  };
}

export async function handleDragAndDrop(
  action: DragAndDropAction,
  ctx: ActionCtx,
  coordinateMap: CoordinateEntry[],
): Promise<void> {
  const { tabId, sessionId, step, userPrompt, toolCallId, toolName } = ctx;
  const source = coordinateMap.find((c) => c.id === action.sourceId);

  if (!source) {
    const errMsg = `Source ID ${action.sourceId} not found in coordinate map - element may have disappeared.`;
    await log(errMsg, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `[ACTION FAILED - Step ${step}] ${errMsg} Choose a valid source element ID. Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
    await sleep(STEP_DELAY_MS);
    return;
  }

  const sourcePoint = { x: source.rect.x, y: source.rect.y };
  if (!isValidPoint(sourcePoint)) {
    const errMsg = `Invalid drag source coordinates (${source.rect.x}, ${source.rect.y}) for element #${source.id}.`;
    await log(errMsg, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `[ACTION FAILED - Step ${step}] ${errMsg} Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
    await sleep(STEP_DELAY_MS);
    return;
  }

  const target = resolveTargetPoint(action, coordinateMap);
  if (!target.point || !target.label) {
    const errMsg = target.error ?? 'Drag target could not be resolved.';
    await log(errMsg, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `[ACTION FAILED - Step ${step}] ${errMsg} Choose a valid drop target. Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
    await sleep(STEP_DELAY_MS);
    return;
  }

  await log(`Dragging element #${source.id} "${source.text}" to ${target.label}`, 'act');

  try {
    try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
    await dispatchDragAndDrop(tabId, sourcePoint, target.point);
    try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
    await appendConversationTurn(
      sessionId, 'tool',
      `[Step ${step}] Dragged element #${action.sourceId} ("${source.text}") to ${target.label}. Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
  } catch (actErr) {
    const errMsg = (actErr as Error).message;
    await log(`Drag and drop failed: ${errMsg}`, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `[ACTION FAILED - Step ${step}] Drag and drop failed: "${errMsg}". Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
    try { await ensureContentScript(tabId); } catch { /* */ }
    try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
  }

  await sleep(STEP_DELAY_MS);
}
