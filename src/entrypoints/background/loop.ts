/**
 * Main agent loop — Think → Annotate → Capture → Reason → Act.
 */

import { appendConversationTurn, createSession, getConversationHistory, touchSession, saveVFSFile, writeVFSFile, listVFSFiles, clearVFSFiles, getVFSFile, deleteVFSFile } from '@/utils/db';
import { callModel, createModel } from '@/utils/llm';
import type { InlineImage } from '@/utils/llm';
import { loadTodoFromVFS, saveTodoToVFS, applyTodoUpdates, TODO_VFS_FILENAME } from '@/utils/todo';
import type { TodoItem } from '@/utils/types';
import { attachDebugger, detachDebugger, dispatchHardwareClick, getKeyCode, writeTempFile, cleanupTempFile } from '@/utils/cdp';
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

const MAX_STEPS = 20;
const STEP_DELAY_MS = 800;
const RATE_LIMIT_DELAY_MS = 10_000;
const MAX_EMPTY_RETRIES = 3;

export async function runAgentLoop(tabId: number, userPrompt: string, existingSessionId?: number, attachments?: AttachedFile[]): Promise<void> {
  // Create a new session or reuse an existing one for context continuity.
  const sessionId = existingSessionId ?? await createSession(userPrompt);
  await setAgentState({ status: 'running', tabId, step: 0, prompt: userPrompt, sessionId });

  // Seed any user-attached files into the VFS so Gemini can reference them.
  if (attachments?.length) {
    for (const file of attachments) {
      await saveVFSFile(sessionId, file.name, file.data, file.mimeType);
    }
    await log(`Loaded ${attachments.length} attached file(s) into VFS`, 'info');
  }

  // Load existing todo list when resuming an interrupted session.
  let currentTodo: TodoItem[] = (await loadTodoFromVFS(sessionId)) ?? [];
  if (currentTodo.length > 0) {
    await log(`Resumed todo list: ${currentTodo.length} item(s) loaded from VFS`, 'info');
  }

  await log(`Agent started`, 'observe');

  // ── File chooser guard ──────────────────────────────────────────────────────
  // Always-on interceptor: cancels any OS file dialog that opens during the
  // session. The agent never clicks upload buttons — it uses CDP
  // DOM.setFileInputFiles directly — but if a dialog opens by accident
  // (e.g. Gemini clicks a file button without uploadFileId), this guard
  // silently kills it so the user never sees an OS file picker.
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

    // If the active tab is on a restricted page, try to extract a URL from the prompt
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

    // Globally intercept file chooser dialogs for the entire session.
    // If a hardware click accidentally triggers one (e.g. Gemini clicks an upload
    // button without uploadFileId), we cancel it instead of letting the OS dialog
    // pop up and block the agent.
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

      // Re-enable file chooser interception every step — it gets lost when the
      // debugger detaches during navigation (which happens on navigateUrl actions).
      try {
        await attachDebugger(tabId);
        await chrome.debugger.sendCommand(
          { tabId },
          'Page.setInterceptFileChooserDialog',
          { enabled: true },
        );
      } catch { /* will be re-attached when needed */ }

      // Block file dialogs at the JS level for the entire session.
      // Page.setInterceptFileChooserDialog doesn't catch showOpenFilePicker
      // and is unreliable in extensions, so we monkey-patch at the JS level too.
      // Idempotent — safe to re-inject after navigation.
      try {
        await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: `(() => {
            if (window.__opticlick_fileBlock) return;

            // 1. Monkey-patch input.click() — catches programmatic triggers
            window.__opticlick_origClick = HTMLInputElement.prototype.click;
            HTMLInputElement.prototype.click = function() {
              if (this.type === 'file') {
                window.__opticlick_fileInput = this;
                return;
              }
              return window.__opticlick_origClick.call(this);
            };

            // 2. Block showOpenFilePicker (File System Access API)
            if (window.showOpenFilePicker) {
              window.__opticlick_origPicker = window.showOpenFilePicker;
              window.showOpenFilePicker = () =>
                Promise.reject(new DOMException('Aborted', 'AbortError'));
            }

            // 3. Capture-phase click listener — catches direct clicks on
            //    <input type="file">, <label for="...">, and <label> wrappers.
            //    preventDefault() blocks the dialog; event still propagates
            //    so site JS handlers run normally.
            window.__opticlick_clickGuard = (e) => {
              const el = e.target;
              if (el.tagName === 'INPUT' && el.type === 'file') {
                e.preventDefault();
                window.__opticlick_fileInput = el;
                return;
              }
              const label = el.closest ? el.closest('label') : null;
              if (label) {
                const forId = label.getAttribute('for');
                let inp = forId ? document.getElementById(forId) : null;
                if (!inp) inp = label.querySelector('input[type="file"]');
                if (inp && inp.tagName === 'INPUT' && inp.type === 'file') {
                  e.preventDefault();
                  window.__opticlick_fileInput = inp;
                  return;
                }
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
        // No interactable elements after retries — capture a plain screenshot and
        // let Gemini decide what to do (navigate, scroll, key, or declare done).
        await log('No interactable elements found after retries. Sending screenshot to Gemini for guidance…', 'warn');

        const plainScreenshot = await captureScreenshot(tabId);
        await chrome.storage.session.set({ lastScreenshot: plainScreenshot, lastScreenshotStep: step });
        await log('Screenshot captured — tap to preview', 'screenshot');

        const historyForEmpty = await getConversationHistory(sessionId);
        const vfsFilesForEmpty = await listVFSFiles(sessionId);
        await log('Sending to LLM…', 'observe');

        let emptyDecision;
        try {
          emptyDecision = await callModel(
            model,
            plainScreenshot,
            `${userPrompt}\n\n[SYSTEM NOTE: No interactable elements were detected on the current page after repeated attempts. Decide whether to navigate to a different URL, scroll to reveal content, press a key, or mark the task as done if the goal is already achieved. Do NOT set targetId — there are no annotated elements.]`,
            historyForEmpty,
            log,
            vfsFilesForEmpty,
          );
        } catch (err) {
          await log(`LLM call failed: ${(err as Error).message}. Giving up.`, 'error');
          break;
        }

        await log(emptyDecision.reasoning, 'think');
        await appendConversationTurn(sessionId, 'model', JSON.stringify(emptyDecision));
        await touchSession(sessionId);
        emptyRetries = 0;

        if (emptyDecision.done) {
          await log('Task complete!', 'observe');
          await setAgentState({ status: 'done' });
          break;
        }

        if (emptyDecision.navigateUrl) {
          await log(`Navigating to: ${emptyDecision.navigateUrl}`, 'act');
          try {
            try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
            await detachDebugger(tabId);
            await chrome.tabs.update(tabId, { url: emptyDecision.navigateUrl });
            await waitForTabLoad(tabId, 15_000, true);
            await ensureContentScript(tabId);
            await sendToTab(tabId, { type: 'BLOCK_INPUT' });
            await appendConversationTurn(sessionId, 'user', `[Step ${step}] Navigated to ${emptyDecision.navigateUrl}. Task: ${userPrompt}`);
          } catch (navErr) {
            await log(`Navigation failed: ${(navErr as Error).message}`, 'warn');
            await appendConversationTurn(sessionId, 'user', `[ACTION FAILED - Step ${step}] Navigation to "${emptyDecision.navigateUrl}" failed: "${(navErr as Error).message}". Task: ${userPrompt}`);
            try { await ensureContentScript(tabId); } catch { /* */ }
            try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
          }
          await sleep(STEP_DELAY_MS);
          continue;
        }

        if (emptyDecision.scroll) {
          const isVert = emptyDecision.scroll === 'up' || emptyDecision.scroll === 'down';
          const sign = emptyDecision.scroll === 'up' || emptyDecision.scroll === 'left' ? -1 : 1;
          const label = `Scrolling page ${emptyDecision.scroll}`;
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
          await sleep(STEP_DELAY_MS);
          continue;
        }

        if (emptyDecision.pressKey) {
          await log(`Pressing key: ${emptyDecision.pressKey}`, 'act');
          try {
            try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
            await attachDebugger(tabId);
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'rawKeyDown', key: emptyDecision.pressKey, windowsVirtualKeyCode: getKeyCode(emptyDecision.pressKey),
            });
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'keyUp', key: emptyDecision.pressKey, windowsVirtualKeyCode: getKeyCode(emptyDecision.pressKey),
            });
            if (emptyDecision.pressKey === 'Enter' || emptyDecision.pressKey === 'Return') {
              await sleep(600);
              await waitForTabLoad(tabId, 10_000, false);
              await ensureContentScript(tabId);
            }
            try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
            await appendConversationTurn(sessionId, 'user', `[Step ${step}] Pressed key "${emptyDecision.pressKey}". Task: ${userPrompt}`);
          } catch (keyErr) {
            await log(`Key press failed: ${(keyErr as Error).message}`, 'warn');
          }
          await sleep(STEP_DELAY_MS);
          continue;
        }

        await log('Gemini could not determine a next action. Giving up.', 'error');
        break;
      }
      emptyRetries = 0;

      await chrome.storage.session.set({ coordinateMap });

      // 3. Capture annotated screenshot
      const base64Image = await captureScreenshot(tabId);
      // Store for popup preview, keyed to current step
      await chrome.storage.session.set({ lastScreenshot: base64Image, lastScreenshotStep: step });
      await log('Screenshot captured — tap to preview', 'screenshot');

      // Save screenshot to the virtual filesystem so the agent can upload it later
      await saveVFSFile(sessionId, `step_${step}.png`, base64Image, 'image/png');

      // 4. Destroy overlay
      await sendToTab(tabId, { type: 'DESTROY_MARKS' });

      // 5. Fetch conversation history for this session
      const history = await getConversationHistory(sessionId);

      // 6. Call LLM — thinking tokens are logged as [THINK] inside callModel
      await log('Sending to LLM…', 'observe');
      const vfsFiles = await listVFSFiles(sessionId);

      // On the first step, pass user-attached images inline so Gemini can see them
      const inlineImages: InlineImage[] = step === 1 && attachments?.length
        ? attachments
            .filter((a) => a.mimeType.startsWith('image/'))
            .map(({ name, mimeType, data }) => ({ name, mimeType, data }))
        : [];

      let decision;
      try {
        decision = await callModel(model, base64Image, userPrompt, history, log, vfsFiles, inlineImages, currentTodo);
      } catch (err) {
        await log(
          `LLM call failed: ${(err as Error).message}. Will retry step.`,
          'error',
        );
        await sleep(RATE_LIMIT_DELAY_MS);
        continue;
      }

      // Log the model's reasoning conclusion
      await log(decision.reasoning, 'think');
      await appendConversationTurn(sessionId, 'model', JSON.stringify(decision));
      await touchSession(sessionId);

      // 7. Execute VFS mutations requested by Gemini (before any UI action)
      const vfsMutations: string[] = [];

      if (decision.vfsSaveScreenshot) {
        const fname = decision.vfsSaveScreenshot.trim() || `step_${step}.png`;
        const saved = await writeVFSFile(sessionId, fname, base64Image, 'image/png');
        vfsMutations.push(`Saved screenshot as "${saved.name}" (id: ${saved.id})`);
        await log(`VFS: saved screenshot → "${saved.name}"`, 'act');
      }

      if (decision.vfsWrite) {
        const { name, content, mimeType = 'text/plain' } = decision.vfsWrite;
        const base64Content = btoa(unescape(encodeURIComponent(content)));
        const saved = await writeVFSFile(sessionId, name, base64Content, mimeType);
        vfsMutations.push(`Wrote "${saved.name}" (${saved.size} B, id: ${saved.id})`);
        await log(`VFS: wrote "${saved.name}" (${saved.size} B)`, 'act');
      }

      if (decision.vfsDelete) {
        await deleteVFSFile(decision.vfsDelete);
        vfsMutations.push(`Deleted VFS file ${decision.vfsDelete}`);
        await log(`VFS: deleted file ${decision.vfsDelete}`, 'act');
      }

      if (decision.vfsDownload) {
        const { url, name: nameHint } = decision.vfsDownload;
        await log(`VFS: downloading ${url}`, 'act');
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
          const mimeType = resp.headers.get('Content-Type')?.split(';')[0].trim()
            ?? 'application/octet-stream';
          const filename = filenameFromResponse(resp.clone(), url, nameHint);
          const base64 = arrayBufferToBase64(await resp.arrayBuffer());
          const saved = await writeVFSFile(sessionId, filename, base64, mimeType);
          vfsMutations.push(`Downloaded "${saved.name}" (${saved.size} B, id: ${saved.id})`);
          await log(`VFS: downloaded → "${saved.name}" (${saved.size} B)`, 'act');
        } catch (dlErr) {
          const msg = (dlErr as Error).message;
          vfsMutations.push(`Download failed: ${msg}`);
          await log(`VFS: download failed — ${msg}`, 'warn');
        }
      }

      // 7b. Process todo mutations (create / update)
      if (decision.todoCreate?.length) {
        currentTodo = decision.todoCreate;
        await saveTodoToVFS(sessionId, currentTodo);
        await log(`Todo: created plan with ${currentTodo.length} item(s)`, 'info');
      }
      if (decision.todoUpdate?.length) {
        currentTodo = applyTodoUpdates(currentTodo, decision.todoUpdate);
        await saveTodoToVFS(sessionId, currentTodo);
        const summary = decision.todoUpdate
          .map((u) => `${u.id}→${u.status ?? 'note'}`)
          .join(', ');
        await log(`Todo updated: ${summary}`, 'info');
      }

      // DOM inspection — Gemini asked for the outer HTML of a specific element
      if (decision.fetchDOM != null) {
        const domTarget = coordinateMap.find((c: CoordinateEntry) => c.id === decision.fetchDOM);
        if (domTarget) {
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
        } else {
          await log(`fetchDOM — element #${decision.fetchDOM} not in coordinate map`, 'warn');
        }
      }

      // 8. If done with no further UI action (VFS-only turn is valid), finish
      const hasUIAction =
        decision.targetId != null ||
        decision.navigateUrl ||
        decision.scroll ||
        decision.pressKey;
      const hasFinalAction = hasUIAction || vfsMutations.length > 0 || decision.fetchDOM != null;

      if (decision.done && !hasFinalAction) {
        await log('Task complete!', 'observe');
        await setAgentState({ status: 'done' });
        break;
      }

      // If Gemini only wanted VFS mutations / DOM inspection this turn (no UI action), log and continue
      if (!hasUIAction && (vfsMutations.length > 0 || decision.fetchDOM != null)) {
        await appendConversationTurn(
          sessionId,
          'user',
          `[Step ${step}] VFS operations: ${vfsMutations.join('; ')}. Task: ${userPrompt}`,
        );
        if (decision.done) {
          await log('Task complete!', 'observe');
          await setAgentState({ status: 'done' });
          break;
        }
        await sleep(STEP_DELAY_MS);
        continue;
      }

      // 8a. Handle URL navigation
      if (decision.navigateUrl) {
        await log(`Navigating to: ${decision.navigateUrl}`, 'act');
        try {
          try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
          await detachDebugger(tabId);
          await chrome.tabs.update(tabId, { url: decision.navigateUrl });
          await waitForTabLoad(tabId, 15_000, true);
          await ensureContentScript(tabId);
          await sendToTab(tabId, { type: 'BLOCK_INPUT' });
          await appendConversationTurn(
            sessionId,
            'user',
            `[Step ${step}] Navigated to ${decision.navigateUrl}. Task: ${userPrompt}`,
          );
        } catch (actErr) {
          const errMsg = (actErr as Error).message;
          await log(`Navigation to ${decision.navigateUrl} failed: ${errMsg}`, 'warn');
          await appendConversationTurn(
            sessionId,
            'user',
            `[ACTION FAILED - Step ${step}] Navigation to "${decision.navigateUrl}" failed with error: "${errMsg}". The page state is unknown. Look at the new screenshot carefully and decide on a different approach. Task: ${userPrompt}`,
          );
          try { await ensureContentScript(tabId); } catch { /* */ }
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        }
        await sleep(STEP_DELAY_MS);
        continue;
      }

      // 8b. Handle scroll
      if (decision.scroll) {
        const isVertical = decision.scroll === 'up' || decision.scroll === 'down';
        const sign = decision.scroll === 'up' || decision.scroll === 'left' ? -1 : 1;
        const deltaX = isVertical ? 0 : sign * 500;
        const deltaY = isVertical ? sign * 500 : 0;

        let scrollX = 600;
        let scrollY = 400;

        if (decision.scrollTargetId != null) {
          const scrollTarget = coordinateMap.find(
            (c: CoordinateEntry) => c.id === decision.scrollTargetId,
          );
          if (scrollTarget) {
            scrollX = scrollTarget.rect.x;
            scrollY = scrollTarget.rect.y;
          }
        }

        const label = decision.scrollTargetId
          ? `Scrolling ${decision.scroll} inside element #${decision.scrollTargetId}`
          : `Scrolling page ${decision.scroll}`;
        await log(`${label}`, 'act');

        try {
          try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
          await attachDebugger(tabId);
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: scrollX,
            y: scrollY,
            deltaX,
            deltaY,
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
            `[ACTION FAILED - Step ${step}] Scroll action ("${label}") failed with error: "${errMsg}". Look at the new screenshot and decide on a different approach. Task: ${userPrompt}`,
          );
          try { await ensureContentScript(tabId); } catch { /* */ }
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        }
        await sleep(STEP_DELAY_MS);
        continue;
      }

      // 8c. Handle standalone pressKey (no click target)
      if (decision.pressKey && decision.targetId == null) {
        await log(`Pressing key: ${decision.pressKey}`, 'act');
        try {
          try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
          await attachDebugger(tabId);
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'rawKeyDown',
            key: decision.pressKey,
            windowsVirtualKeyCode: getKeyCode(decision.pressKey),
          });
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: decision.pressKey,
            windowsVirtualKeyCode: getKeyCode(decision.pressKey),
          });
          // Enter/Return may trigger a form submit / navigation — wait for the tab to settle
          if (decision.pressKey === 'Enter' || decision.pressKey === 'Return') {
            await sleep(600);
            await waitForTabLoad(tabId, 10_000, false);
            await ensureContentScript(tabId);
          }
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
          await appendConversationTurn(
            sessionId,
            'user',
            `[Step ${step}] Pressed key "${decision.pressKey}". Task: ${userPrompt}`,
          );
        } catch (actErr) {
          const errMsg = (actErr as Error).message;
          await log(`Key press "${decision.pressKey}" failed: ${errMsg}`, 'warn');
          await appendConversationTurn(
            sessionId,
            'user',
            `[ACTION FAILED - Step ${step}] Pressing key "${decision.pressKey}" failed with error: "${errMsg}". The page may have navigated to an error page or crashed. Look at the new screenshot carefully and decide on a different approach. Task: ${userPrompt}`,
          );
          // Try to recover — the tab may have navigated somewhere
          await waitForTabLoad(tabId, 10_000, false);
          try { await ensureContentScript(tabId); } catch { /* */ }
          try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        }
        await sleep(STEP_DELAY_MS);
        continue;
      }

      if (decision.targetId == null) {
        await log('No actionable response from LLM. Retrying step…', 'warn');
        continue;
      }

      // 9. Resolve target coordinates
      const target = coordinateMap.find(
        (c: CoordinateEntry) => c.id === decision.targetId,
      );
      if (!target) {
        const errMsg = `Target ID ${decision.targetId} was not found in the coordinate map — the element may have disappeared or the page changed since the screenshot was taken.`;
        await log(errMsg, 'warn');
        await appendConversationTurn(
          sessionId,
          'user',
          `[ACTION FAILED - Step ${step}] ${errMsg} Look at the new screenshot carefully and choose a valid element ID from the current page. Task: ${userPrompt}`,
        );
        await sleep(STEP_DELAY_MS);
        continue;
      }

      await log(
        `Clicking element #${target.id} "${target.text}" at (${target.rect.x}, ${target.rect.y})`,
        'act',
      );

      // Listen for new tabs opened by the click
      let newTabId: number | null = null;
      const newTabListener = (tab: chrome.tabs.Tab) => {
        if (tab.openerTabId === tabId) newTabId = tab.id ?? null;
      };
      chrome.tabs.onCreated.addListener(newTabListener);

      let actError: string | null = null;
      try {
        // 10. If the target is a file input with a VFS file to upload, skip hardware
        //     click and instead inject the file programmatically via the content script.
        if (decision.uploadFileId && target) {
          // Resolve by UUID first, then fall back to filename
          let vfsFile = await getVFSFile(decision.uploadFileId);
          if (!vfsFile) {
            const allFiles = await listVFSFiles(sessionId);
            vfsFile = allFiles.find((f) => f.name === decision.uploadFileId);
          }
          if (!vfsFile) {
            throw new Error(`VFS file "${decision.uploadFileId}" not found by ID or name.`);
          }
          await log(`Uploading "${vfsFile.name}" → element #${target.id}`, 'act');

          // The JS-level file dialog block is already installed at the top of
          // each step. It captures any input.click() for type=file into
          // window.__opticlick_fileInput. We just click the button, then set
          // files on the captured input.
          const tempDl = await writeTempFile(vfsFile.data, vfsFile.name, vfsFile.mimeType);

          try {
            // Clear any stale captured input from a previous click
            await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
              expression: `window.__opticlick_fileInput = null`,
            });

            // Click the upload button — site JS runs, creates input, but
            // our override blocks the dialog and captures the input reference.
            try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
            await dispatchHardwareClick(tabId, target.rect.x, target.rect.y);
            await sleep(500);

            // Set files on the captured input (or first input in DOM as fallback)
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
          await dispatchHardwareClick(tabId, target.rect.x, target.rect.y);
        }

        // Type text if requested
        if (decision.typeText) {
          await log(`Typing: "${decision.typeText}"`, 'act');
          await sleep(200);
          for (const char of decision.typeText) {
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'keyDown',
              text: char,
            });
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'keyUp',
              text: char,
            });
            await sleep(30);
          }
        }

        // 10b. Press key after click+type (e.g. Enter to submit)
        if (decision.pressKey) {
          await log(`Pressing key: ${decision.pressKey}`, 'act');
          await sleep(100);
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'rawKeyDown',
            key: decision.pressKey,
            windowsVirtualKeyCode: getKeyCode(decision.pressKey),
          });
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: decision.pressKey,
            windowsVirtualKeyCode: getKeyCode(decision.pressKey),
          });
          // Enter/Return may trigger navigation — wait for the tab to settle
          if (decision.pressKey === 'Enter' || decision.pressKey === 'Return') {
            await sleep(600);
            await waitForTabLoad(tabId, 10_000, false);
            await ensureContentScript(tabId);
          }
        }
      } catch (actErr_) {
        actError = (actErr_ as Error).message;
        await log(`Action on #${target.id} failed: ${actError}`, 'warn');
        // Try to recover from any mid-action navigation or frame crash
        await waitForTabLoad(tabId, 10_000, false);
        try { await ensureContentScript(tabId); } catch { /* */ }
      }

      await sleep(500);
      chrome.tabs.onCreated.removeListener(newTabListener);

      // 11. Follow new tab if opened
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
          `[Step ${step}] Clicked #${decision.targetId} ("${target.text}") → opened new tab. Task: ${userPrompt}`,
        );
      } else if (actError) {
        try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        await appendConversationTurn(
          sessionId,
          'user',
          `[ACTION FAILED - Step ${step}] Clicking element #${decision.targetId} ("${target.text}") failed with error: "${actError}". The page may have navigated or crashed. Look at the new screenshot carefully and decide on a different approach. Task: ${userPrompt}`,
        );
      } else {
        try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        await appendConversationTurn(
          sessionId,
          'user',
          `[Step ${step}] Clicked element #${decision.targetId} ("${target.text}"). Task: ${userPrompt}`,
        );
      }

      await sleep(STEP_DELAY_MS);

      if (decision.done) {
        await log('Task complete!', 'observe');
        await setAgentState({ status: 'done' });
        break;
      }
    }
  } catch (err) {
    await log(`Unhandled agent error: ${(err as Error).message}`, 'error');
    await setAgentState({ status: 'error' });
  } finally {
    try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
    // Restore monkey-patched functions so the page works normally after session
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: `(() => {
          if (window.__opticlick_origClick) {
            HTMLInputElement.prototype.click = window.__opticlick_origClick;
          }
          if (window.__opticlick_origPicker) {
            window.showOpenFilePicker = window.__opticlick_origPicker;
          }
          if (window.__opticlick_clickGuard) {
            document.removeEventListener('click', window.__opticlick_clickGuard, { capture: true });
          }
          delete window.__opticlick_origClick;
          delete window.__opticlick_origPicker;
          delete window.__opticlick_clickGuard;
          delete window.__opticlick_fileInput;
          delete window.__opticlick_fileBlock;
        })()`,
      });
    } catch { /* */ }
    // Remove the CDP file chooser guard
    chrome.debugger.onEvent.removeListener(fileChooserGuard);
    try {
      await chrome.debugger.sendCommand(
        { tabId },
        'Page.setInterceptFileChooserDialog',
        { enabled: false },
      );
    } catch { /* */ }
    await detachDebugger(tabId);
    // Garbage-collect all VFS files created during this session.
    // Preserve __todo.json so interrupted sessions can resume with the original plan.
    try { await clearVFSFiles(sessionId, [TODO_VFS_FILENAME]); } catch { /* */ }
    chrome.runtime.sendMessage({ type: 'AGENT_STATE_CHANGE' }).catch(() => {});
  }
}
