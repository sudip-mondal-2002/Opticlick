import type { AgentState } from './types';

export async function getAgentState(): Promise<AgentState | null> {
  const { agentState } = await chrome.storage.session.get('agentState');
  return (agentState as AgentState) ?? null;
}

export async function setAgentState(patch: Partial<AgentState>): Promise<AgentState> {
  const current = (await getAgentState()) ?? ({} as AgentState);
  const next: AgentState = { ...current, ...patch };
  await chrome.storage.session.set({ agentState: next });
  return next;
}

export async function clearAgentState(): Promise<void> {
  await chrome.storage.session.remove(['agentState', 'coordinateMap', 'agentLog']);
}
