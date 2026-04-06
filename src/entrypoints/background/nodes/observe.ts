/**
 * Graph nodes: captureAndDestroy and reason.
 *
 * captureAndDestroy — takes an annotated screenshot, saves it to VFS, and
 *                     destroys the canvas overlay.
 * reason            — loads conversation history, calls the LLM, and stores the
 *                     resulting user/model turns in IndexedDB.
 */

import { appendConversationTurn, getConversationHistory, touchSession, saveVFSFile, listVFSFiles } from '@/utils/db';
import { callModel } from '@/utils/llm';
import type { InlineImage } from '@/utils/llm';
import type { RunnableConfig } from '@langchain/core/runnables';
import { log } from '@/utils/agent-log';
import { sendToTab } from '@/utils/tab-helpers';
import { captureScreenshot } from '@/utils/screenshot';
import { sleep } from '@/utils/sleep';
import type { AgentState } from '../agent-state';
import { RATE_LIMIT_DELAY_MS } from '../agent-state';

// ── Node: captureAndDestroy ───────────────────────────────────────────────────

export async function captureAndDestroyNode(state: AgentState): Promise<Partial<AgentState>> {
  let base64Image: string;
  try {
    base64Image = await captureScreenshot(state.tabId);
  } catch (snapErr) {
    await log(`Screenshot failed: ${(snapErr as Error).message}. Retrying step…`, 'warn');
    try { await sendToTab(state.tabId, { type: 'DESTROY_MARKS' }); } catch { /* */ }
    await appendConversationTurn(
      state.sessionId,
      'user',
      `[Step ${state.step}] Screenshot capture failed: "${(snapErr as Error).message}". The page may still be loading or navigating. Task: ${state.userPrompt}`,
    );
    await sleep(1000);
    return { retryStep: true };
  }

  await chrome.storage.session.set({ lastScreenshot: base64Image, lastScreenshotStep: state.step });
  await log('Screenshot captured — tap to preview', 'screenshot');
  await saveVFSFile(state.sessionId, `step_${state.step}.png`, base64Image, 'image/png');

  // Destroy overlay (harmless if no marks were drawn)
  try { await sendToTab(state.tabId, { type: 'DESTROY_MARKS' }); } catch { /* */ }

  // Inline images on step 1 only (user-attached reference images)
  const inlineImages: InlineImage[] =
    state.step === 1 && state.attachments?.length
      ? state.attachments
          .filter((a) => a.mimeType.startsWith('image/'))
          .map(({ name, mimeType, data }) => ({ name, mimeType, data }))
      : [];

  return { base64Image, inlineImages, retryStep: false };
}

// ── Node: reason ──────────────────────────────────────────────────────────────

export async function reasonNode(state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> {
  const history = await getConversationHistory(state.sessionId);
  const vfsFiles = await listVFSFiles(state.sessionId);
  await log('Sending to LLM…', 'observe');

  // Adjust prompt when there are no interactable elements
  const prompt =
    state.coordinateMap.length === 0
      ? `${state.anchoredPrompt}\n\n[SYSTEM NOTE: No interactable elements detected. Decide whether to navigate, scroll, press a key, or call finish if the goal is already achieved. Do NOT call click — there are no annotated elements.]`
      : state.anchoredPrompt;

  // Broadcast thinking deltas to the sidebar for live streaming
  const onThinkingDelta = (delta: string) => {
    chrome.runtime.sendMessage({ type: 'AGENT_THINKING_DELTA', delta }).catch(() => {});
  };

  let result;
  try {
    result = await callModel(
      state.model,
      state.base64Image,
      prompt,
      history,
      log,
      vfsFiles,
      state.inlineImages,
      state.currentTodo,
      state.memoryEntries,
      state.scratchpadEntries,
      state.coordinateMap,
      config,
      onThinkingDelta,
    );
  } catch (err) {
    await log(`LLM call failed: ${(err as Error).message}. Will retry step.`, 'error');
    await sleep(RATE_LIMIT_DELAY_MS);
    return { llmFailed: true };
  }

  const { reasoning, thinking, actions, done, rawToolCalls } = result;
  // Signal thinking stream is complete so the sidebar finalizes the block
  if (thinking) chrome.runtime.sendMessage({ type: 'AGENT_THINKING_DONE' }).catch(() => {});
  if (reasoning) await log(reasoning, 'info');

  // Gemini requires a user turn immediately before a function-call turn
  await appendConversationTurn(state.sessionId, 'user', `[Step ${state.step}] Task: ${state.userPrompt}`);
  await appendConversationTurn(state.sessionId, 'model', reasoning || '', { toolCalls: rawToolCalls });
  await touchSession(state.sessionId);

  return { actions, rawToolCalls, reasoning: reasoning || '', done, llmFailed: false };
}
