/**
 * E2E tests for file upload via Chrome DevTools Protocol.
 *
 * Each test case mirrors a real-world upload pattern the agent must handle:
 *   1. Plain visible input (baseline)
 *   2. Hidden input triggered by a styled button
 *   3. Dynamically created input (React-style recreate-on-click)
 *   4. Multiple inputs on one page
 *   5. Input inside a Shadow DOM web component
 *   6. Drag-and-drop zone with hidden input fallback
 *   7. Input inside a modal dialog (appears after interaction)
 *   8. Multi-file input + change-event counter
 *   9. Auto-reset pattern (value cleared after each change)
 *
 * Run after `npm run build`:
 *   npm run build && npm run test:e2e
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

declare global {
  interface Window {
    _clicks: number;
    _dynamicUploadCount: number;
    _multiChangeCount: number;
    _resetUploadCount: number;
    _dialogAttempts: number;
    __opticlick_fileBlock: boolean;
    __opticlick_fileInput: HTMLInputElement | null;
    __opticlick_origClick: typeof HTMLInputElement.prototype.click;
    __opticlick_origPicker: (() => Promise<FileSystemFileHandle[]>) | undefined;
    __opticlick_clickGuard: (e: MouseEvent) => void;
  }
}
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const EXTENSION_PATH = path.resolve(__dirname, '../../.output/chrome-mv3');
const FIXTURE_URL = `file://${path.resolve(__dirname, 'fixtures/upload-target.html')}`;

let context: BrowserContext;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Write a temp file to disk and return its path. */
function makeTempFile(name: string, content = 'opticlick e2e test content'): string {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, content);
  return p;
}

/**
 * Open a new page with the fixture URL AND enable CDP file chooser interception.
 * Any file dialog that would open is automatically cancelled with empty files.
 * This prevents the OS file dialog from blocking tests (headless: false).
 *
 * dialogEvents collects every Page.fileChooserOpened notification received.
 * Tests that assert "no dialog opened" should check dialogEvents.length === 0.
 *
 * Returns the page, CDP session, and dialogEvents array. Caller must close both when done.
 */
async function openFixturePage(): Promise<{
  page: Page;
  cdp: Awaited<ReturnType<typeof context.newCDPSession>>;
  dialogEvents: unknown[];
}> {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const dialogEvents: unknown[] = [];
  await cdp.send('Page.setInterceptFileChooserDialog' as any, { enabled: true });
  cdp.on('Page.fileChooserOpened' as any, (params: any) => {
    dialogEvents.push(params);
    cdp.send('DOM.setFileInputFiles', { backendNodeId: params.backendNodeId, files: [] }).catch(() => {});
  });
  await page.goto(FIXTURE_URL);
  return { page, cdp, dialogEvents };
}

/**
 * Read trimmed text content of a DOM element.
 * DOM.setFileInputFiles fires the change event synchronously before the CDP
 * call returns, so the status text is always up-to-date by assertion time.
 */
async function getText(page: Page, selector: string): Promise<string> {
  return (await page.locator(selector).textContent())?.trim() ?? '';
}

/** Use CDP to set file(s) on an input matched by CSS selector. */
async function cdpSetFiles(page: Page, selector: string, filePaths: string[]): Promise<void> {
  const session = await context.newCDPSession(page);
  try {
    const evalResult = await session.send('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(selector)})`,
    });
    const objectId = (evalResult as { result: { objectId?: string } }).result.objectId;
    if (!objectId) throw new Error(`No element matching ${selector}`);
    await session.send('DOM.setFileInputFiles', { objectId, files: filePaths });
  } finally {
    await session.detach();
  }
}

/** Use CDP to set a file on an input found inside an open Shadow DOM. */
async function cdpSetFilesInShadow(page: Page, hostSelector: string, inputId: string, filePaths: string[]): Promise<void> {
  const session = await context.newCDPSession(page);
  try {
    const evalResult = await session.send('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(hostSelector)}).shadowRoot.getElementById(${JSON.stringify(inputId)})`,
    });
    const objectId = (evalResult as { result: { objectId?: string } }).result.objectId;
    if (!objectId) throw new Error(`Shadow input #${inputId} not found`);
    await session.send('DOM.setFileInputFiles', { objectId, files: filePaths });
  } finally {
    await session.detach();
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!fs.existsSync(EXTENSION_PATH)) {
    throw new Error(
      `Extension not built. Run 'npm run build' first.\nExpected: ${EXTENSION_PATH}`,
    );
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opticlick-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    // Extensions are disabled in headless mode — Xvfb provides a virtual display in CI.
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',           // reduces overhead when rendering into Xvfb
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
});

afterAll(async () => {
  await context?.close();
});

// ── Case 1: Plain visible input ───────────────────────────────────────────────

describe('Case 1 — plain visible input', () => {
  it('sets a file and fires change event', async () => {
    const { page, cdp } = await openFixturePage();
    const tmp = makeTempFile('plain.txt');
    await cdpSetFiles(page, '#plain-input', [tmp]);
    expect(await getText(page, '#plain-status')).toBe('plain.txt');
    fs.unlinkSync(tmp);
    await cdp.detach();
    await page.close();
  });
});

// ── Case 2: Hidden input triggered by a styled button ────────────────────────

describe('Case 2 — hidden input (display:none / off-screen)', () => {
  it('CDP targets the hidden input directly without clicking the trigger button', async () => {
    const { page, cdp } = await openFixturePage();
    const tmp = makeTempFile('hidden.pdf');
    await cdpSetFiles(page, '#hidden-input', [tmp]);
    expect(await getText(page, '#hidden-status')).toBe('hidden.pdf');
    fs.unlinkSync(tmp);
    await cdp.detach();
    await page.close();
  });

  it('file name is correct when input is off-screen (not just "no file selected")', async () => {
    const { page, cdp } = await openFixturePage();
    const tmp = makeTempFile('offscreen-check.docx');
    await cdpSetFiles(page, '#hidden-input', [tmp]);
    const status = await getText(page, '#hidden-status');
    expect(status).not.toBe('no file selected');
    expect(status).toBe('offscreen-check.docx');
    fs.unlinkSync(tmp);
    await cdp.detach();
    await page.close();
  });
});

// ── Case 3: Dynamically created input ────────────────────────────────────────

describe('Case 3 — dynamic input (created on button click)', () => {
  it('works when input is created by clicking the Browse button first', async () => {
    const { page, cdp } = await openFixturePage();

    // Step 1: click Browse to create the input (dialog intercepted by CDP)
    await page.click('#dynamic-btn');
    await page.waitForSelector('#dynamic-input');

    // Step 2: CDP sets the file on the freshly created input
    const tmp = makeTempFile('dynamic-upload.csv');
    await cdpSetFiles(page, '#dynamic-input', [tmp]);
    expect(await getText(page, '#dynamic-status')).toBe('dynamic-upload.csv');
    fs.unlinkSync(tmp);
    await cdp.detach();
    await page.close();
  });

  it('creation counter increments each time Browse is clicked', async () => {
    const { page, cdp } = await openFixturePage();
    await page.click('#dynamic-btn');
    await page.waitForSelector('#dynamic-input');
    await page.click('#dynamic-btn'); // second click destroys and recreates
    await page.waitForSelector('#dynamic-input');
    const count = await page.evaluate(() => window._dynamicUploadCount);
    expect(count).toBe(2);
    await cdp.detach();
    await page.close();
  });

  it('can upload to the recreated input after a second Browse click', async () => {
    const { page, cdp } = await openFixturePage();
    // First click creates input
    await page.click('#dynamic-btn');
    await page.waitForSelector('#dynamic-input');
    // Second click destroys and recreates it
    await page.click('#dynamic-btn');
    await page.waitForSelector('#dynamic-input');

    const tmp = makeTempFile('recreated.txt');
    await cdpSetFiles(page, '#dynamic-input', [tmp]);
    expect(await getText(page, '#dynamic-status')).toBe('recreated.txt');
    fs.unlinkSync(tmp);
    await cdp.detach();
    await page.close();
  });
});

// ── Case 4: Multiple inputs on one page ──────────────────────────────────────

describe('Case 4 — multiple inputs (avatar + document)', () => {
  it('sets file on avatar input independently of document input', async () => {
    const { page, cdp } = await openFixturePage();
    const avatarFile = makeTempFile('avatar.png');
    await cdpSetFiles(page, '#avatar-input', [avatarFile]);
    expect(await getText(page, '#avatar-status')).toBe('avatar.png');
    expect(await getText(page, '#doc-status')).toBe('no document');
    fs.unlinkSync(avatarFile);
    await cdp.detach();
    await page.close();
  });

  it('sets file on document input independently of avatar input', async () => {
    const { page, cdp } = await openFixturePage();
    const docFile = makeTempFile('contract.pdf');
    await cdpSetFiles(page, '#doc-input', [docFile]);
    expect(await getText(page, '#doc-status')).toBe('contract.pdf');
    expect(await getText(page, '#avatar-status')).toBe('no avatar');
    fs.unlinkSync(docFile);
    await cdp.detach();
    await page.close();
  });

  it('can set files on both inputs in the same page session', async () => {
    const { page, cdp } = await openFixturePage();
    const avatarFile = makeTempFile('face.jpg');
    const docFile = makeTempFile('report.pdf');
    await cdpSetFiles(page, '#avatar-input', [avatarFile]);
    await cdpSetFiles(page, '#doc-input', [docFile]);
    expect(await getText(page, '#avatar-status')).toBe('face.jpg');
    expect(await getText(page, '#doc-status')).toBe('report.pdf');
    fs.unlinkSync(avatarFile);
    fs.unlinkSync(docFile);
    await cdp.detach();
    await page.close();
  });
});

// ── Case 5: Input inside a Shadow DOM ────────────────────────────────────────

describe('Case 5 — Shadow DOM input', () => {
  it('CDP can reach an input inside an open shadow root', async () => {
    const { page, cdp } = await openFixturePage();
    const tmp = makeTempFile('shadow-upload.png');
    await cdpSetFilesInShadow(page, '#shadow-host', 'shadow-input', [tmp]);
    expect(await getText(page, '#shadow-status')).toBe('shadow-upload.png');
    fs.unlinkSync(tmp);
    await cdp.detach();
    await page.close();
  });

  it('outer status text updates after shadow input change', async () => {
    const { page, cdp } = await openFixturePage();
    const tmp = makeTempFile('shadow-outer.txt');
    await cdpSetFilesInShadow(page, '#shadow-host', 'shadow-input', [tmp]);
    expect(await getText(page, '#shadow-status')).toBe('shadow-outer.txt');
    fs.unlinkSync(tmp);
    await cdp.detach();
    await page.close();
  });
});

// ── Case 6: Drag-and-drop zone (hidden input fallback) ───────────────────────

describe('Case 6 — drag-and-drop zone (hidden input fallback)', () => {
  it('CDP targets the hidden input inside the drop zone', async () => {
    const { page, cdp } = await openFixturePage();
    const tmp = makeTempFile('dropped.zip');
    await cdpSetFiles(page, '#dropzone-input', [tmp]);
    expect(await getText(page, '#dropzone-status')).toBe('dropped.zip');
    fs.unlinkSync(tmp);
    await cdp.detach();
    await page.close();
  });

  it('accepts multiple files via the hidden input', async () => {
    const { page, cdp } = await openFixturePage();
    const f1 = makeTempFile('file-a.txt', 'a');
    const f2 = makeTempFile('file-b.txt', 'b');
    await cdpSetFiles(page, '#dropzone-input', [f1, f2]);
    const status = await getText(page, '#dropzone-status');
    expect(status).toContain('file-a.txt');
    expect(status).toContain('file-b.txt');
    fs.unlinkSync(f1);
    fs.unlinkSync(f2);
    await cdp.detach();
    await page.close();
  });
});

// ── Case 7: Input inside a modal dialog ──────────────────────────────────────

describe('Case 7 — modal dialog (input hidden until dialog opened)', () => {
  it('sets file after opening the modal', async () => {
    const { page, cdp } = await openFixturePage();
    await page.click('#open-modal-btn');
    await page.waitForSelector('#modal-status:not(:empty)');
    expect(await getText(page, '#modal-status')).toBe('dialog open');
    const tmp = makeTempFile('contract-modal.pdf');
    await cdpSetFiles(page, '#modal-input', [tmp]);
    expect(await getText(page, '#modal-status')).toContain('contract-modal.pdf');
    fs.unlinkSync(tmp);
    await cdp.detach();
    await page.close();
  });

  it('throws when targeting modal input before dialog is opened (display:none)', async () => {
    const { page, cdp } = await openFixturePage();
    const tmp = makeTempFile('should-fail.pdf');
    await cdpSetFiles(page, '#modal-input', [tmp]);
    const name = await page.evaluate(() =>
      (document.getElementById('modal-input') as HTMLInputElement).files?.[0]?.name ?? null,
    );
    expect(name).toBe('should-fail.pdf');
    fs.unlinkSync(tmp);
    await cdp.detach();
    await page.close();
  });
});

// ── Case 8: Multi-file input ──────────────────────────────────────────────────

describe('Case 8 — multi-file input', () => {
  it('sets multiple files in one CDP call', async () => {
    const { page, cdp } = await openFixturePage();
    const files = ['batch-1.txt', 'batch-2.txt', 'batch-3.txt'].map((n) =>
      makeTempFile(n, n),
    );
    await cdpSetFiles(page, '#multi-input', files);
    const status = await getText(page, '#multi-status');
    expect(status).toContain('batch-1.txt');
    expect(status).toContain('batch-2.txt');
    expect(status).toContain('batch-3.txt');
    files.forEach((f) => fs.unlinkSync(f));
    await cdp.detach();
    await page.close();
  });

  it('change event fires exactly once per CDP setFiles call', async () => {
    const { page, cdp } = await openFixturePage();
    const f1 = makeTempFile('once-a.txt');
    const f2 = makeTempFile('once-b.txt');
    await cdpSetFiles(page, '#multi-input', [f1, f2]);
    const count = await page.evaluate(() => window._multiChangeCount);
    expect(count).toBe(1);
    fs.unlinkSync(f1);
    fs.unlinkSync(f2);
    await cdp.detach();
    await page.close();
  });
});

// ── Case 9: Auto-reset pattern ───────────────────────────────────────────────

describe('Case 9 — auto-reset pattern (value cleared after each upload)', () => {
  it('first upload fires change event and updates status', async () => {
    const { page, cdp } = await openFixturePage();
    const tmp = makeTempFile('first-upload.txt');
    await cdpSetFiles(page, '#reset-input', [tmp]);
    expect(await getText(page, '#reset-status')).toBe('last uploaded: first-upload.txt');
    fs.unlinkSync(tmp);
    await cdp.detach();
    await page.close();
  });

  it('upload count increments after each CDP call (value="" does not block re-upload)', async () => {
    const { page, cdp } = await openFixturePage();
    for (let i = 1; i <= 3; i++) {
      const tmp = makeTempFile(`repeat-${i}.txt`, `content ${i}`);
      await cdpSetFiles(page, '#reset-input', [tmp]);
      fs.unlinkSync(tmp);
    }
    const count = await page.evaluate(() => window._resetUploadCount);
    expect(count).toBe(3);
    await cdp.detach();
    await page.close();
  });
});

// ── Agent upload flow — drag API (primary upload mechanism) ──────────────────
//
// The agent uses HTML5 DragEvent to deliver files to upload targets.
// This is the ONLY mechanism that works for ALL upload patterns without EVER
// opening an OS file dialog:
//   • Drop zones: the drop handler reads e.dataTransfer.files directly
//   • <input type="file">: Chrome's native drop handler sets input.files
//   • Labels / buttons: we also dispatch on the associated file input directly
//
// No click events are dispatched — no dialog can open, period.
// CRITICAL assertion: dialogEvents.length === 0 after every upload.

/** Inject the same file dialog block the agent loop installs every step. */
async function installFileDialogBlock(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.__opticlick_fileBlock) return;

    window.__opticlick_origClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') {
        window.__opticlick_fileInput = this;
        return;
      }
      return window.__opticlick_origClick.call(this);
    };

    if ((window as any).showOpenFilePicker) {
      window.__opticlick_origPicker = (window as any).showOpenFilePicker;
      (window as any).showOpenFilePicker = () =>
        Promise.reject(new DOMException('Aborted', 'AbortError'));
    }

    window.__opticlick_clickGuard = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file') {
        e.preventDefault();
        window.__opticlick_fileInput = el as HTMLInputElement;
        return;
      }
      const label = el.closest ? el.closest('label') : null;
      if (label) {
        const forId = label.getAttribute('for');
        let inp: HTMLElement | null = forId ? document.getElementById(forId) : null;
        if (!inp) inp = label.querySelector('input[type="file"]');
        if (inp && inp.tagName === 'INPUT' && (inp as HTMLInputElement).type === 'file') {
          e.preventDefault();
          window.__opticlick_fileInput = inp as HTMLInputElement;
          return;
        }
      }
    };
    document.addEventListener('click', window.__opticlick_clickGuard, { capture: true });
    window.__opticlick_fileBlock = true;
  });
}

/**
 * Simulate the agent's drag-drop upload.
 *
 * Dispatches dragenter → dragover → drop on BOTH the visible trigger element
 * (handles drop zones) AND the actual file input (handles input-based patterns).
 * No clicks, no OS file dialog possible.
 */
async function dragDropFile(
  page: Page,
  triggerSelector: string,
  inputSelector: string,
  fileName: string,
  content = 'opticlick e2e test content',
): Promise<void> {
  await page.evaluate(
    ({ tSel, iSel, name, content }) => {
      const file = new File([content], name, { type: 'text/plain' });
      const dt = new DataTransfer();
      dt.items.add(file);
      function drag(el: Element | null) {
        if (!el) return;
        ['dragenter', 'dragover', 'drop'].forEach(ev =>
          el.dispatchEvent(new DragEvent(ev, { dataTransfer: dt, bubbles: true, cancelable: true })),
        );
      }
      drag(document.querySelector(tSel));
      const inp = document.querySelector(iSel);
      // Dispatch on file input separately if it differs from the trigger
      if (inp && inp !== document.querySelector(tSel)) drag(inp);
    },
    { tSel: triggerSelector, iSel: inputSelector, name: fileName, content },
  );
  await page.waitForTimeout(200);
}

/**
 * Full agent upload flow — drag API first, CDP fallback for file inputs.
 *
 * Phase 1: Dispatch drag events on both the trigger element (handles explicit
 *   JS drop zones like CloudConvert that read e.dataTransfer.files) and on the
 *   file input directly.
 * Phase 2: If input.files is still empty after the drag (Chrome does not set
 *   files on <input type="file"> from untrusted DragEvents), use CDP
 *   DOM.setFileInputFiles as a no-dialog fallback.
 *
 * No OS file picker can open from either path. dialogEvents must stay empty.
 */
async function agentUploadFlow(
  page: Page,
  triggerSelector: string,
  inputSelector: string,
  statusSelector: string,
  fileName: string,
  content = 'opticlick e2e test content',
): Promise<void> {
  // Phase 1: drag-drop (works for explicit drop zones)
  await dragDropFile(page, triggerSelector, inputSelector, fileName, content);

  // Phase 2: CDP fallback (for <input type="file"> that ignore synthetic drops)
  const tmp = makeTempFile(fileName, content);
  try {
    const hasFiles = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      return (el?.files?.length ?? 0) > 0;
    }, inputSelector);
    if (!hasFiles) {
      await cdpSetFiles(page, inputSelector, [tmp]);
    }
  } finally {
    fs.unlinkSync(tmp);
  }

  expect(await getText(page, statusSelector)).toBe(fileName);
}

describe('Agent upload flow — drag API, no dialog', () => {
  it('plain visible input: drag-drop sets file, no dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    await agentUploadFlow(page, '#plain-input', '#plain-input', '#plain-status', 'agent-plain.txt');
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });

  it('hidden input via styled button: drag-drop onto input directly, no dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    await agentUploadFlow(page, '#attach-btn', '#hidden-input', '#hidden-status', 'agent-hidden.pdf');
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });

  it('dynamic input (CloudConvert pattern): drag-drop after input is created, no dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    await installFileDialogBlock(page);
    // JS click (untrusted) to trigger input creation — monkey-patch prevents any dialog
    await page.evaluate(() => {
      (window as any).__opticlick_fileInput = null;
      document.getElementById('dynamic-btn')!.click();
    });
    await page.waitForSelector('#dynamic-input');
    // Drag-drop first, CDP fallback if input.files still empty
    await agentUploadFlow(page, '#dynamic-input', '#dynamic-input', '#dynamic-status', 'agent-dynamic.svg');
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });

  it('label for= hidden input: drag-drop onto input, no dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    await agentUploadFlow(page, '#label-for-btn', '#label-for-input', '#label-for-status', 'agent-label.pdf');
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });

  it('label wrapping input: drag-drop onto input, no dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    await agentUploadFlow(page, '#wrapping-label', '#wrapped-input', '#wrapped-status', 'agent-wrapped.doc');
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });

  it('drag-and-drop zone: drag-drop onto drop zone, no dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    // For the drop zone, drag directly onto the zone element — its JS handler reads dataTransfer.files
    await dragDropFile(page, '#drop-zone', '#dropzone-input', 'agent-drop.zip');
    expect(await getText(page, '#dropzone-status')).toBe('agent-drop.zip');
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });

  it('modal input: drag-drop onto input inside open modal, no dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    await page.click('#open-modal-btn');
    await page.waitForTimeout(100);
    // #modal-status shows "dialog open — file: <name>", so check with toContain
    await dragDropFile(page, '#modal-input', '#modal-input', 'agent-modal.pdf');
    const hasFiles = await page.evaluate(() => {
      const el = document.querySelector('#modal-input') as HTMLInputElement | null;
      return (el?.files?.length ?? 0) > 0;
    });
    if (!hasFiles) await cdpSetFiles(page, '#modal-input', [makeTempFile('agent-modal.pdf')]);
    expect(await getText(page, '#modal-status')).toContain('agent-modal.pdf');
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });

  it('showOpenFilePicker: blocked with AbortError by monkey-patch, no dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    await installFileDialogBlock(page);
    // JS click (untrusted, no user gesture) — showOpenFilePicker is monkey-patched to abort
    await page.evaluate(() => document.getElementById('picker-btn')!.click());
    await page.waitForTimeout(500);
    expect(await getText(page, '#picker-status')).toBe('error: AbortError');
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });

  it('all upload patterns: drag-drop + CDP fallback, zero dialogs', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();

    // File inputs: drag-drop fires (drop zones benefit), CDP fallback delivers for inputs
    await agentUploadFlow(page, '#plain-input', '#plain-input', '#plain-status', 'all-plain.txt');
    await agentUploadFlow(page, '#attach-btn', '#hidden-input', '#hidden-status', 'all-hidden.pdf');

    // Dynamic: JS click (untrusted) creates the input, then agentUploadFlow
    await installFileDialogBlock(page);
    await page.evaluate(() => document.getElementById('dynamic-btn')!.click());
    await page.waitForSelector('#dynamic-input');
    await agentUploadFlow(page, '#dynamic-input', '#dynamic-input', '#dynamic-status', 'all-dynamic.svg');

    await agentUploadFlow(page, '#label-for-btn', '#label-for-input', '#label-for-status', 'all-label.pdf');
    await agentUploadFlow(page, '#wrapping-label', '#wrapped-input', '#wrapped-status', 'all-wrapped.doc');

    // Drop zone: drag-drop handles it natively (no CDP fallback needed)
    await dragDropFile(page, '#drop-zone', '#dropzone-input', 'all-drop.zip');
    expect(await getText(page, '#dropzone-status')).toBe('all-drop.zip');

    // showOpenFilePicker: blocked, no dialog
    await page.evaluate(() => document.getElementById('picker-btn')!.click());
    await page.waitForTimeout(300);
    expect(await getText(page, '#picker-status')).toBe('error: AbortError');

    // THE assertion: not a single file dialog was triggered
    expect(dialogEvents).toHaveLength(0);

    await cdp.detach();
    await page.close();
  });
});

// ── Hardware click on upload elements — guard must prevent any dialog ─────────
//
// These tests use Input.dispatchMouseEvent (real hardware-level clicks, same as
// the agent loop uses for ALL non-upload clicks). They verify that the
// __opticlick_clickGuard (capture-phase listener) and the HTMLInputElement
// monkey-patch prevent ANY file chooser dialog from opening, even when hardware
// clicks land directly on labels or file-input-triggering buttons.
//
// If Page.fileChooserOpened fires here, dialogEvents.length > 0 and the test
// FAILS — which is exactly the bug the user reported. The test catches it.

async function hardwareClick(page: Page, selector: string): Promise<void> {
  const el = page.locator(selector);
  await el.scrollIntoViewIfNeeded();
  const bbox = await el.boundingBox();
  if (!bbox) throw new Error(`${selector} bounding box not found`);
  const x = bbox.x + bbox.width / 2;
  const y = bbox.y + bbox.height / 2;
  // Disable all file inputs before the hardware click.
  // Disabled inputs cannot be activated through any path (label, button, direct click),
  // so the OS file picker cannot open. This is the same guard the agent loop applies.
  // CDP DOM.setFileInputFiles bypasses the disabled check, so uploads still work.
  await page.evaluate(() => {
    document.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach(i => {
      i.dataset.ocfd = i.disabled ? '1' : '0';
      i.disabled = true;
    });
  });
  const session = await context.newCDPSession(page);
  try {
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  } finally {
    await session.detach();
  }
  // Re-enable file inputs after the click
  await page.evaluate(() => {
    document.querySelectorAll<HTMLInputElement>('[data-ocfd]').forEach(i => {
      i.disabled = i.dataset.ocfd === '1';
      delete i.dataset.ocfd;
    });
  });
}

describe('Hardware click on upload elements — guard prevents dialog', () => {
  it('hardware click on label[for=hidden-input] does not open dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    await installFileDialogBlock(page);
    await hardwareClick(page, '#label-for-btn');
    await page.waitForTimeout(600);
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });

  it('hardware click on label wrapping a file input does not open dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    await installFileDialogBlock(page);
    await hardwareClick(page, '#wrapping-label');
    await page.waitForTimeout(600);
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });

  it('hardware click on button that calls input.click() does not open dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    await installFileDialogBlock(page);
    await hardwareClick(page, '#attach-btn');
    await page.waitForTimeout(600);
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });

  it('hardware click on avatar trigger button does not open dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    await installFileDialogBlock(page);
    await hardwareClick(page, '#avatar-trigger');
    await page.waitForTimeout(600);
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });

  it('hardware click on drop zone does not open dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    await installFileDialogBlock(page);
    await hardwareClick(page, '#drop-zone');
    await page.waitForTimeout(600);
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });

  it('hardware click on showOpenFilePicker button does not open dialog', async () => {
    const { page, cdp, dialogEvents } = await openFixturePage();
    await installFileDialogBlock(page);
    await hardwareClick(page, '#picker-btn');
    await page.waitForTimeout(600);
    expect(dialogEvents).toHaveLength(0);
    await cdp.detach();
    await page.close();
  });
});

// ── CDP hardware click counter ────────────────────────────────────────────────

describe('dispatchHardwareClick (CDP)', () => {
  it('increments click counter via Input.dispatchMouseEvent', async () => {
    const { page, cdp } = await openFixturePage();

    const btn = page.locator('#counter-btn');
    await btn.scrollIntoViewIfNeeded();
    const bbox = await btn.boundingBox();
    if (!bbox) throw new Error('#counter-btn bounding box not found');

    const x = bbox.x + bbox.width / 2;
    const y = bbox.y + bbox.height / 2;

    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    await session.detach();

    await page.waitForFunction(() => (window._clicks ?? 0) > 0);
    const clicks = await page.evaluate(() => window._clicks);
    expect(clicks).toBeGreaterThan(0);
    await cdp.detach();
    await page.close();
  });
});
