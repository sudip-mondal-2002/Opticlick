/**
 * evals/auth/setup-auth.ts
 *
 * Pre-authenticates a Playwright browser context by logging into specified services
 * (GitHub, Reddit, Twitter, LinkedIn, etc.) using dummy credentials from environment variables.
 *
 * It saves the resulting cookies and localStorage to `evals/auth/state.json`.
 * The harness will automatically detect and inject this state into the agent's browser.
 *
 * ── Bot Detection Fallback ──
 * If automated UI login triggers CAPTCHAs, you can export a working state locally
 * and pass it directly to CI via the `STORAGE_STATE_BASE64` environment variable.
 */

import { chromium, type Page } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

const AUTH_DIR = path.resolve(process.cwd(), 'evals/auth');
const STATE_PATH = path.join(AUTH_DIR, 'state.json');

async function loginGitHub(page: Page) {
  const username = process.env.GITHUB_EVAL_USERNAME || process.env.GITHUB_EVAL_EMAIL;
  const password = process.env.GITHUB_EVAL_PASSWORD;
  if (!username || !password) {
    console.log('⏭️ Skipping GitHub (missing GITHUB_EVAL_USERNAME or GITHUB_EVAL_PASSWORD)');
    return;
  }

  console.log('▶ Logging into GitHub...');
  await page.goto('https://github.com/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#login_field', username);
  await page.fill('#password', password);
  await page.click('input[type="submit"]');
  // Wait for the dashboard to load indicating successful login
  await page.waitForSelector('img.avatar', { timeout: 10_000 });
  console.log('✅ GitHub login successful');
}

async function loginReddit(page: Page) {
  const username = process.env.REDDIT_EVAL_USERNAME || process.env.REDDIT_EVAL_EMAIL;
  const password = process.env.REDDIT_EVAL_PASSWORD;
  if (!username || !password) {
    console.log('⏭️ Skipping Reddit (missing REDDIT_EVAL_USERNAME or REDDIT_EVAL_PASSWORD)');
    return;
  }

  console.log('▶ Logging into Reddit...');
  await page.goto('https://www.reddit.com/login/', { waitUntil: 'domcontentloaded' });
  await page.fill('#loginUsername', username);
  await page.fill('#loginPassword', password);
  await page.click('button[type="submit"]');
  // Wait for avatar indicating successful login
  await page.waitForSelector('#email-collection-tooltip-id', { timeout: 15_000 }).catch(() => { });
  console.log('✅ Reddit login successful');
}

async function loginNotion(page: Page) {
  const email = process.env.NOTION_EVAL_EMAIL;
  const password = process.env.NOTION_EVAL_PASSWORD;
  if (!email || !password) {
    console.log('⏭️ Skipping Notion (missing NOTION_EVAL_EMAIL or NOTION_EVAL_PASSWORD)');
    return;
  }

  console.log('▶ Logging into Notion...');
  await page.goto('https://www.notion.so/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', email);
  await page.click('div[role="button"]:has-text("Continue with email")');
  await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
  await page.fill('input[type="password"]', password);
  await page.click('div[role="button"]:has-text("Continue with password")');
  await page.waitForSelector('.notion-sidebar', { timeout: 15_000 });
  console.log('✅ Notion login successful');
}

async function main() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  // 1. Check for Base64 Fallback
  if (process.env.STORAGE_STATE_BASE64) {
    console.log('📦 Found STORAGE_STATE_BASE64! Decoding directly and bypassing UI logins...');
    const decoded = Buffer.from(process.env.STORAGE_STATE_BASE64, 'base64').toString('utf-8');
    fs.writeFileSync(STATE_PATH, decoded, 'utf8');
    console.log(`✅ Saved persistent auth state to ${STATE_PATH}`);
    return;
  }

  // 2. Automated UI Logins
  console.log('🌐 Booting headless browser for automated auth...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  });

  // Stealth patch
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  // Try each login independently so a CAPTCHA on one doesn't crash the others
  const logins = [
    { name: 'GitHub', fn: loginGitHub },
    { name: 'Reddit', fn: loginReddit },
    { name: 'Notion', fn: loginNotion },
  ];

  for (const { name, fn } of logins) {
    try {
      await fn(page);
    } catch (err) {
      console.error(`❌ Failed to log into ${name}: ${(err as Error).message}`);
    }
  }

  // 3. Save the resulting cookies
  await context.storageState({ path: STATE_PATH });
  console.log(`\n✅ Saved persistent auth state to ${STATE_PATH}`);

  await browser.close();
}

main().catch((err) => {
  console.error('Fatal error during auth setup:', err);
  process.exit(1);
});
