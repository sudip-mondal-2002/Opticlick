import type { LogEntry } from './types';

export async function log(message: string, level = 'info'): Promise<void> {
  console.log(`[Opticlick][${level.toUpperCase()}] ${message}`);

  const { agentLog = [] } = (await chrome.storage.session.get('agentLog')) as {
    agentLog?: LogEntry[];
  };
  agentLog.push({ message, level: level as LogEntry['level'], ts: Date.now() });
  if (agentLog.length > 100) agentLog.splice(0, agentLog.length - 100);
  await chrome.storage.session.set({ agentLog });

  chrome.runtime.sendMessage({ type: 'AGENT_LOG', message, level }).catch(() => {});
}
