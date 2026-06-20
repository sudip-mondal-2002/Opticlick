/**
 * evals/auth/smoke-test.ts
 *
 * Validates that the pre-authenticated cookies actually work by physically navigating
 * to the target platforms and checking for logged-in UI elements.
 * Prevents wasting LLM tokens on evals if the session is dead/expired.
 *
 * Automatically skipped when EVAL_AUTH_FILTER=non-auth since no auth is needed.
 * When cookies fail, logs a warning but does NOT abort — the runner will skip
 * auth-required cases if cookies are unavailable.
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
  const authFilter = (process.env.EVAL_AUTH_FILTER ?? 'non-auth').toLowerCase();

  // No auth needed for non-auth runs — skip entirely
  if (authFilter === 'non-auth') {
    console.log('⏭️ EVAL_AUTH_FILTER=non-auth — skipping auth smoke test.');
    return;
  }

  if (!fs.existsSync(STATE_PATH)) {
    console.log('⚠️  No state.json found. Skipping smoke test (will rely on username/password login).');
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
    } catch {
      console.error(`  ❌ ${check.name} auth failed! Could not find selector '${check.selector}'. Cookies may be expired or invalid.`);
      failed = true;
    }
  }

  await browser.close();

  if (failed) {
    // Warn but don't abort — the eval runner will skip auth cases if cookies are invalid.
    // Username/password login in setup-auth.ts will be used as fallback.
    console.warn('\n⚠️  Some auth cookies are expired or invalid.');
    console.warn('   Auth-required eval cases may be skipped or fail gracefully.');
    console.warn('   To fix: re-run export-cookies.ts locally and update STORAGE_STATE_BASE64 secret.');
    return;
  }

  console.log('\n✅ All targeted platforms passed the smoke test!');
}

main().catch((err) => {
  console.error('Fatal error during smoke test:', err);
  process.exit(1);
});
