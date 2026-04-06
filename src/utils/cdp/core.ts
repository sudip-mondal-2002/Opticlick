/** CDP debugger attach/detach with per-tab caching. */

const attachedDebuggers = new Set<number>();

export async function attachDebugger(tabId: number): Promise<void> {
  if (attachedDebuggers.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  attachedDebuggers.add(tabId);
}

export async function detachDebugger(tabId: number): Promise<void> {
  if (!attachedDebuggers.has(tabId)) return;
  try { await chrome.debugger.detach({ tabId }); } catch { /* tab may have closed */ }
  attachedDebuggers.delete(tabId);
}

/** @internal — test only. Clears the module-level attachedDebuggers Set. */
export function _resetAttachedDebuggers(): void {
  attachedDebuggers.clear();
}

// Auto-clean when Chrome detaches the debugger (tab closed / navigate)
if (typeof chrome !== 'undefined' && chrome?.debugger?.onDetach) {
  chrome.debugger.onDetach.addListener(({ tabId }) => {
    if (tabId != null) attachedDebuggers.delete(tabId);
  });
}
