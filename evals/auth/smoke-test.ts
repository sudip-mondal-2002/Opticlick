/**
 * evals/auth/smoke-test.ts
 *
 * Validates that the pre-authenticated cookies actually work by physically navigating
 * to the target platforms and checking for logged-in UI elements.
 * Prevents wasting LLM tokens on evals if the session is dead/expired.
 */

import { chromium } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

const STATE_PATH = path.resolve(process.cwd(), 'evals/auth/state.json');

const DOMAIN_CHECKS = [
  { name: 'GitHub', domain: 'github.com', url: 'https://github.com', selector: 'img.avatar' },
  { name: 'Reddit', domain: 'reddit.com', url: 'https://www.reddit.com', selector: '#email-collection-tooltip-id' },
  { name: 'Notion', domain: 'notion.so', url: 'https://www.notion.so', selector: '.notion-sidebar' },
];

async function main() {
  if (!fs.existsSync(STATE_PATH)) {
    console.log('⏭️ No state.json found. Skipping smoke test.');
    return;
  }

  const stateData = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  const cookies = stateData.cookies || [];

  console.log('💨 Running Auth Smoke Test...');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STATE_PATH });
  const page = await context.newPage();

  let failed = false;

  for (const check of DOMAIN_CHECKS) {
    // Only verify domains we actually have cookies for
    const hasCookies = cookies.some((c: { domain: string }) => c.domain.includes(check.domain));
    if (!hasCookies) {
      console.log(`  ⚪ Skipping ${check.name} (no cookies present)`);
      continue;
    }

    console.log(`  ▶ Checking ${check.name}...`);
    try {
      await page.goto(check.url, { waitUntil: 'domcontentloaded' });
      // Short timeout because if we are logged in, the UI element should render quickly
      await page.waitForSelector(check.selector, { timeout: 10_000 });
      console.log(`  ✅ ${check.name} auth verified!`);
    } catch (_err) {
      console.error(`  ❌ ${check.name} auth failed! Could not find selector '${check.selector}'. Cookies may be expired or invalid.`);
      failed = true;
    }
  }

  await browser.close();

  if (failed) {
    console.error('\n❌ Smoke test failed! Aborting pipeline to save tokens.');
    process.exit(1);
  }

  console.log('\n✅ All targeted platforms passed the smoke test!');
}

main().catch((err) => {
  console.error('Fatal error during smoke test:', err);
  process.exit(1);
});
