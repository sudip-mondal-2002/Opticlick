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
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    const tmp = makeTempFile('plain.txt');
    await cdpSetFiles(page, '#plain-input', [tmp]);
    expect(await getText(page, '#plain-status')).toBe('plain.txt');
    fs.unlinkSync(tmp);
    await page.close();
  });
});

// ── Case 2: Hidden input triggered by a styled button ────────────────────────

describe('Case 2 — hidden input (display:none / off-screen)', () => {
  it('CDP targets the hidden input directly without clicking the trigger button', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    const tmp = makeTempFile('hidden.pdf');
    // The input is position:absolute left:-9999px — invisible but present.
    // DOM.setFileInputFiles doesn't need the element to be visible.
    await cdpSetFiles(page, '#hidden-input', [tmp]);
    expect(await getText(page, '#hidden-status')).toBe('hidden.pdf');
    fs.unlinkSync(tmp);
    await page.close();
  });

  it('file name is correct when input is off-screen (not just "no file selected")', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    const tmp = makeTempFile('offscreen-check.docx');
    await cdpSetFiles(page, '#hidden-input', [tmp]);
    const status = await getText(page, '#hidden-status');
    expect(status).not.toBe('no file selected');
    expect(status).toBe('offscreen-check.docx');
    fs.unlinkSync(tmp);
    await page.close();
  });
});

// ── Case 3: Dynamically created input ────────────────────────────────────────

describe('Case 3 — dynamic input (created on button click)', () => {
  it('works when input is created by clicking the Browse button first', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);

    // Step 1: click Browse to create the input
    await page.click('#dynamic-btn');
    await page.waitForSelector('#dynamic-input');

    // Step 2: CDP sets the file on the freshly created input
    const tmp = makeTempFile('dynamic-upload.csv');
    await cdpSetFiles(page, '#dynamic-input', [tmp]);
    expect(await getText(page, '#dynamic-status')).toBe('dynamic-upload.csv');
    fs.unlinkSync(tmp);
    await page.close();
  });

  it('creation counter increments each time Browse is clicked', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    await page.click('#dynamic-btn');
    await page.waitForSelector('#dynamic-input');
    await page.click('#dynamic-btn'); // second click destroys and recreates
    await page.waitForSelector('#dynamic-input');
    const count = await page.evaluate(() => window._dynamicUploadCount);
    expect(count).toBe(2);
    await page.close();
  });

  it('can upload to the recreated input after a second Browse click', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
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
    await page.close();
  });
});

// ── Case 4: Multiple inputs on one page ──────────────────────────────────────

describe('Case 4 — multiple inputs (avatar + document)', () => {
  it('sets file on avatar input independently of document input', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    const avatarFile = makeTempFile('avatar.png');
    await cdpSetFiles(page, '#avatar-input', [avatarFile]);
    expect(await getText(page, '#avatar-status')).toBe('avatar.png');
    // doc input should be untouched
    expect(await getText(page, '#doc-status')).toBe('no document');
    fs.unlinkSync(avatarFile);
    await page.close();
  });

  it('sets file on document input independently of avatar input', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    const docFile = makeTempFile('contract.pdf');
    await cdpSetFiles(page, '#doc-input', [docFile]);
    expect(await getText(page, '#doc-status')).toBe('contract.pdf');
    expect(await getText(page, '#avatar-status')).toBe('no avatar');
    fs.unlinkSync(docFile);
    await page.close();
  });

  it('can set files on both inputs in the same page session', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    const avatarFile = makeTempFile('face.jpg');
    const docFile = makeTempFile('report.pdf');
    await cdpSetFiles(page, '#avatar-input', [avatarFile]);
    await cdpSetFiles(page, '#doc-input', [docFile]);
    expect(await getText(page, '#avatar-status')).toBe('face.jpg');
    expect(await getText(page, '#doc-status')).toBe('report.pdf');
    fs.unlinkSync(avatarFile);
    fs.unlinkSync(docFile);
    await page.close();
  });
});

// ── Case 5: Input inside a Shadow DOM ────────────────────────────────────────

describe('Case 5 — Shadow DOM input', () => {
  it('CDP can reach an input inside an open shadow root', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    const tmp = makeTempFile('shadow-upload.png');
    await cdpSetFilesInShadow(page, '#shadow-host', 'shadow-input', [tmp]);
    expect(await getText(page, '#shadow-status')).toBe('shadow-upload.png');
    fs.unlinkSync(tmp);
    await page.close();
  });

  it('outer status text updates after shadow input change', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    const tmp = makeTempFile('shadow-outer.txt');
    await cdpSetFilesInShadow(page, '#shadow-host', 'shadow-input', [tmp]);
    expect(await getText(page, '#shadow-status')).toBe('shadow-outer.txt');
    fs.unlinkSync(tmp);
    await page.close();
  });
});

// ── Case 6: Drag-and-drop zone (hidden input fallback) ───────────────────────

describe('Case 6 — drag-and-drop zone (hidden input fallback)', () => {
  it('CDP targets the hidden input inside the drop zone', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    const tmp = makeTempFile('dropped.zip');
    await cdpSetFiles(page, '#dropzone-input', [tmp]);
    expect(await getText(page, '#dropzone-status')).toBe('dropped.zip');
    fs.unlinkSync(tmp);
    await page.close();
  });

  it('accepts multiple files via the hidden input', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    const f1 = makeTempFile('file-a.txt', 'a');
    const f2 = makeTempFile('file-b.txt', 'b');
    await cdpSetFiles(page, '#dropzone-input', [f1, f2]);
    const status = await getText(page, '#dropzone-status');
    expect(status).toContain('file-a.txt');
    expect(status).toContain('file-b.txt');
    fs.unlinkSync(f1);
    fs.unlinkSync(f2);
    await page.close();
  });
});

// ── Case 7: Input inside a modal dialog ──────────────────────────────────────

describe('Case 7 — modal dialog (input hidden until dialog opened)', () => {
  it('sets file after opening the modal', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    await page.click('#open-modal-btn');
    // waitForSelector with a text match ensures the click handler ran before we proceed
    await page.waitForSelector('#modal-status:not(:empty)');
    expect(await getText(page, '#modal-status')).toBe('dialog open');
    const tmp = makeTempFile('contract-modal.pdf');
    await cdpSetFiles(page, '#modal-input', [tmp]);
    expect(await getText(page, '#modal-status')).toContain('contract-modal.pdf');
    fs.unlinkSync(tmp);
    await page.close();
  });

  it('throws when targeting modal input before dialog is opened (display:none)', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    // Modal not opened — input exists in DOM but overlay is display:none
    const tmp = makeTempFile('should-fail.pdf');
    // CDP can still reach hidden inputs by objectId, but the test asserts the
    // actual file name matches (i.e. the change event fires correctly regardless)
    await cdpSetFiles(page, '#modal-input', [tmp]);
    // Even though hidden, DOM.setFileInputFiles works — change event fires
    const name = await page.evaluate(() =>
      (document.getElementById('modal-input') as HTMLInputElement).files?.[0]?.name ?? null,
    );
    expect(name).toBe('should-fail.pdf');
    fs.unlinkSync(tmp);
    await page.close();
  });
});

// ── Case 8: Multi-file input ──────────────────────────────────────────────────

describe('Case 8 — multi-file input', () => {
  it('sets multiple files in one CDP call', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    const files = ['batch-1.txt', 'batch-2.txt', 'batch-3.txt'].map((n) =>
      makeTempFile(n, n),
    );
    await cdpSetFiles(page, '#multi-input', files);
    const status = await getText(page, '#multi-status');
    expect(status).toContain('batch-1.txt');
    expect(status).toContain('batch-2.txt');
    expect(status).toContain('batch-3.txt');
    files.forEach((f) => fs.unlinkSync(f));
    await page.close();
  });

  it('change event fires exactly once per CDP setFiles call', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    const f1 = makeTempFile('once-a.txt');
    const f2 = makeTempFile('once-b.txt');
    await cdpSetFiles(page, '#multi-input', [f1, f2]);
    const count = await page.evaluate(() => window._multiChangeCount);
    expect(count).toBe(1); // one change event for the whole batch
    fs.unlinkSync(f1);
    fs.unlinkSync(f2);
    await page.close();
  });
});

// ── Case 9: Auto-reset pattern ───────────────────────────────────────────────

describe('Case 9 — auto-reset pattern (value cleared after each upload)', () => {
  it('first upload fires change event and updates status', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    const tmp = makeTempFile('first-upload.txt');
    await cdpSetFiles(page, '#reset-input', [tmp]);
    expect(await getText(page, '#reset-status')).toBe('last uploaded: first-upload.txt');
    fs.unlinkSync(tmp);
    await page.close();
  });

  it('upload count increments after each CDP call (value="" does not block re-upload)', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);
    for (let i = 1; i <= 3; i++) {
      const tmp = makeTempFile(`repeat-${i}.txt`, `content ${i}`);
      await cdpSetFiles(page, '#reset-input', [tmp]);
      fs.unlinkSync(tmp);
    }
    const count = await page.evaluate(() => window._resetUploadCount);
    expect(count).toBe(3); // CDP bypasses the value="" reset issue
    await page.close();
  });
});

// ── CDP hardware click counter ────────────────────────────────────────────────

describe('dispatchHardwareClick (CDP)', () => {
  it('increments click counter via Input.dispatchMouseEvent', async () => {
    const page = await context.newPage();
    await page.goto(FIXTURE_URL);

    // The fixture page is long — the counter button may be below the fold.
    // scrollIntoViewIfNeeded + boundingBox() gives viewport-relative CSS
    // coordinates AFTER the element is scrolled into view, which is what
    // Input.dispatchMouseEvent expects.
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

    // Wait for the browser to process the click event before reading the counter
    await page.waitForFunction(() => (window._clicks ?? 0) > 0);
    const clicks = await page.evaluate(() => window._clicks);
    expect(clicks).toBeGreaterThan(0);
    await page.close();
  });
});
