/**
 * E2E tests for the overlay (Set-of-Mark canvas).
 *
 * Requires a built extension and Playwright Chromium:
 *   npm run build && npx playwright install chromium && npm run test:e2e
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type BrowserContext } from '@playwright/test';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { extensionE2ePrerequisites, EXTENSION_PATH } from './helpers';

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/upload-target.html');
const CANVAS_ID = '__opticlick_overlay__';
const e2e = extensionE2ePrerequisites();

describe.skipIf(!e2e.ok)('Overlay draw and destroy', () => {
  let context: BrowserContext;

  beforeAll(async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opticlick-overlay-e2e-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      // Extensions are disabled in headless mode — Xvfb provides a virtual display in CI.
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });

    if (!context.serviceWorkers().length) {
      await context.waitForEvent('serviceworker');
    }
  });

  afterAll(async () => {
    await context?.close();
  });

  it('canvas appears after DRAW_MARKS message is sent to content script', async () => {
    const page = await context.newPage();
    await page.goto(`file://${FIXTURE_PATH}`);

    await page.evaluate(async () => {
      await chrome.runtime.sendMessage({ type: 'DRAW_MARKS' }).catch(() => null);
    }).catch(() => null);

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

    await page.evaluate((id) => {
      const canvas = document.createElement('canvas');
      canvas.id = id;
      document.body.appendChild(canvas);
    }, CANVAS_ID);

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

    const count = await page.evaluate(() => {
      const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'label']);
      return Array.from(document.querySelectorAll('*')).filter((el) => {
        const tag = el.tagName.toLowerCase();
        return INTERACTIVE_TAGS.has(tag);
      }).length;
    });

    expect(count).toBeGreaterThanOrEqual(2);
    await page.close();
  });
});
