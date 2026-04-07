/**
 * Agent loop entry point — delegates execution to the LangGraph state machine.
 *
 * This module handles setup and teardown:
 *   1. Create / resume session, seed VFS with attachments.
 *   2. Load persisted state (todo, memory, scratchpad).
 *   3. Create the LLM model instance.
 *   4. Navigate to the task URL if the current tab is a restricted page.
 *   5. Inject the content script and block user input.
 *   6. Attach the Chrome Debugger and install the file-chooser guard.
 *   7. Stream the LangGraph agent to completion.
 *   8. Clean up in the finally block (unblock input, detach debugger, etc.).
 */

import {
  createSession,
  saveVFSFile,
  clearVFSFiles,
  getAllMemories,
} from '@/utils/db';
import { createAnyModel } from '@/utils/llm';
import { loadTodoFromVFS, TODO_VFS_FILENAME } from '@/utils/todo';
import { loadScratchpadFromVFS } from '@/utils/scratchpad';
import { isOllamaModel, isOllamaAvailable, DEFAULT_MODEL } from '@/utils/models';
import { log } from '@/utils/agent-log';
import { getAgentState, setAgentState } from '@/utils/agent-state';
import {
  sendToTab,
  isTabInjectable,
  ensureContentScript,
  waitForTabLoad,
  retryTabUpdate,
} from '@/utils/tab-helpers';
import { attachDebugger, detachDebugger } from '@/utils/cdp';
import { getLangSmithTracer } from '@/utils/langsmith-config';
import type { AttachedFile } from '@/utils/types';
import { buildAgentGraph } from './agent-graph';
import type { AgentState } from './agent-graph';

export async function runAgentLoop(
  tabId: number,
  userPrompt: string,
  existingSessionId?: number,
  attachments?: AttachedFile[],
  modelId?: string,
): Promise<void> {
  const sessionId = existingSessionId ?? (await createSession(userPrompt));
  await setAgentState({ status: 'running', tabId, step: 0, prompt: userPrompt, sessionId });

  // Seed VFS with any user-attached files
  if (attachments?.length) {
    for (const file of attachments) {
      await saveVFSFile(sessionId, file.name, file.data, file.mimeType);
    }
    await log(`Loaded ${attachments.length} attached file(s) into VFS`, 'observe');
  }

  // Load persisted state
  const currentTodo = (await loadTodoFromVFS(sessionId)) ?? [];
  if (currentTodo.length > 0) {
    await log(`Resumed todo list: ${currentTodo.length} item(s) loaded from VFS`, 'observe');
  }

  const memoryEntries = await getAllMemories();
  if (memoryEntries.length > 0) {
    await log(`Long-term memory: ${memoryEntries.length} entries loaded`, 'observe');
  }

  const currentScratchpad = await loadScratchpadFromVFS(sessionId);
  if (currentScratchpad.length > 0) {
    await log(`Resumed scratchpad: ${currentScratchpad.length} note(s) loaded from VFS`, 'observe');
  }

  // Capture the starting URL for context anchoring
  let startingUrl = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    startingUrl = tab.url ?? '';
  } catch { /* tab may not be accessible yet */ }

  const anchoredPrompt = startingUrl
    ? `${userPrompt}\n\n[CONTEXT: The task started on ${startingUrl}. If you are on an unrelated page, navigate back.]`
    : userPrompt;

  try {
    const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
    const usingOllama = isOllamaModel(modelId ?? '');
    if (!geminiApiKey && !usingOllama) {
      await log('No Gemini API key set. Open the extension and add your key.', 'error');
      await setAgentState({ status: 'error' });
      return;
    }
    if (usingOllama && !(await isOllamaAvailable())) {
      await log('Ollama is not running. Start Ollama on http://localhost:11434 and try again.', 'error');
      await setAgentState({ status: 'error' });
      return;
    }
    const model = createAnyModel((geminiApiKey as string) || null, modelId ?? DEFAULT_MODEL);

    // Navigate if the current tab cannot accept a content script
    if (!(await isTabInjectable(tabId))) {
      const urlMatch = userPrompt.match(/https?:\/\/[^\s"'<>]+/i);
      if (urlMatch) {
        const targetUrl = urlMatch[0].replace(/[.,;:!?)]+$/, '');
        await log(`Navigating to: ${targetUrl}`, 'act');
        await retryTabUpdate(tabId, { url: targetUrl });
        await waitForTabLoad(tabId, 15_000, true);
      }
    }

    await ensureContentScript(tabId);
    await sendToTab(tabId, { type: 'BLOCK_INPUT' });

    await attachDebugger(tabId);
    await chrome.debugger.sendCommand(
      { tabId },
      'Page.setInterceptFileChooserDialog',
      { enabled: true },
    );

    // File chooser guard — uses a mutable ref so it tracks tabId changes
    // (a click action may switch the agent to a new tab mid-session).
    const tabIdRef = { current: tabId };

    const fileChooserGuard = (
      source: { tabId?: number },
      method: string,
      params?: object,
    ) => {
      if (source.tabId !== tabIdRef.current || method !== 'Page.fileChooserOpened') return;
      const backendNodeId = (params as Record<string, unknown>)?.backendNodeId as number | undefined;
      if (!backendNodeId) return;
      chrome.debugger
        .sendCommand({ tabId: tabIdRef.current }, 'DOM.setFileInputFiles', {
          backendNodeId,
          files: [],
        })
        .catch(() => {});
    };

    chrome.debugger.onEvent.addListener(fileChooserGuard);

    await log('Agent started', 'observe');

    // Build the LangGraph state machine with a reference to the mutable tabId
    const agentGraph = buildAgentGraph(tabIdRef);

    const initialState: Partial<AgentState> = {
      tabId,
      sessionId,
      userPrompt,
      anchoredPrompt,
      model,
      attachments: attachments ?? [],
      step: 0,
      emptyRetries: 0,
      actionHistory: [],
      retryStep: false,
      coordinateMap: [],
      base64Image: '',
      inlineImages: [],
      currentTodo,
      memoryEntries,
      scratchpadEntries: currentScratchpad,
      actions: [],
      rawToolCalls: [],
      reasoning: '',
      done: false,
      stopped: false,
      askUserQuestion: undefined,
      llmFailed: false,
    };

    const tracer = getLangSmithTracer();
    const runConfig = {
      // LangGraph counts each node execution toward the recursion limit.
      // MAX_STEPS=500 steps × ~8 nodes per step = 4000 minimum.
      recursionLimit: 5000,
      ...(tracer ? { callbacks: [tracer] } : {}),
    };

    try {
      for await (const _chunk of await agentGraph.stream(initialState, runConfig)) {
        // Nodes log and persist side effects directly.
        // Sync tabIdRef from agent state in case uiActionNode updated it.
        const currentState = await getAgentState();
        if (currentState?.tabId && currentState.tabId !== tabIdRef.current) {
          tabIdRef.current = currentState.tabId;
        }
      }
    } catch (err) {
      await log(`Unhandled agent error: ${(err as Error).message}`, 'error');
      await setAgentState({ status: 'error' });
    } finally {
      const finalTabId = tabIdRef.current;

      // Restore page to normal state
      try { await sendToTab(finalTabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
      try {
        await chrome.debugger.sendCommand({ tabId: finalTabId }, 'Runtime.evaluate', {
          expression: `(() => {
            if (window.__opticlick_origClick) HTMLInputElement.prototype.click = window.__opticlick_origClick;
            if (window.__opticlick_origPicker) window.showOpenFilePicker = window.__opticlick_origPicker;
            if (window.__opticlick_clickGuard) document.removeEventListener('click', window.__opticlick_clickGuard, { capture: true });
            delete window.__opticlick_origClick;
            delete window.__opticlick_origPicker;
            delete window.__opticlick_clickGuard;
            delete window.__opticlick_fileInput;
            delete window.__opticlick_fileBlock;
          })()`,
        });
      } catch { /* */ }
      chrome.debugger.onEvent.removeListener(fileChooserGuard);
      try {
        await chrome.debugger.sendCommand(
          { tabId: finalTabId },
          'Page.setInterceptFileChooserDialog',
          { enabled: false },
        );
      } catch { /* */ }
      await detachDebugger(finalTabId);
      try { await clearVFSFiles(sessionId, [TODO_VFS_FILENAME]); } catch { /* */ }
      chrome.runtime.sendMessage({ type: 'AGENT_STATE_CHANGE' }).catch(() => {});
    }
  } catch (err) {
    await log(`Fatal: ${(err as Error).message}`, 'error');
    await setAgentState({ status: 'error' });
  }
}
