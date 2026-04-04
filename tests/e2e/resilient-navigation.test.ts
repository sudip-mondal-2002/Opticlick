/**
 * E2E tests for "Resilient Navigation" behaviours.
 *
 * These tests load serp-target.html in a real Chromium browser (no extension
 * required) and validate four failure modes the agent must handle:
 *
 *   1. Tag Precision        — the annotator must surface <a>/<button> entries,
 *                             not their parent <div> containers.
 *   2. AI Overview Pivot    — clicking the AI-citation link (a <div>) must NOT
 *                             change the URL; the test then validates the agent
 *                             would fall back to the organic-results section.
 *   3. DOM Delta Validation — scroll actions that produce a zero Y-offset delta
 *                             (or identical screenshot) must be detected and
 *                             flagged so the agent can switch method.
 *   4. URL Reconstruction   — when the UI is broken (Show-More is non-functional),
 *                             the agent must extract the search query and
 *                             reconstruct a direct navigation URL.
 *
 * Run after `npm run build` if the extension overlay tests are also running,
 * but these tests themselves do NOT require a built extension.
 * Usage: npm run test:e2e
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from '@playwright/test';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  scrollDeltaIsSignificant,
  screenshotIsUnchanged,
  shouldPivot,
  extractSearchQuery,
  reconstructSearchUrl,
  isSemanticTarget,
  pickMostSemanticEntry,
  navigationSucceeded,
  MAX_PIVOT_RETRIES,
} from '@/utils/navigation-guard';

const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/serp-target.html');
const FIXTURE_URL = `file://${FIXTURE_PATH}`;

// ─────────────────────────────────────────────────────────────────────────────
// Browser setup — plain Chromium, no extension needed for these tests
// ─────────────────────────────────────────────────────────────────────────────

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

/** Open the SERP fixture in a fresh page and wait for it to settle. */
async function openSerpPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
  return page;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: capture a base-64 screenshot hash (for identical-screenshot checks)
// ─────────────────────────────────────────────────────────────────────────────

async function captureScreenshotHash(page: Page): Promise<string> {
  const buf = await page.screenshot({ type: 'png' });
  return crypto.createHash('sha256').update(buf).digest('base64');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Tag Precision — <a>/<button> must win over parent <div>
// ─────────────────────────────────────────────────────────────────────────────

describe('Tag Precision: annotator must surface semantic tags', () => {
  it('organic result links are <a> tags, not their parent <div> wrappers', async () => {
    const page = await openSerpPage();

    // Simulate what the content-script annotator would enumerate: collect all
    // interactive elements on the page and verify that for each organic result,
    // the annotated entry has tag 'a', not the surrounding 'div.result-wrapper'.
    const entries = await page.evaluate(() => {
      const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea']);
      return Array.from(document.querySelectorAll('[data-testid^="result-link"]')).map((el) => ({
        tag: el.tagName.toLowerCase(),
        id: el.id,
        text: el.textContent?.trim().slice(0, 60) ?? '',
        href: el.getAttribute('href') ?? '',
      }));
    });

    // All three organic result links must be <a> elements.
    expect(entries.length).toBe(3);
    for (const entry of entries) {
      expect(isSemanticTarget(entry.tag)).toBe(true);
      expect(entry.tag).toBe('a');
      expect(entry.href).toMatch(/^https?:\/\//);
    }

    await page.close();
  });

  it('result wrappers are <div> tags — pickMostSemanticEntry selects the nested <a>', async () => {
    const page = await openSerpPage();

    // For result 1, the annotator might find both the wrapper div and the anchor.
    // pickMostSemanticEntry must choose the anchor.
    const { wrapperTag, linkTag } = await page.evaluate(() => ({
      wrapperTag: document.querySelector('[data-testid="result-wrapper-1"]')?.tagName.toLowerCase() ?? '',
      linkTag: document.querySelector('[data-testid="result-link-1"]')?.tagName.toLowerCase() ?? '',
    }));

    expect(wrapperTag).toBe('div');  // confirm fixture structure
    expect(linkTag).toBe('a');

    // pickMostSemanticEntry should prefer the <a> over the surrounding <div>.
    const candidates = [
      { tag: wrapperTag, id: 100 },
      { tag: linkTag, id: 101 },
    ];
    expect(pickMostSemanticEntry(candidates).tag).toBe('a');

    await page.close();
  });

  it('AI citation link is a <div> — flagged as non-semantic by isSemanticTarget', async () => {
    const page = await openSerpPage();

    const tag = await page.evaluate(
      () => document.getElementById('ai-citation-link')?.tagName.toLowerCase() ?? '',
    );

    // The AI box citation is intentionally a <div role=link>, NOT an <a>.
    // The agent should detect this and treat it as a lower-confidence target.
    expect(tag).toBe('div');
    expect(isSemanticTarget(tag)).toBe(false);

    await page.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. AI Overview Pivot — no navigation → fall back to organic results
// ─────────────────────────────────────────────────────────────────────────────

describe('AI Overview Pivot: detect non-navigation click and fall back', () => {
  it('clicking the AI citation div does not change the page URL', async () => {
    const page = await openSerpPage();
    const urlBefore = page.url();

    await page.click('#ai-citation-link');
    await page.waitForTimeout(200); // brief settle time

    const urlAfter = page.url();

    // The AI link is a <div> — it MUST NOT trigger navigation.
    expect(urlBefore).toBe(urlAfter);
    // navigationSucceeded confirms the agent's check would return false here.
    expect(navigationSucceeded(urlBefore, urlAfter)).toBe(false);

    await page.close();
  });

  it('records the AI-citation click in window._serpState', async () => {
    const page = await openSerpPage();

    await page.click('#ai-citation-link');
    await page.click('#ai-citation-link'); // two clicks

    const aiClicks = await page.evaluate(() => (window as unknown as { _serpState: { aiClicks: number } })._serpState.aiClicks);
    expect(aiClicks).toBe(2);

    await page.close();
  });

  it('shouldPivot triggers after MAX_PIVOT_RETRIES identical AI-link clicks', () => {
    // Simulate the agent's history after three failed AI-link clicks.
    // targetId 99 represents the AI-citation element in the coordinate map.
    const history = Array.from({ length: MAX_PIVOT_RETRIES }, () => ({
      type: 'click',
      targetId: 99,
    }));
    expect(shouldPivot(history, 'click', 99)).toBe(true);
  });

  it('organic section is present as the fallback when AI box is unresponsive', async () => {
    const page = await openSerpPage();

    // The organic results section must exist and contain visible <a> links.
    const organicSection = await page.$('#organic-results');
    expect(organicSection).not.toBeNull();

    const organicLinks = await page.$$('#organic-results a.result-title');
    expect(organicLinks.length).toBeGreaterThanOrEqual(3);

    // Each organic link must have a valid href (real navigation target).
    for (const link of organicLinks) {
      const href = await link.getAttribute('href');
      expect(href).toMatch(/^https?:\/\//);
    }

    await page.close();
  });

  it('clicking an organic result records the destination URL', async () => {
    const page = await openSerpPage();

    // Prevent the <a> from actually navigating (keeps page context alive)
    // so we can read window._serpState after the click.
    await page.evaluate(() => {
      document.getElementById('result-1-link')!.addEventListener(
        'click',
        (e) => e.preventDefault(),
        { capture: true },
      );
    });

    await page.click('#result-1-link');

    const lastUrl = await page.evaluate(
      () => (window as unknown as { _serpState: { lastNavigateUrl: string | null } })._serpState.lastNavigateUrl,
    );
    expect(lastUrl).toBe('https://brewhaven.example.com');

    await page.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. DOM Delta Validation — detect zero-delta scroll (anti-loop)
// ─────────────────────────────────────────────────────────────────────────────

describe('DOM Delta Validation: detect no-op scroll and screenshot identity', () => {
  it('page scrolls produce a measurable Y-offset change', async () => {
    const page = await openSerpPage();

    const beforeY: number = await page.evaluate(() => window.pageYOffset);
    await page.evaluate(() => window.scrollBy(0, 400));
    const afterY: number = await page.evaluate(() => window.pageYOffset);

    expect(scrollDeltaIsSignificant(beforeY, afterY)).toBe(true);
    // The actual delta should be close to 400 px.
    expect(Math.abs(afterY - beforeY)).toBeGreaterThanOrEqual(50);

    await page.close();
  });

  it('scrolling at the bottom of the page produces zero delta — step should fail', async () => {
    const page = await openSerpPage();

    // Scroll all the way to the bottom first.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);

    const beforeY: number = await page.evaluate(() => window.pageYOffset);
    // Try to scroll further down — already at the bottom.
    await page.evaluate(() => window.scrollBy(0, 9999));
    const afterY: number = await page.evaluate(() => window.pageYOffset);

    // Delta should be 0 (or negligible); scrollDeltaIsSignificant must return false.
    expect(scrollDeltaIsSignificant(beforeY, afterY)).toBe(false);

    await page.close();
  });

  it('screenshot hash changes after a meaningful scroll', async () => {
    const page = await openSerpPage();

    const hashBefore = await captureScreenshotHash(page);
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(150); // let paint settle
    const hashAfter = await captureScreenshotHash(page);

    // The page rendered differently after a 600 px scroll.
    expect(screenshotIsUnchanged(hashBefore, hashAfter)).toBe(false);

    await page.close();
  });

  it('screenshot hash is identical when nothing changes between two captures', async () => {
    const page = await openSerpPage();

    const hash1 = await captureScreenshotHash(page);
    // No interaction — take second screenshot immediately.
    const hash2 = await captureScreenshotHash(page);

    expect(screenshotIsUnchanged(hash1, hash2)).toBe(true);

    await page.close();
  });

  it('Show-More click does not add any DOM nodes (zero DOM delta)', async () => {
    const page = await openSerpPage();

    const nodeCountBefore: number = await page.evaluate(() => document.querySelectorAll('.result-item').length);
    await page.click('#show-more-btn');
    await page.waitForTimeout(200);
    const nodeCountAfter: number = await page.evaluate(() => document.querySelectorAll('.result-item').length);

    // The button is intentionally non-functional — no new result items appear.
    expect(nodeCountAfter).toBe(nodeCountBefore);

    await page.close();
  });

  it('shouldPivot triggers after Show-More is clicked MAX_PIVOT_RETRIES times with no change', () => {
    // Simulate three identical "click show-more" actions in the agent history.
    const history = Array.from({ length: MAX_PIVOT_RETRIES }, () => ({
      type: 'click',
      targetId: 200, // Show-More button's annotated ID
    }));
    expect(shouldPivot(history, 'click', 200)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. URL Reconstruction — bypass broken UI with direct navigate()
// ─────────────────────────────────────────────────────────────────────────────

describe('URL Reconstruction: bypass stuck UI via direct navigation', () => {
  it('extracts the current search query from the fixture page search input', async () => {
    const page = await openSerpPage();

    const inputValue: string = await page.evaluate(
      () => (document.getElementById('search-input') as HTMLInputElement).value,
    );

    expect(inputValue.length).toBeGreaterThan(0);

    // The agent can extract the query from the input and reconstruct a URL.
    const reconstructed = reconstructSearchUrl(inputValue);
    expect(reconstructed).toMatch(/^https:\/\/www\.google\.com\/search\?q=/);
    const parsed = new URL(reconstructed);
    expect(parsed.searchParams.get('q')).toBe(inputValue);

    await page.close();
  });

  it('extractSearchQuery + reconstructSearchUrl round-trip matches fixture query', async () => {
    const page = await openSerpPage();

    const inputValue: string = await page.evaluate(
      () => (document.getElementById('search-input') as HTMLInputElement).value,
    );

    const reconstructed = reconstructSearchUrl(inputValue);
    const extracted = extractSearchQuery(reconstructed);

    expect(extracted).toBe(inputValue);

    await page.close();
  });

  it('simulate broken UI: Show-More fails 3 times, agent reconstructs URL and navigates', async () => {
    const page = await openSerpPage();

    // Step 1: simulate three failed Show-More clicks (no DOM change each time).
    const actionHistory: Array<{ type: string; targetId?: number }> = [];
    const SHOW_MORE_ID = 200; // annotated element ID for the Show-More button

    for (let attempt = 0; attempt < MAX_PIVOT_RETRIES; attempt++) {
      const nodesBefore: number = await page.evaluate(
        () => document.querySelectorAll('.result-item').length,
      );
      await page.click('#show-more-btn');
      await page.waitForTimeout(100);
      const nodesAfter: number = await page.evaluate(
        () => document.querySelectorAll('.result-item').length,
      );

      actionHistory.push({ type: 'click', targetId: SHOW_MORE_ID });

      // Each click should show zero DOM delta.
      expect(nodesAfter).toBe(nodesBefore);
    }

    // Step 2: after MAX_PIVOT_RETRIES, shouldPivot must return true.
    expect(shouldPivot(actionHistory, 'click', SHOW_MORE_ID)).toBe(true);

    // Step 3: the agent falls back to URL reconstruction.
    const searchQuery: string = await page.evaluate(
      () => (document.getElementById('search-input') as HTMLInputElement).value,
    );
    const fallbackUrl = reconstructSearchUrl(searchQuery);

    // The reconstructed URL must be valid and contain the query.
    expect(fallbackUrl).toMatch(/^https:\/\/www\.google\.com\/search\?q=/);
    const qParam = extractSearchQuery(fallbackUrl);
    expect(qParam).toBe(searchQuery);

    await page.close();
  });

  it('navigate tool action is preferable to a click when pivot threshold is exceeded', () => {
    // This validates the agent's decision logic at the tool-selection level:
    // after shouldPivot returns true, the correct action type is 'navigate', not 'click'.
    const history = Array.from({ length: MAX_PIVOT_RETRIES }, () => ({
      type: 'click',
      targetId: 200,
    }));

    const pivotNeeded = shouldPivot(history, 'click', 200);
    expect(pivotNeeded).toBe(true);

    // The agent should now emit a 'navigate' action instead.
    // Validate that the reconstructed URL is a valid navigate() argument.
    const query = 'best coffee shops near me';
    const navigateUrl = reconstructSearchUrl(query);
    expect(navigateUrl).toBe('https://www.google.com/search?q=best%20coffee%20shops%20near%20me');

    // A subsequent 'navigate' action for this URL should NOT trigger pivot
    // (it's a different action type).
    expect(shouldPivot(history, 'navigate', undefined)).toBe(false);
  });
});
