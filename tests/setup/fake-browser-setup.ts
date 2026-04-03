import { fakeBrowser } from 'wxt/testing';
import { beforeEach } from 'vitest';

// Installs fakeBrowser as globalThis.chrome so agent-state.ts and other modules
// that call chrome.storage.session.* work without a real browser.
// fakeBrowser.storage.session is fully implemented (get/set/remove/clear/onChanged).
beforeEach(() => {
  fakeBrowser.reset();
  (globalThis as Record<string, unknown>).chrome = fakeBrowser;
  (globalThis as Record<string, unknown>).browser = fakeBrowser;
});
