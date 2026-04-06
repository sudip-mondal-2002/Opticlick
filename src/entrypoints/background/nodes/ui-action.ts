/**
 * Graph node: uiAction.
 *
 * Executes the single UI action (click, type, navigate, scroll, press_key)
 * returned by the LLM. When a click opens a new tab, the mutable tabIdRef is
 * updated so the file-chooser guard in loop.ts always intercepts the right tab.
 */

import {
  appendConversationTurn,
  getVFSFile,
  listVFSFiles,
} from '@/utils/db';
import {
  attachDebugger,
  detachDebugger,
  dispatchHardwareClick,
  dispatchScrollWheel,
  typeTextCDP,
  CDP_MODIFIER,
  getKeyCode,
  writeTempFile,
  cleanupTempFile,
} from '@/utils/cdp';
import {
  shouldPivot,
  scrollDeltaIsSignificant,
  computeScrollDelta,
  MAX_PIVOT_RETRIES,
} from '@/utils/navigation-guard';
import { log } from '@/utils/agent-log';
import { setAgentState } from '@/utils/agent-state';
import {
  sendToTab,
  ensureContentScript,
  waitForTabLoad,
  retryTabUpdate,
} from '@/utils/tab-helpers';
import { sleep } from '@/utils/sleep';
import type { AgentState } from '../agent-state';
import { STEP_DELAY_MS, UI_ACTION_TYPES, UI_ACTION_TYPES_NO_CLICK } from '../agent-state';

// ── Helper: press a key via CDP ───────────────────────────────────────────────

async function pressKeyCDP(tabId: number, key: string, waitForNav: boolean): Promise<void> {
  await attachDebugger(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown', key, windowsVirtualKeyCode: getKeyCode(key),
  });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'keyUp', key, windowsVirtualKeyCode: getKeyCode(key),
  });
  if (waitForNav) {
    await sleep(600);
    await waitForTabLoad(tabId, 10_000, false);
    await ensureContentScript(tabId);
  }
}

// ── Node: uiAction ────────────────────────────────────────────────────────────

export async function uiActionNode(
  state: AgentState,
  tabIdRef: { current: number },
): Promise<Partial<AgentState>> {
  const { actions, rawToolCalls, sessionId, userPrompt, step, coordinateMap } = state;
  let { tabId } = state;
  const noElements = coordinateMap.length === 0;

  const uiAction = actions.find((a) =>
    noElements ? UI_ACTION_TYPES_NO_CLICK.has(a.type) : UI_ACTION_TYPES.has(a.type),
  );

  if (!uiAction) {
    await log('No actionable UI response from LLM. Retrying step…', 'warn');
    return { tabId };
  }

  const uiActionIdx = actions.findIndex((a) => a === uiAction);
  const uiToolCallId = rawToolCalls[uiActionIdx]?.id ?? '';
  const uiToolName = rawToolCalls[uiActionIdx]?.name ?? uiAction.type;

  // ── Navigate ──────────────────────────────────────────────────────────────────
  if (uiAction.type === 'navigate') {
    await log(`Navigating to: ${uiAction.url}`, 'act');
    try {
      try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
      await detachDebugger(tabId);
      await retryTabUpdate(tabId, { url: uiAction.url });
      await waitForTabLoad(tabId, 15_000, true);
      await ensureContentScript(tabId);
      await sendToTab(tabId, { type: 'BLOCK_INPUT' });
      await appendConversationTurn(
        sessionId, 'tool',
        `[Step ${step}] Navigated to ${uiAction.url}. Task: ${userPrompt}`,
        { toolCallId: uiToolCallId, toolName: uiToolName },
      );
    } catch (actErr) {
      const errMsg = (actErr as Error).message;
      await log(`Navigation to ${uiAction.url} failed: ${errMsg}`, 'warn');
      await appendConversationTurn(
        sessionId, 'tool',
        `[ACTION FAILED - Step ${step}] Navigation to "${uiAction.url}" failed: "${errMsg}". Task: ${userPrompt}`,
        { toolCallId: uiToolCallId, toolName: uiToolName },
      );
      try { await ensureContentScript(tabId); } catch { /* */ }
      try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
    }
    await sleep(STEP_DELAY_MS);
    return { tabId };
  }

  // ── Scroll ────────────────────────────────────────────────────────────────────
  if (uiAction.type === 'scroll') {
    const scrollTargetId = uiAction.scrollTargetId;

    if (shouldPivot(state.actionHistory, 'scroll', scrollTargetId)) {
      await log(`Scroll pivot: same scroll repeated ${MAX_PIVOT_RETRIES} times with no progress.`, 'warn');
      await appendConversationTurn(
        sessionId, 'tool',
        `[PIVOT REQUIRED - Step ${step}] This scroll has been attempted ${MAX_PIVOT_RETRIES} times with no progress. Try a different approach. Task: ${userPrompt}`,
        { toolCallId: uiToolCallId, toolName: uiToolName },
      );
    } else {
      const { deltaX, deltaY } = computeScrollDelta(uiAction.direction);
      let scrollX = 600, scrollY = 400;
      if (scrollTargetId != null) {
        const scrollTarget = coordinateMap.find((c) => c.id === scrollTargetId);
        if (scrollTarget) { scrollX = scrollTarget.rect.x; scrollY = scrollTarget.rect.y; }
      }
      const label = scrollTargetId
        ? `Scrolling ${uiAction.direction} inside element #${scrollTargetId}`
        : `Scrolling page ${uiAction.direction}`;
      await log(label, 'act');

      try {
        try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
        await attachDebugger(tabId);
        let beforeY = 0, afterY = 0;
        try {
          const r = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
            expression: 'window.scrollY', returnByValue: true,
          }) as { result: { value: number } };
          beforeY = r?.result?.value ?? 0;
        } catch { /* */ }
        await dispatchScrollWheel(tabId, scrollX, scrollY, deltaX, deltaY);
        await sleep(300);
        try {
          const r = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
            expression: 'window.scrollY', returnByValue: true,
          }) as { result: { value: number } };
          afterY = r?.result?.value ?? 0;
        } catch { /* */ }
        const feedback = scrollDeltaIsSignificant(beforeY, afterY)
          ? label
          : `${label} — page did not move (already at limit or content not scrollable)`;
        try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
        await appendConversationTurn(
          sessionId, 'tool',
          `[Step ${step}] ${feedback}. Task: ${userPrompt}`,
          { toolCallId: uiToolCallId, toolName: uiToolName },
        );
      } catch (actErr) {
        const errMsg = (actErr as Error).message;
        await log(`Scroll failed: ${errMsg}`, 'warn');
        await appendConversationTurn(
          sessionId, 'tool',
          `[ACTION FAILED - Step ${step}] Scroll failed: "${errMsg}". Task: ${userPrompt}`,
          { toolCallId: uiToolCallId, toolName: uiToolName },
        );
        try { await ensureContentScript(tabId); } catch { /* */ }
        try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
      }
    }

    await sleep(STEP_DELAY_MS);
    return {
      tabId,
      actionHistory: [...state.actionHistory, { type: 'scroll', targetId: scrollTargetId }],
    };
  }

  // ── Type ──────────────────────────────────────────────────────────────────────
  if (uiAction.type === 'type') {
    await log(`Typing: "${uiAction.text}"`, 'act');
    try {
      try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
      await typeTextCDP(tabId, uiAction.text, uiAction.clearField ?? false);
      try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
      await appendConversationTurn(
        sessionId, 'tool',
        `[Step ${step}] Typed: "${uiAction.text}". Task: ${userPrompt}`,
        { toolCallId: uiToolCallId, toolName: uiToolName },
      );
    } catch (actErr) {
      const errMsg = (actErr as Error).message;
      await log(`Typing failed: ${errMsg}`, 'warn');
      await appendConversationTurn(
        sessionId, 'tool',
        `[ACTION FAILED - Step ${step}] Typing "${uiAction.text}" failed: "${errMsg}". Task: ${userPrompt}`,
        { toolCallId: uiToolCallId, toolName: uiToolName },
      );
      try { await ensureContentScript(tabId); } catch { /* */ }
      try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
    }
    await sleep(STEP_DELAY_MS);
    return { tabId };
  }

  // ── Press key ─────────────────────────────────────────────────────────────────
  if (uiAction.type === 'press_key') {
    await log(`Pressing key: ${uiAction.key}`, 'act');
    try {
      try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
      await pressKeyCDP(tabId, uiAction.key, uiAction.key === 'Enter' || uiAction.key === 'Return');
      try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
      await appendConversationTurn(
        sessionId, 'tool',
        `[Step ${step}] Pressed key "${uiAction.key}". Task: ${userPrompt}`,
        { toolCallId: uiToolCallId, toolName: uiToolName },
      );
    } catch (actErr) {
      const errMsg = (actErr as Error).message;
      await log(`Key press "${uiAction.key}" failed: ${errMsg}`, 'warn');
      await appendConversationTurn(
        sessionId, 'tool',
        `[ACTION FAILED - Step ${step}] Pressing key "${uiAction.key}" failed: "${errMsg}". Task: ${userPrompt}`,
        { toolCallId: uiToolCallId, toolName: uiToolName },
      );
      await waitForTabLoad(tabId, 10_000, false);
      try { await ensureContentScript(tabId); } catch { /* */ }
      try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
    }
    await sleep(STEP_DELAY_MS);
    return { tabId };
  }

  // ── Click ─────────────────────────────────────────────────────────────────────
  if (uiAction.type === 'click') {
    const target = coordinateMap.find((c) => c.id === uiAction.targetId);
    if (!target) {
      const errMsg = `Target ID ${uiAction.targetId} not found in coordinate map — element may have disappeared.`;
      await log(errMsg, 'warn');
      await appendConversationTurn(
        sessionId, 'tool',
        `[ACTION FAILED - Step ${step}] ${errMsg} Choose a valid element ID. Task: ${userPrompt}`,
        { toolCallId: uiToolCallId, toolName: uiToolName },
      );
      await sleep(STEP_DELAY_MS);
      return { tabId };
    }

    await log(`Clicking element #${target.id} "${target.text}" at (${target.rect.x}, ${target.rect.y})`, 'act');

    let newTabId: number | null = null;
    const newTabListener = (tab: chrome.tabs.Tab) => {
      if (tab.openerTabId === tabId) newTabId = tab.id ?? null;
    };
    chrome.tabs.onCreated.addListener(newTabListener);

    let actError: string | null = null;
    try {
      if (uiAction.uploadFileId) {
        // ── File upload: HTML5 drag-drop + CDP fallback ───────────────────────
        let vfsFile = await getVFSFile(uiAction.uploadFileId);
        if (!vfsFile) {
          const allFiles = await listVFSFiles(sessionId);
          vfsFile = allFiles.find((f) => f.name === uiAction.uploadFileId);
        }
        if (!vfsFile) throw new Error(`VFS file "${uiAction.uploadFileId}" not found.`);
        await log(`Uploading "${vfsFile.name}" → element #${target.id}`, 'act');

        const { x, y } = target.rect;

        // Phase 1: HTML5 drag-drop
        await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: `window.__oc_dd={b:${JSON.stringify(vfsFile.data)},n:${JSON.stringify(vfsFile.name)},t:${JSON.stringify(vfsFile.mimeType)}}`,
        });
        await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: `(function(){
            var d=window.__oc_dd; delete window.__oc_dd; if(!d) return;
            try {
              var bytes=Uint8Array.from(atob(d.b),function(c){return c.charCodeAt(0);});
              var file=new File([bytes],d.n,{type:d.t});
              var dt=new DataTransfer(); dt.items.add(file);
              function drag(el){
                ['dragenter','dragover','drop'].forEach(function(ev){
                  el.dispatchEvent(new DragEvent(ev,{dataTransfer:dt,bubbles:true,cancelable:true}));
                });
              }
              var tgt=document.elementFromPoint(${x},${y});
              if(tgt) drag(tgt);
              var inp=window.__opticlick_fileInput||document.querySelector('input[type="file"]');
              if(inp&&inp!==tgt) drag(inp);
            } catch(e){}
          })()`,
        });
        await sleep(300);

        // Phase 2: CDP fallback for <input type="file"> that ignored the drop
        const tempDl = await writeTempFile(vfsFile.data, vfsFile.name, vfsFile.mimeType);
        try {
          const inputEval = (await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
            expression: `(function(){
              var inp=window.__opticlick_fileInput||document.querySelector('input[type="file"]');
              return (inp&&inp.files&&inp.files.length===0)?inp:null;
            })()`,
          })) as { result: { objectId?: string; subtype?: string } };
          const objectId = inputEval?.result?.objectId;
          if (objectId && inputEval.result.subtype !== 'null') {
            await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', {
              objectId, files: [tempDl.filePath],
            });
            await log('Uploaded via drag-drop + CDP fallback', 'act');
          } else {
            await log('Uploaded via drag-drop', 'act');
          }
        } finally {
          await cleanupTempFile(tempDl.downloadId);
        }
      } else {
        // ── Regular hardware click ────────────────────────────────────────────
        try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
        const modBitmask = uiAction.modifier ? (CDP_MODIFIER[uiAction.modifier] ?? 0) : 0;
        // Disable file inputs to prevent OS file picker from opening
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
    } catch (actErr_) {
      actError = (actErr_ as Error).message;
      await log(`Action on #${target.id} failed: ${actError}`, 'warn');
      await waitForTabLoad(tabId, 10_000, false);
      try { await ensureContentScript(tabId); } catch { /* */ }
    }

    await sleep(500);
    chrome.tabs.onCreated.removeListener(newTabListener);

    if (newTabId) {
      await log('Click opened new tab. Following it.', 'observe');
      try { await sendToTab(tabId, { type: 'UNBLOCK_INPUT' }); } catch { /* */ }
      await detachDebugger(tabId);
      tabId = newTabId;
      tabIdRef.current = tabId;
      await setAgentState({ tabId });
      await retryTabUpdate(tabId, { active: true });
      await waitForTabLoad(tabId);
      await ensureContentScript(tabId);
      await sendToTab(tabId, { type: 'BLOCK_INPUT' });
      await appendConversationTurn(
        sessionId, 'tool',
        `[Step ${step}] Clicked #${uiAction.targetId} ("${target.text}") → opened new tab. Task: ${userPrompt}`,
        { toolCallId: uiToolCallId, toolName: uiToolName },
      );
    } else if (actError) {
      try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
      await appendConversationTurn(
        sessionId, 'tool',
        `[ACTION FAILED - Step ${step}] Clicking element #${uiAction.targetId} ("${target.text}") failed: "${actError}". Task: ${userPrompt}`,
        { toolCallId: uiToolCallId, toolName: uiToolName },
      );
    } else {
      try { await sendToTab(tabId, { type: 'BLOCK_INPUT' }); } catch { /* */ }
      await appendConversationTurn(
        sessionId, 'tool',
        `[Step ${step}] Clicked element #${uiAction.targetId} ("${target.text}"). Task: ${userPrompt}`,
        { toolCallId: uiToolCallId, toolName: uiToolName },
      );
    }

    await sleep(STEP_DELAY_MS);
    return { tabId };
  }

  return { tabId };
}
