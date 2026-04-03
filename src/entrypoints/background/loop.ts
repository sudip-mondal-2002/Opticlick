/**
 * Main agent loop — Think → Annotate → Capture → Reason → Act.
 */

import { appendConversationTurn, createSession, getConversationHistory, touchSession, saveVFSFile, writeVFSFile, listVFSFiles, clearVFSFiles, getVFSFile, deleteVFSFile } from '@/utils/db';
import { callModel, createModel } from '@/utils/llm';
import type { InlineImage } from '@/utils/llm';
import { loadTodoFromVFS, saveTodoToVFS, applyTodoUpdates, TODO_VFS_FILENAME } from '@/utils/todo';
import type { AgentAction, TodoItem } from '@/utils/types';
import { attachDebugger, detachDebugger, dispatchHardwareClick, CDP_MODIFIER, getKeyCode, writeTempFile, cleanupTempFile } from '@/utils/cdp';
import { log } from '@/utils/agent-log';
import { getAgentState, setAgentState } from '@/utils/agent-state';
import {
  sendToTab,
  isTabInjectable,
  ensureContentScript,
  waitForTabLoad,
} from '@/utils/tab-helpers';
import { captureScreenshot } from '@/utils/screenshot';
import { waitForDOMIdle } from '@/utils/dom-idle';
import { sleep } from '@/utils/sleep';
import type { CoordinateEntry, DrawMarksResult, AttachedFile } from '@/utils/types';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...(bytes.subarray(i, i + chunk) as unknown as number[]));
  }
  return btoa(binary);
}

function filenameFromResponse(response: Response, url: string, override?: string): string {
  if (override?.trim()) return override.trim();
  const cd = response.headers.get('Content-Disposition');
  if (cd) {
    const m = cd.match(/filename\*?=(?:UTF-8''|"?)([^";\r\n]+)/i);
    if (m) return decodeURIComponent(m[1].trim().replace(/^"|"$/g, ''));
  }
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch { /* ignore */ }
  return 'download';
}

const MAX_STEPS = 500;
const STEP_DELAY_MS = 800;
const RATE_LIMIT_DELAY_MS = 10_000;
const MAX_EMPTY_RETRIES = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Action executors — each handles one AgentAction type
// ─────────────────────────────────────────────────────────────────────────────

/** Log the finish action's summary (the agent's final answer to the user). */
async function logFinishSummary(actions: AgentAction[]): Promise<void> {
  const finish = actions.find((a): a is Extract<AgentAction, { type: 'finish' }> => a.type === 'finish');
  if (finish?.summary) await log(finish.summary, 'ok');
}

/** Execute all non-UI actions (VFS mutations, todo, DOM) and return a summary. */
async function executeSideEffects(
  actions: AgentAction[],
  sessionId: number,
  tabId: number,
  base64Image: string,
  step: number,
  coordinateMap: CoordinateEntry[],
  currentTodo: TodoItem[],
  userPrompt: string,
): Promise<{ updatedTodo: TodoItem[]; mutations: string[] }> {
  let updatedTodo = currentTodo;
  const mutations: string[] = [];

  for (const action of actions) {
    switch (action.type) {
      // ── VFS ──────────────────────────────────────────────────────────────

      case 'vfs_save_screenshot': {
        const fname = action.name.trim() || `step_${step}.png`;
        const saved = await writeVFSFile(sessionId, fname, base64Image, 'image/png');
        mutations.push(`Saved screenshot as "${saved.name}" (id: ${saved.id})`);
        await log(`VFS: saved screenshot → "${saved.name}"`, 'act');
        break;
      }

      case 'vfs_write': {
        const { name, content, mimeType = 'text/plain' } = action;
        const base64Content = btoa(
          Array.from(new TextEncoder().encode(content), (b) => String.fromCharCode(b)).join(''),
        );
        const saved = await writeVFSFile(sessionId, name, base64Content, mimeType);
        mutations.push(`Wrote "${saved.name}" (${saved.size} B, id: ${saved.id})`);
        await log(`VFS: wrote "${saved.name}" (${saved.size} B)`, 'act');
        break;
      }

      case 'vfs_delete': {
        await deleteVFSFile(action.fileId);
        mutations.push(`Deleted VFS file ${action.fileId}`);
        await log(`VFS: deleted file ${action.fileId}`, 'act');
        break;
      }

      case 'vfs_download': {
        const { url, name: nameHint } = action;
        await log(`VFS: downloading ${url}`, 'act');
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
          const mimeType =
            resp.headers.get('Content-Type')?.split(';')[0].trim() ?? 'application/octet-stream';
          const filename = filenameFromResponse(resp.clone(), url, nameHint);
          const base64 = arrayBufferToBase64(await resp.arrayBuffer());
          const saved = await writeVFSFile(sessionId, filename, base64, mimeType);
          mutations.push(`Downloaded "${saved.name}" (${saved.size} B, id: ${saved.id})`);
          await log(`VFS: downloaded → "${saved.name}" (${saved.size} B)`, 'act');
        } catch (dlErr) {
          const msg = (dlErr as Error).message;
          mutations.push(`Download failed: ${msg}`);
          await log(`VFS: download failed — ${msg}`, 'warn');
        }
        break;
      }

      // ── Todo ─────────────────────────────────────────────────────────────

      case 'todo_create': {
        updatedTodo = action.items as TodoItem[];
        await saveTodoToVFS(sessionId, updatedTodo);
        await log(`Todo: created plan with ${updatedTodo.length} item(s)`, 'info');
        break;
      }

      case 'todo_update': {
        updatedTodo = applyTodoUpdates(updatedTodo, action.updates);
        await saveTodoToVFS(sessionId, updatedTodo);
        const summary = action.updates
          .map((u) => `${u.id}→${u.status ?? 'note'}`)
          .join(', ');
        await log(`Todo updated: ${summary}`, 'info');
        break;
      }

      // ── DOM inspection ────────────────────────────────────────────────────

      case 'fetch_dom': {
        const domTarget = coordinateMap.find((c) => c.id === action.targetId);
        if (!domTarget) {
          await log(`fetch_dom — element #${action.targetId} not in coordinate map`, 'warn');
          break;
        }
        await log(`Fetching DOM of element #${domTarget.id}…`, 'observe');
        try {
          const domResult = await sendToTab<{
            success: boolean;
            outerHTML?: string;
            tag?: string;
            truncated?: boolean;
            error?: string;
          }>(tabId, { type: 'GET_ELEMENT_DOM', x: domTarget.rect.x, y: domTarget.rect.y });

          if (domResult?.success && domResult.outerHTML) {
            const truncNote = domResult.truncated ? ' [truncated at 40 KB]' : '';
            await log(`DOM of #${domTarget.id} <${domResult.tag}> ready${truncNote}`, 'observe');
            await appendConversationTurn(
              sessionId,
              'user',
              `[Step ${step}] DOM of element #${domTarget.id} <${domResult.tag}>${truncNote}:\n${domResult.outerHTML}\n\nTask: ${userPrompt}`,
            );
          } else {
            await log(`DOM fetch failed — ${domResult?.error ?? 'unknown'}`, 'warn');
          }
        } catch (domErr) {
          await log(`DOM fetch error — ${(domErr as Error).message}`, 'warn');
        }
        break;
      }

      // ── Wait ─────────────────────────────────────────────────────────────

      case 'wait': {
        await log(`Waiting ${action.ms} ms…`, 'observe');
        await sleep(action.ms);
        mutations.push(`Waited ${action.ms} ms`);
        break;
      }

      // UI actions and finish are handled by the caller
      default:
        break;
    }
  }

  return { updatedTodo, mutations };
}

/** Press a key via CDP (rawKeyDown + keyUp). */
async function pressKeyCDP(
  tabId: number,
  key: string,
  waitForNav: boolean,
): Promise<void> {
  await attachDebugger(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key,
    windowsVirtualKeyCode: getKeyCode(key),
  });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    windowsVirtualKeyCode: getKeyCode(key),
  });
  if (waitForNav) {
    await sleep(600);
    await waitForTabLoad(tabId, 10_000, false);
    await ensureContentScript(tabId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────────────────────────────────────

export async function runAgentLoop(
  tabId: number,
  userPrompt: string,
  existingSessionId?: number,
  attachments?: AttachedFile[],
): Promise<void> {
  const sessionId = existingSessionId ?? (await createSession(userPrompt));
  await setAgentState({ status: 'running', tabId, step: 0, prompt: userPrompt, sessionId });

  if (attachments?.length) {
    for (const file of attachments) {
      await saveVFSFile(sessionId, file.name, file.data, file.mimeType);
    }
    await log(`Loaded ${attachments.length} attached file(s) into VFS`, 'info');
  }

  let currentTodo: TodoItem[] = (await loadTodoFromVFS(sessionId)) ?? [];
  if (currentTodo.length > 0) {
    await log(`Resumed todo list: ${currentTodo.length} item(s) loaded from VFS`, 'info');
  }

  await log(`Agent started`, 'observe');

  // ── File chooser guard ────────────────────────────────────────────────────
  const fileChooserGuard = (
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object,
  ) => {
    if (source.tabId !== tabId || method !== 'Page.fileChooserOpened') return;
    const backendNodeId = (params as Record<string, unknown>)?.backendNodeId as number | undefined;
    if (!backendNodeId) return;
    chrome.debugger
      .sendCommand({ tabId }, 'DOM.setFileInputFiles', { backendNodeId, files: [] })
      .catch(() => {});
  };

  try {
    const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
    if (!geminiApiKey) {
      await log('No Gemini API key set. Open the extension and add your key.', 'error');
      await setAgentState({ status: 'error' });
      return;
    }
    const model = createModel(geminiApiKey as string);

    if (!(await isTabInjectable(tabId))) {
      const urlMatch = userPrompt.match(/https?:\/\/[^\s"'<>]+/i);
      if (urlMatch) {
        const targetUrl = urlMatch[0].replace(/[.,;:!?)]+$/, '');
        await log(`Navigating to: ${targetUrl}`, 'act');
        await chrome.tabs.update(tabId, { url: targetUrl });
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
    chrome.debugger.onEvent.addListener(fileChooserGuard);

    let emptyRetries = 0;
    for (let step = 1; step <= MAX_STEPS; step++) {
      const state = await getAgentState();
      if (!state || state.status !== 'running') {
        await log('Agent stopped by user.', 'warn');
        break;
      }

      await setAgentState({ step });
      chrome.runtime.sendMessage({ type: 'AGENT_STATE_CHANGE' }).catch(() => {});

      try {
        await attachDebugger(tabId);
        await chrome.debugger.sendCommand(
          { tabId },
          'Page.setInterceptFileChooserDialog',
          { enabled: true },
        );
      } catch { /* will be re-attached when needed */ }

      // Re-install JS-level file dialog block after navigation.
      try {
        await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: `(() => {
            if (window.__opticlick_fileBlock) return;
            window.__opticlick_origClick = HTMLInputElement.prototype.click;
            HTMLInputElement.prototype.click = function() {
              if (this.type === 'file') { window.__opticlick_fileInput = this; return; }
              return window.__opticlick_origClick.call(this);
            };
            if (window.showOpenFilePicker) {
              window.__opticlick_origPicker = window.showOpenFilePicker;
              window.showOpenFilePicker = () => Promise.reject(new DOMException('Aborted', 'AbortError'));
            }
            window.__opticlick_clickGuard = (e) => {
              const el = e.target;
              if (el.tagName === 'INPUT' && el.type === 'file') { e.preventDefault(); window.__opticlick_fileInput = el; return; }
              const label = el.closest ? el.closest('label') : null;
              if (label) {
                const forId = label.getAttribute('for');
                let inp = forId ? document.getElementById(forId) : null;
                if (!inp) inp = label.querySelector('input[type="file"]');
                if (inp && inp.tagName === 'INPUT' && inp.type === 'file') { e.preventDefault(); window.__opticlick_fileInput = inp; return; }
              }
            };
            document.addEventListener('click', window.__opticlick_clickGuard, { capture: true });
            window.__opticlick_fileBlock = true;
          })()`,
        });
      } catch { /* */ }

      // 1. Wait for DOM to settle
      await waitForDOMIdle(tabId);

      // 2. Draw Set-of-Mark annotations
      let drawResult: DrawMarksResult | undefined;
      try {
        drawResult = await sendToTab<DrawMarksResult>(tabId, { type: 'DRAW_MARKS' });
      } catch {
        await log('Re-injecting content script after navigation…', 'act');
        await ensureContentScript(tabId);
        drawResult = await sendToTab<DrawMarksResult>(tabId, { type: 'DRAW_MARKS' });
      }

      if (!drawResult) {
        await log('Content script not responding. Cannot annotate page.', 'error');
        break;
      }

      const { coordinateMap } = drawResult;

      if (!coordinateMap || coordinateMap.length === 0) {
        if (emptyRetries < MAX_EMPTY_RETRIES) {
          emptyRetries++;
          const waitMs = emptyRetries * 1500;
          await log(
            `No interactable elements found. Retrying in ${waitMs / 1000}s (${emptyRetries}/${MAX_EMPTY_RETRIES})…`,
            'warn',
          );
          await sleep(waitMs);
          step--;
          continue;
        }

        // No interactable elements after retries — send plain screenshot.
        await log('No interactable elements found after retries. Sending screenshot to LLM for guidance…', 'warn');
        const plainScreenshot = await captureScreenshot(tabId);
        await chrome.storage.session.set({ lastScreenshot: plainScreenshot, lastScreenshotStep: step });
        await log('Screenshot captured — tap to preview', 'screenshot');

        const historyForEmpty = await getConversationHistory(sessionId);
        const vfsFilesForEmpty = await listVFSFiles(sessionId);
        await log('Sending to LLM…', 'observe');

        let emptyResult;
        try {
          emptyResult = await callModel(
            model,
            plainScreenshot,
            `${userPrompt}\n\n[SYSTEM NOTE: No interactable elements detected. Decide whether to navigate, scroll, press a key, or call finish if the goal is already achieved. Do NOT call click — there are no annotated elements.]`,
            historyForEmpty,
            log,
            vfsFilesForEmpty,
            [],
            currentTodo,
          );
        } catch (err) {
          await log(`LLM call failed: ${(err as Error).message}. Giving up.`, 'error');
          break;
        }

        if (emptyResult.reasoning) await log(emptyResult.reasoning, 'think');
        await appendConversationTurn(sessionId, 'model', emptyResult.reasoning || JSON.stringify(emptyResult.actions.map((a) => a.type)));
        await touchSession(sessionId);
        emptyRetries = 0;

        // Process side-effects (todo, VFS, DOM) — coordinateMap is empty here.
        const { updatedTodo: newTodo } = await executeSideEffects(
          emptyResult.actions,
          sessionId,
          tabId,
          plainScreenshot,
          step,
          [],
          currentTodo,
          userPrompt,
        );
        currentTodo = newTodo;

        if (emptyResult.done) {
          await logFinishSummary(emptyResult.actions);
          await log('Task complete!', 'observe');
          await setAgentState({ status: 'done' });
          break;
        }

        // Execute the single UI action (navigate / scroll / press_key).
        const uiAction = emptyResult.actions.find((a) =>
          a.type === 'navigate' || a.type === 'scroll' || a.type === 'press_key',
        );

        if (!uiAction) {
          await log('LLM could not determine a next action. Giving up.', 'error');
          break;
        }

        if (uiAction.type === 'navigate') {
          await log(`Navigating to: ${uiAction.url}`, 'act');
          try {
            try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
            await detachDebugger(tabId);
            await chrome.tabs.update(tabId, { url: uiAction.url });
            await waitForTabLoad(tabId, 15_000, true);
            await ensureContentScript(tabId);
            await sendToTab(tabId, { type: 'BLOCK_INPUT' });
            await appendConversationTurn(sessionId, 'user', `[Step ${step}] Navigated to ${uiAction.url}. Task: ${userPrompt}`);
          } catch (navErr) {
            await log(`Navigation failed: ${(navErr as Error).message}`, 'warn');
            await appendConversationTurn(sessionId, 'user', `[ACTION FAILED - Step ${step}] Navigation to "${uiAction.url}" failed: "${(navErr as Error).message}". Task: ${userPrompt}`);
            try { await ensureContentScript(tabId); } catch { /* */ }
            try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
          }
        } else if (uiAction.type === 'scroll') {
          const isVert = uiAction.direction === 'up' || uiAction.direction === 'down';
          const sign = uiAction.direction === 'up' || uiAction.direction === 'left' ? -1 : 1;
          const label = `Scrolling page ${uiAction.direction}`;
          await log(label, 'act');
          try {
            try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
            await attachDebugger(tabId);
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
              type: 'mouseWheel', x: 600, y: 400,
              deltaX: isVert ? 0 : sign * 500,
              deltaY: isVert ? sign * 500 : 0,
            });
            await sleep(300);
            try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
            await appendConversationTurn(sessionId, 'user', `[Step ${step}] ${label}. Task: ${userPrompt}`);
          } catch (scrollErr) {
            await log(`Scroll failed: ${(scrollErr as Error).message}`, 'warn');
          }
        } else if (uiAction.type === 'press_key') {
          await log(`Pressing key: ${uiAction.key}`, 'act');
          try {
            try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
            await pressKeyCDP(tabId, uiAction.key, uiAction.key === 'Enter' || uiAction.key === 'Return');
            try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
            await appendConversationTurn(sessionId, 'user', `[Step ${step}] Pressed key "${uiAction.key}". Task: ${userPrompt}`);
          } catch (keyErr) {
            await log(`Key press failed: ${(keyErr as Error).message}`, 'warn');
          }
        }

        await sleep(STEP_DELAY_MS);
        continue;
      }
      emptyRetries = 0;

      await chrome.storage.session.set({ coordinateMap });

      // 3. Capture annotated screenshot
      const base64Image = await captureScreenshot(tabId);
      await chrome.storage.session.set({ lastScreenshot: base64Image, lastScreenshotStep: step });
      await log('Screenshot captured — tap to preview', 'screenshot');
      await saveVFSFile(sessionId, `step_${step}.png`, base64Image, 'image/png');

      // 4. Destroy overlay
      await sendToTab(tabId, { type: 'DESTROY_MARKS' });

      // 5. Fetch conversation history and VFS listing
      const history = await getConversationHistory(sessionId);
      const vfsFiles = await listVFSFiles(sessionId);
      await log('Sending to LLM…', 'observe');

      const inlineImages: InlineImage[] =
        step === 1 && attachments?.length
          ? attachments
              .filter((a) => a.mimeType.startsWith('image/'))
              .map(({ name, mimeType, data }) => ({ name, mimeType, data }))
          : [];

      // 6. Call LLM → AgentResult
      let result;
      try {
        result = await callModel(model, base64Image, userPrompt, history, log, vfsFiles, inlineImages, currentTodo);
      } catch (err) {
        await log(`LLM call failed: ${(err as Error).message}. Will retry step.`, 'error');
        await sleep(RATE_LIMIT_DELAY_MS);
        continue;
      }

      const { reasoning, actions, done } = result;
      if (reasoning) await log(reasoning, 'think');
      await appendConversationTurn(
        sessionId,
        'model',
        reasoning || actions.map((a) => a.type).join(', '),
      );
      await touchSession(sessionId);

      // 7. Execute side-effects (VFS, todo, fetch_dom)
      const { updatedTodo, mutations } = await executeSideEffects(
        actions,
        sessionId,
        tabId,
        base64Image,
        step,
        coordinateMap,
        currentTodo,
        userPrompt,
      );
      currentTodo = updatedTodo;

      // Determine what kind of action(s) were requested
      const uiAction = actions.find((a) =>
        a.type === 'click' ||
        a.type === 'navigate' ||
        a.type === 'scroll' ||
        a.type === 'press_key',
      );
      const hasSideEffects = mutations.length > 0 || actions.some((a) => a.type === 'fetch_dom');

      // 8. If done with no UI action, finish
      if (done && !uiAction) {
        await logFinishSummary(actions);
        await log('Task complete!', 'observe');
        await setAgentState({ status: 'done' });
        break;
      }

      // Side-effects only this turn — log and continue
      if (!uiAction && hasSideEffects) {
        await appendConversationTurn(
          sessionId,
          'user',
          `[Step ${step}] VFS/todo operations: ${mutations.join('; ')}. Task: ${userPrompt}`,
        );
        if (done) {
          await logFinishSummary(actions);
          await log('Task complete!', 'observe');
          await setAgentState({ status: 'done' });
          break;
        }
        await sleep(STEP_DELAY_MS);
        continue;
      }

      if (!uiAction) {
        await log('No actionable response from LLM. Retrying step…', 'warn');
        continue;
      }

      // 8a. Navigate
      if (uiAction.type === 'navigate') {
        await log(`Navigating to: ${uiAction.url}`, 'act');
        try {
          try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
          await detachDebugger(tabId);
          await chrome.tabs.update(tabId, { url: uiAction.url });
          await waitForTabLoad(tabId, 15_000, true);
          await ensureContentScript(tabId);
          await sendToTab(tabId, { type: 'BLOCK_INPUT' });
          await appendConversationTurn(
            sessionId,
            'user',
            `[Step ${step}] Navigated to ${uiAction.url}. Task: ${userPrompt}`,
          );
        } catch (actErr) {
          const errMsg = (actErr as Error).message;
          await log(`Navigation to ${uiAction.url} failed: ${errMsg}`, 'warn');
          await appendConversationTurn(
            sessionId,
            'user',
            `[ACTION FAILED - Step ${step}] Navigation to "${uiAction.url}" failed: "${errMsg}". Task: ${userPrompt}`,
          );
          try { await ensureContentScript(tabId); } catch { /* */ }
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        }
        await sleep(STEP_DELAY_MS);
        continue;
      }

      // 8b. Scroll
      if (uiAction.type === 'scroll') {
        const isVertical = uiAction.direction === 'up' || uiAction.direction === 'down';
        const sign = uiAction.direction === 'up' || uiAction.direction === 'left' ? -1 : 1;
        const deltaX = isVertical ? 0 : sign * 500;
        const deltaY = isVertical ? sign * 500 : 0;

        let scrollX = 600;
        let scrollY = 400;
        if (uiAction.scrollTargetId != null) {
          const scrollTarget = coordinateMap.find((c) => c.id === uiAction.scrollTargetId);
          if (scrollTarget) { scrollX = scrollTarget.rect.x; scrollY = scrollTarget.rect.y; }
        }

        const label = uiAction.scrollTargetId
          ? `Scrolling ${uiAction.direction} inside element #${uiAction.scrollTargetId}`
          : `Scrolling page ${uiAction.direction}`;
        await log(label, 'act');

        try {
          try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
          await attachDebugger(tabId);
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            type: 'mouseWheel', x: scrollX, y: scrollY, deltaX, deltaY,
          });
          await sleep(300);
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
          await appendConversationTurn(
            sessionId,
            'user',
            `[Step ${step}] ${label}. Task: ${userPrompt}`,
          );
        } catch (actErr) {
          const errMsg = (actErr as Error).message;
          await log(`Scroll failed: ${errMsg}`, 'warn');
          await appendConversationTurn(
            sessionId,
            'user',
            `[ACTION FAILED - Step ${step}] ${label} failed: "${errMsg}". Task: ${userPrompt}`,
          );
          try { await ensureContentScript(tabId); } catch { /* */ }
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        }
        await sleep(STEP_DELAY_MS);
        continue;
      }

      // 8c. Standalone key press (no click target)
      if (uiAction.type === 'press_key') {
        await log(`Pressing key: ${uiAction.key}`, 'act');
        try {
          try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
          await pressKeyCDP(
            tabId,
            uiAction.key,
            uiAction.key === 'Enter' || uiAction.key === 'Return',
          );
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
          await appendConversationTurn(
            sessionId,
            'user',
            `[Step ${step}] Pressed key "${uiAction.key}". Task: ${userPrompt}`,
          );
        } catch (actErr) {
          const errMsg = (actErr as Error).message;
          await log(`Key press "${uiAction.key}" failed: ${errMsg}`, 'warn');
          await appendConversationTurn(
            sessionId,
            'user',
            `[ACTION FAILED - Step ${step}] Pressing key "${uiAction.key}" failed: "${errMsg}". Task: ${userPrompt}`,
          );
          await waitForTabLoad(tabId, 10_000, false);
          try { await ensureContentScript(tabId); } catch { /* */ }
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        }
        await sleep(STEP_DELAY_MS);
        continue;
      }

      // 8d. Click (with optional type + key)
      if (uiAction.type === 'click') {
        const target = coordinateMap.find((c) => c.id === uiAction.targetId);
        if (!target) {
          const errMsg = `Target ID ${uiAction.targetId} not found in coordinate map — element may have disappeared.`;
          await log(errMsg, 'warn');
          await appendConversationTurn(
            sessionId,
            'user',
            `[ACTION FAILED - Step ${step}] ${errMsg} Choose a valid element ID. Task: ${userPrompt}`,
          );
          await sleep(STEP_DELAY_MS);
          continue;
        }

        await log(
          `Clicking element #${target.id} "${target.text}" at (${target.rect.x}, ${target.rect.y})`,
          'act',
        );

        let newTabId: number | null = null;
        const newTabListener = (tab: chrome.tabs.Tab) => {
          if (tab.openerTabId === tabId) newTabId = tab.id ?? null;
        };
        chrome.tabs.onCreated.addListener(newTabListener);

        let actError: string | null = null;
        try {
          if (uiAction.uploadFileId) {
            let vfsFile = await getVFSFile(uiAction.uploadFileId);
            if (!vfsFile) {
              const allFiles = await listVFSFiles(sessionId);
              vfsFile = allFiles.find((f) => f.name === uiAction.uploadFileId);
            }
            if (!vfsFile) throw new Error(`VFS file "${uiAction.uploadFileId}" not found.`);
            await log(`Uploading "${vfsFile.name}" → element #${target.id}`, 'act');

            const tempDl = await writeTempFile(vfsFile.data, vfsFile.name, vfsFile.mimeType);
            try {
              await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
                expression: `window.__opticlick_fileInput = null`,
              });
              try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
              await dispatchHardwareClick(tabId, target.rect.x, target.rect.y);
              await sleep(500);
              const inputEval = (await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
                expression: `window.__opticlick_fileInput || document.querySelector('input[type="file"]')`,
              })) as { result: { objectId?: string; subtype?: string } };
              const objectId = inputEval?.result?.objectId;
              if (!objectId || inputEval.result.subtype === 'null') {
                throw new Error('No file input found after clicking upload button');
              }
              await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', {
                objectId,
                files: [tempDl.filePath],
              });
              await log('Uploaded via CDP', 'act');
            } finally {
              await cleanupTempFile(tempDl.downloadId);
            }
          } else {
            try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
            const modBitmask = uiAction.modifier ? (CDP_MODIFIER[uiAction.modifier] ?? 0) : 0;
            await dispatchHardwareClick(tabId, target.rect.x, target.rect.y, modBitmask);
          }

          if (uiAction.typeText && uiAction.clearField) {
            // Select all existing content so the new text replaces it.
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'rawKeyDown', key: 'a', windowsVirtualKeyCode: 65, modifiers: 2, // Ctrl+A
            });
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'keyUp', key: 'a', windowsVirtualKeyCode: 65, modifiers: 2,
            });
            await sleep(50);
          }

          if (uiAction.typeText) {
            await log(`Typing: "${uiAction.typeText}"`, 'act');
            await sleep(200);
            for (const char of uiAction.typeText) {
              await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
                type: 'keyDown', text: char,
              });
              await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
                type: 'keyUp', text: char,
              });
              await sleep(30);
            }
          }

          if (uiAction.pressKey) {
            await log(`Pressing key: ${uiAction.pressKey}`, 'act');
            await sleep(100);
            await pressKeyCDP(
              tabId,
              uiAction.pressKey,
              uiAction.pressKey === 'Enter' || uiAction.pressKey === 'Return',
            );
          }
        } catch (actErr_) {
          actError = (actErr_ as Error).message;
          await log(`Action on #${target.id} failed: ${actError}`, 'warn');
          await waitForTabLoad(tabId, 10_000, false);
          try { await ensureContentScript(tabId); } catch { /* */ }
        }

        await sleep(500);
        chrome.tabs.onCreated.removeListener(newTabListener);

        if (newTabId) {
          await log(`Click opened new tab. Following it.`, 'observe');
          try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
          await detachDebugger(tabId);
          tabId = newTabId;
          await setAgentState({ tabId });
          await chrome.tabs.update(tabId, { active: true });
          await waitForTabLoad(tabId);
          await ensureContentScript(tabId);
          await sendToTab(tabId, { type: 'BLOCK_INPUT' });
          await appendConversationTurn(
            sessionId,
            'user',
            `[Step ${step}] Clicked #${uiAction.targetId} ("${target.text}") → opened new tab. Task: ${userPrompt}`,
          );
        } else if (actError) {
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
          await appendConversationTurn(
            sessionId,
            'user',
            `[ACTION FAILED - Step ${step}] Clicking element #${uiAction.targetId} ("${target.text}") failed: "${actError}". Task: ${userPrompt}`,
          );
        } else {
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
          await appendConversationTurn(
            sessionId,
            'user',
            `[Step ${step}] Clicked element #${uiAction.targetId} ("${target.text}"). Task: ${userPrompt}`,
          );
        }

        await sleep(STEP_DELAY_MS);

        if (done) {
          await logFinishSummary(actions);
          await log('Task complete!', 'observe');
          await setAgentState({ status: 'done' });
          break;
        }
      }
    }
  } catch (err) {
    await log(`Unhandled agent error: ${(err as Error).message}`, 'error');
    await setAgentState({ status: 'error' });
  } finally {
    try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
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
      await chrome.debugger.sendCommand({ tabId }, 'Page.setInterceptFileChooserDialog', { enabled: false });
    } catch { /* */ }
    await detachDebugger(tabId);
    try { await clearVFSFiles(sessionId, [TODO_VFS_FILENAME]); } catch { /* */ }
    chrome.runtime.sendMessage({ type: 'AGENT_STATE_CHANGE' }).catch(() => {});
  }
}
