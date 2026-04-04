import type { LogEntry } from './types';

export async function log(message: string, level = 'info'): Promise<void> {
  console.log(`[Opticlick][${level.toUpperCase()}] ${message}`);

  const { agentLog = [] } = (await chrome.storage.session.get('agentLog')) as {
    agentLog?: LogEntry[];
  };
  agentLog.push({ message, level: level as LogEntry['level'], ts: Date.now() });
  if (agentLog.length > 100) agentLog.splice(0, agentLog.length - 100);
  await chrome.storage.session.set({ agentLog });

  // Send to sidepanel for real-time display
  chrome.runtime.sendMessage({ type: 'AGENT_LOG', message, level }).catch((err) => {
    // Silently ignore if sidepanel not listening (common on startup)
    if (err?.message?.includes('Could not establish connection')) return;
    console.error('[Opticlick] Failed to send log to sidebar:', err?.message ?? err);
  });
}
