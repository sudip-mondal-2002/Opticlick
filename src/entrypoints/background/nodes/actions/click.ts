import { appendConversationTurn } from '@/utils/db';
import {
  detachDebugger,
  dispatchHardwareClick,
  CDP_MODIFIER,
} from '@/utils/cdp';
import { log } from '@/utils/agent-log';
import { setAgentState } from '@/utils/agent-state';
import {
  sendToTab,
  ensureContentScript,
  waitForTabLoad,
  retryTabUpdate,
  waitForPossibleNavigation,
  urlsDifferSignificantly,
} from '@/utils/tab-helpers';
import { shouldOpenLinkInNewTab } from '@/utils/link-click-policy';
import { sleep } from '@/utils/sleep';
import { injectFileUpload } from '@/utils/file-upload';
import { STEP_DELAY_MS } from '../../agent-state';
import type { AgentAction, CoordinateEntry } from '@/utils/types';
import type { ActionCtx } from './ctx';

type ClickAction = Extract<AgentAction, { type: 'click' }>;
type ClickModifier = NonNullable<ClickAction['modifier']>;

// ── Regular hardware click ────────────────────────────────────────────────────

async function dispatchClick(
  tabId: number,
  modifier: ClickModifier | undefined,
  target: CoordinateEntry,
): Promise<void> {
  try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
  const modBitmask = modifier ? (CDP_MODIFIER[modifier] ?? 0) : 0;
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `document.querySelectorAll('input[type="file"]').forEach(function(i){i.dataset.ocfd=i.disabled?'1':'0';i.disabled=true;})`,
    });
  } catch { /* */ }
  await dispatchHardwareClick(tabId, target.rect.x, target.rect.y, modBitmask);
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `document.querySelectorAll('[data-ocfd]').forEach(function(i){i.disabled=i.dataset.ocfd==='1';delete i.dataset.ocfd;})`,
    });
  } catch { /* */ }
}

// ── Exported handler ──────────────────────────────────────────────────────────

export async function handleClick(
  action: ClickAction,
  ctx: ActionCtx,
  coordinateMap: CoordinateEntry[],
  tabIdRef: { current: number },
): Promise<number> {
  const { sessionId, step, userPrompt, toolCallId, toolName } = ctx;
  let { tabId } = ctx;

  const target = coordinateMap.find((c) => c.id === action.targetId);
  if (!target) {
    const errMsg = `Target ID ${action.targetId} not found in coordinate map — element may have disappeared.`;
    await log(errMsg, 'warn');
    await appendConversationTurn(
      sessionId, 'tool',
      `[ACTION FAILED - Step ${step}] ${errMsg} Choose a valid element ID. Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
    await sleep(STEP_DELAY_MS);
    return tabId;
  }

  const openInNewTab = shouldOpenLinkInNewTab(target, action);
  const effectiveModifier: ClickModifier | undefined = action.modifier ?? (openInNewTab ? 'ctrl' : undefined);
  const clickLabel = openInNewTab
    ? `Ctrl+clicking link #${target.id} "${target.text}" (new tab)`
    : `Clicking element #${target.id} "${target.text}" at (${target.rect.x}, ${target.rect.y})`;
  await log(clickLabel, 'act');

  let newTabId: number | null = null;
  const newTabListener = (tab: chrome.tabs.Tab) => {
    if (tab.openerTabId === tabId) newTabId = tab.id ?? null;
  };
  chrome.tabs.onCreated.addListener(newTabListener);

  let urlBefore = '';
  try {
    urlBefore = (await chrome.tabs.get(tabId)).url ?? '';
  } catch { /* */ }

  let actError: string | null = null;
  try {
    if (action.uploadFileId) {
      await injectFileUpload(tabId, sessionId, action.uploadFileId, target);
    } else {
      await dispatchClick(tabId, effectiveModifier, target);
    }
  } catch (actErr_) {
    actError = (actErr_ as Error).message;
    await log(`Action on #${target.id} failed: ${actError}`, 'warn');
    await waitForTabLoad(tabId, 10_000, false);
    try { await ensureContentScript(tabId); } catch { /* */ }
  }

  await sleep(500);
  chrome.tabs.onCreated.removeListener(newTabListener);

  let urlAfter = '';
  try {
    urlAfter = (await chrome.tabs.get(tabId)).url ?? '';
  } catch { /* */ }

  let sameTabNavigated = !newTabId && urlsDifferSignificantly(urlBefore, urlAfter);
  if (!newTabId && !sameTabNavigated && target.tag === 'a' && !actError) {
    const sawNavigation = await waitForPossibleNavigation(tabId);
    if (sawNavigation) {
      try {
        urlAfter = (await chrome.tabs.get(tabId)).url ?? '';
      } catch { /* */ }
      sameTabNavigated = urlsDifferSignificantly(urlBefore, urlAfter);
    }
  }

  if (newTabId) {
    await log('Click opened new tab. Switching agent to it.', 'observe');
    try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
    await detachDebugger(tabId);
    tabId = newTabId;
    tabIdRef.current = tabId;
    await setAgentState({ tabId });
    await retryTabUpdate(tabId, { active: true });
    await waitForTabLoad(tabId);
    await ensureContentScript(tabId);
    await sendToTab(tabId, { type: 'BLOCK_INPUT' });
    const newTabUrl = (await chrome.tabs.get(tabId).catch(() => null))?.url ?? '';
    await appendConversationTurn(
      sessionId, 'tool',
      `[Step ${step}] Clicked #${action.targetId} ("${target.text}") → opened new tab${newTabUrl ? ` at ${newTabUrl}` : ''}. Agent is now on the new page. Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
  } else if (sameTabNavigated) {
    await log('Click navigated in the same tab. Waiting for page load…', 'observe');
    try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
    await detachDebugger(tabId);
    await waitForTabLoad(tabId, 15_000, true);
    await ensureContentScript(tabId);
    await sendToTab(tabId, { type: 'BLOCK_INPUT' });
    await appendConversationTurn(
      sessionId, 'tool',
      `[Step ${step}] Clicked #${action.targetId} ("${target.text}") → navigated to ${urlAfter}. Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
  } else if (actError) {
    try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
    await appendConversationTurn(
      sessionId, 'tool',
      `[ACTION FAILED - Step ${step}] Clicking element #${action.targetId} ("${target.text}") failed: "${actError}". Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
  } else {
    try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
    await appendConversationTurn(
      sessionId, 'tool',
      `[Step ${step}] Clicked element #${action.targetId} ("${target.text}"). Task: ${userPrompt}`,
      { toolCallId, toolName },
    );
  }

  await sleep(STEP_DELAY_MS);
  return tabId;
}
