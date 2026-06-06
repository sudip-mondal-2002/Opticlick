import { describe, it, expect } from 'vitest';
import { chromium } from '@playwright/test';
import * as path from 'path';

const FIXTURE_URL = `file://${path.resolve(
  __dirname,
  'fixtures/drag-and-drop.html',
)}`;

describe('Drag and Drop', () => {
  it('drops draggable item into drop zone', async () => {
    const browser = await chromium.launch();

    try {
      const page = await browser.newPage();

      await page.goto(FIXTURE_URL);

      await page.locator('#dragItem').dragTo(
        page.locator('#dropZone'),
      );

      const text = await page.locator('#dropZone').textContent();
      expect(text).toContain('Dropped Successfully!');
    } finally {
      await browser.close();
    }
  });
});