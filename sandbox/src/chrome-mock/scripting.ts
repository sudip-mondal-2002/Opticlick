/**
 * chrome.scripting shim
 *
 * executeScript → fetch the script file from the sandbox origin, then eval in iframe.
 * insertCSS / removeCSS → inject/remove <style> in iframe document.
 */

import { getIframe } from './tabs';

export const scriptingShim = {
  async executeScript(injection: chrome.scripting.ScriptInjection<unknown[], unknown>): Promise<chrome.scripting.InjectionResult<unknown>[]> {
    const win = getIframe()?.contentWindow;
    const doc = getIframe()?.contentDocument;
    if (!win || !doc) return [];

    if ('func' in injection && injection.func) {
      try {
        const args = (injection.args ?? []) as unknown[];
        const result = injection.func(...args);
        return [{ result, frameId: 0 }];
      } catch {
        return [];
      }
    }

    if ('files' in injection && injection.files?.length) {
      for (const file of injection.files) {
        try {
          // Fetch from the Vite dev server or built assets
          const resp = await fetch(file);
          const code = await resp.text();
          // Eval in iframe context using Function constructor
          const fn = new (win as any).Function(code);
          fn();
        } catch (e) {
          console.warn('[sandbox] scripting.executeScript failed for', file, e);
        }
      }
    }

    return [];
  },

  async insertCSS(injection: chrome.scripting.CSSInjection): Promise<void> {
    const doc = getIframe()?.contentDocument;
    if (!doc || !injection.css) return;
    const style = doc.createElement('style');
    style.setAttribute('data-opticlick-injected', 'true');
    style.textContent = injection.css;
    doc.head?.appendChild(style);
  },

  async removeCSS(_injection: chrome.scripting.CSSInjection): Promise<void> {
    const doc = getIframe()?.contentDocument;
    doc?.querySelectorAll('style[data-opticlick-injected]').forEach(el => el.remove());
  },
};
