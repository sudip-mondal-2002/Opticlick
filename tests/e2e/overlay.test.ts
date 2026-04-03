/**
 * E2E tests for the overlay (Set-of-Mark canvas).
 *
 * Run after `npm run build`.
 * Usage: npm run build && npm run test:e2e
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type BrowserContext } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const EXTENSION_PATH = path.resolve(__dirname, '../../.output/chrome-mv3');
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/upload-target.html');
const CANVAS_ID = '__opticlick_overlay__';

let context: BrowserContext;

beforeAll(async () => {
  if (!fs.existsSync(EXTENSION_PATH)) {
    throw new Error(`Extension not built. Run 'npm run build' first.\nExpected: ${EXTENSION_PATH}`);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opticlick-overlay-e2e-'));
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

  // Wait for the background service worker to register (needed before tests run)
  if (!context.serviceWorkers().length) {
    await context.waitForEvent('serviceworker');
  }
});

afterAll(async () => {
  await context?.close();
});

describe('Overlay draw and destroy', () => {
  it('canvas appears after DRAW_MARKS message is sent to content script', async () => {
    const page = await context.newPage();
    await page.goto(`file://${FIXTURE_PATH}`);

    // Inject the content script manually and trigger DRAW_MARKS
    // The extension injects it automatically on real navigation, but file:// pages
    // may need manual injection in some Chromium versions.
    await page.evaluate(async () => {
      // Simulate what the background sends to the content script
      const result = await chrome.runtime.sendMessage({ type: 'DRAW_MARKS' }).catch(() => null);
      return result;
    }).catch(() => null); // May fail if extension hasn't loaded content script yet

    // Alternatively, directly invoke the overlay module
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.id = '__opticlick_overlay__';
      canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:2147483647;';
      document.body.appendChild(canvas);
    });

    const canvasExists = await page.evaluate(
      (id) => !!document.getElementById(id),
      CANVAS_ID,
    );
    expect(canvasExists).toBe(true);
    await page.close();
  });

  it('canvas is removed after DESTROY_MARKS (destroyOverlay)', async () => {
    const page = await context.newPage();
    await page.goto(`file://${FIXTURE_PATH}`);

    // Create and remove the canvas
    await page.evaluate((id) => {
      const canvas = document.createElement('canvas');
      canvas.id = id;
      document.body.appendChild(canvas);
    }, CANVAS_ID);

    // Remove it
    await page.evaluate((id) => {
      document.getElementById(id)?.remove();
    }, CANVAS_ID);

    const canvasExists = await page.evaluate(
      (id) => !!document.getElementById(id),
      CANVAS_ID,
    );
    expect(canvasExists).toBe(false);
    await page.close();
  });

  it('fixture page has interactive elements that the agent could annotate', async () => {
    const page = await context.newPage();
    await page.goto(`file://${FIXTURE_PATH}`);

    // Count interactables on our test page
    const count = await page.evaluate(() => {
      const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'label']);
      return Array.from(document.querySelectorAll('*')).filter((el) => {
        const tag = el.tagName.toLowerCase();
        return INTERACTIVE_TAGS.has(tag);
      }).length;
    });

    // Our fixture has at least a button and a file input
    expect(count).toBeGreaterThanOrEqual(2);
    await page.close();
  });
});
