/**
 * Agent runner for the sandbox.
 *
 * Imports the real runAgentLoop from the extension source and adapts it
 * to run in-browser. The chrome.* shims are already installed at this point.
 *
 * The Vite alias configuration redirects:
 *   @/utils/cdp  →  src/chrome-mock/debugger.ts
 *   @/utils/tab-helpers  →  src/chrome-mock/messaging.ts
 * so all CDP calls transparently use iframe-native equivalents.
 */

import { initializeLangSmith } from '@/utils/langsmith-config';
import type { AttachedFile } from '@/utils/types';

// Track stop signal
let _stopRequested = false;

export async function stopSandboxAgent(): Promise<void> {
  _stopRequested = true;
  // Set agent state to stopped via shim
  await chrome.storage.session.set({ agentState: { status: 'stopped' } });
}

export async function runSandboxAgent(msg: Record<string, unknown>): Promise<void> {
  _stopRequested = false;

  // Re-initialize LangSmith with any locally stored credentials
  const stored = await chrome.storage.local.get(['langsmithApiKey', 'langsmithProject']);
  if (stored.langsmithApiKey) {
    // Override env vars with user-provided credentials
    (window as unknown as Record<string, string>).__LANGSMITH_API_KEY__ = stored.langsmithApiKey as string;
    (window as unknown as Record<string, string>).__LANGSMITH_PROJECT__ = (stored.langsmithProject as string) || 'opticlick-sandbox';
  }

  initializeLangSmith();

  const { tabId = 1, prompt, sessionId, attachments, modelId } = msg as {
    tabId?: number;
    prompt: string;
    sessionId?: number;
    attachments?: AttachedFile[];
    modelId?: string;
  };

  // Dynamically import the real loop to avoid circular deps during init
  const { runAgentLoop } = await import('@/entrypoints/background/loop');

  try {
    await runAgentLoop(
      tabId as number,
      prompt,
      sessionId,
      attachments,
      modelId,
    );
  } finally {
    _stopRequested = false;
  }
}
