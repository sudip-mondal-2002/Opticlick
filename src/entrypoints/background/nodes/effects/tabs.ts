import type { AgentAction } from '@/utils/types';
import { attachDebugger, detachDebugger } from '@/utils/cdp';

export async function handleOpenTab(
  action: AgentAction & { type: 'open_tab' },
): Promise<number> {
  const tab = await chrome.tabs.create({
    url: action.url,
    active: true,
  });

  if (!tab.id) {
    throw new Error('Failed to create tab');
  }

  await attachDebugger(tab.id);

  return tab.id;
}

export async function handleSwitchTab(
  action: AgentAction & { type: 'switch_tab' },
  currentTabId: number,
): Promise<number> {
  const tabs = await chrome.tabs.query({
    currentWindow: true,
  });

  const target = tabs[action.tabIndex];

  if (!target?.id) {
    throw new Error(`Tab index ${action.tabIndex} not found`);
  }

  await chrome.tabs.update(target.id, {
    active: true,
  });

  await attachDebugger(target.id);

  if (target.id !== currentTabId) {
    await detachDebugger(currentTabId);
  }

  return target.id;
}

export async function handleCloseTab(
  currentTabId: number,
): Promise<number> {
  const tabs = await chrome.tabs.query({
    currentWindow: true,
  });

  if (tabs.length <= 1) {
    throw new Error('Cannot close the last tab');
  }

  const fallback = tabs.find((t) => t.id !== currentTabId);

  if (!fallback?.id) {
    throw new Error('No fallback tab found');
  }

  await detachDebugger(currentTabId);
  await chrome.tabs.remove(currentTabId);

  await chrome.tabs.update(fallback.id, {
    active: true,
  });

  await attachDebugger(fallback.id);

  return fallback.id;
}

export async function handleListTabs(): Promise<
  Array<{
    index: number;
    title: string;
    url: string;
  }>
> {
  const tabs = await chrome.tabs.query({
    currentWindow: true,
  });

  return tabs.map((tab, index) => ({
    index,
    title: tab.title ?? '',
    url: tab.url ?? '',
  }));
}