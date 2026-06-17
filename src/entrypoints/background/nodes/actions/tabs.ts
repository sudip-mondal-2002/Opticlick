import { appendConversationTurn } from '@/utils/db';
import { log } from '@/utils/agent-log';
import type { AgentAction } from '@/utils/types';
import type { ActionCtx } from './ctx';
import { waitForTabLoad, ensureContentScript } from '@/utils/tab-helpers';

type ListTabsAction = Extract<AgentAction, { type: 'list_tabs' }>;

export async function handleListTabs(
  _action: ListTabsAction,
  ctx: ActionCtx,
): Promise<void> {
  const { sessionId, step, toolCallId, toolName } = ctx;

  const tabs = await chrome.tabs.query({});

  const summary = tabs.map((tab, index) =>
    `${index}: ${tab.title ?? 'Untitled'} (${tab.url ?? 'no-url'})`,
  ).join('\n');

  await log(`Found ${tabs.length} tabs`, 'observe');
  await log(summary, 'observe');

await appendConversationTurn(
  sessionId,
  'tool',
  `TAB_LIST_RESULT

${summary}

Total tabs: ${tabs.length}

The tab list has been successfully retrieved.`,
  { toolCallId, toolName },
);
}
type OpenTabAction = Extract<AgentAction, { type: 'open_tab' }>;

export async function handleOpenTab(
  action: OpenTabAction,
  ctx: ActionCtx,
): Promise<number> {
  const { sessionId, step, toolCallId, toolName } = ctx;

  const tab = await chrome.tabs.create({
    url: action.url,
    active: true,
  });

  if (!tab.id) {
    throw new Error('Failed to create tab');
  }

  await waitForTabLoad(tab.id);
  await ensureContentScript(tab.id);

  await log(`Opened tab: ${action.url}`, 'observe');

  await appendConversationTurn(
    sessionId,
    'tool',
    `[Step ${step}] Successfully opened a new tab: ${action.url}. The requested tab has been opened.`,
    { toolCallId, toolName },
  );

  return tab.id;
}
type SwitchTabAction = Extract<AgentAction, { type: 'switch_tab' }>;

export async function handleSwitchTab(
  action: SwitchTabAction,
  ctx: ActionCtx,
): Promise<number> {
  const { sessionId, step, toolCallId, toolName } = ctx;

  const tabs = await chrome.tabs.query({});

  const target = tabs[action.tabIndex];

  if (!target?.id) {
    throw new Error(`Tab ${action.tabIndex} not found`);
  }

  await chrome.tabs.update(target.id, {
    active: true,
  });

  await waitForTabLoad(target.id);
  await ensureContentScript(target.id);

  await log(`Switched to tab ${action.tabIndex}`, 'observe');

  await appendConversationTurn(
    sessionId,
    'tool',
   `[Step ${step}] Successfully switched to tab ${action.tabIndex}. The requested tab switch has been completed.`,
    { toolCallId, toolName },
  );

  return target.id;
}
type CloseTabAction = Extract<AgentAction, { type: 'close_tab' }>;

export async function handleCloseTab(
  _action: CloseTabAction,
  ctx: ActionCtx,
): Promise<number> {
  const { tabId, sessionId, step, toolCallId, toolName } = ctx;

  // Find another tab before closing the current one
  const tabs = await chrome.tabs.query({});

  const replacementTab = tabs.find(
    (t) => t.id !== tabId && t.id != null,
  );

  if (!replacementTab?.id) {
    throw new Error('Cannot close the last remaining tab');
  }

  // Activate replacement tab first
  await chrome.tabs.update(replacementTab.id, {
    active: true,
  });

  // Now close current tab
  await chrome.tabs.remove(tabId);

  await log('Closed current tab', 'observe');

  await appendConversationTurn(
    sessionId,
    'tool',
    `[Step ${step}] Successfully closed the current tab. The user's request has been completed.`,
    { toolCallId, toolName },
  );

  return replacementTab.id;
}
