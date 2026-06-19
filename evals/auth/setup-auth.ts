/**
 * evals/auth/setup-auth.ts
 *
 * Pre-authenticates a Playwright browser context by logging into specified services
 * (GitHub, Reddit, Notion, LinkedIn, Discord) using shared bot credentials from
 * environment variables.
 *
 * Environment variables:
 *   EVAL_BOT_EMAIL    — shared email used for LinkedIn, Notion, Discord
 *   EVAL_BOT_PASSWORD — shared password used for all platforms
 *   EVAL_BOT_USERNAME — username used for GitHub and Reddit (may differ from email)
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

// Shared credentials
const BOT_EMAIL    = process.env.EVAL_BOT_EMAIL    ?? '';
const BOT_PASSWORD = process.env.EVAL_BOT_PASSWORD ?? '';
const BOT_USERNAME = process.env.EVAL_BOT_USERNAME ?? '';

async function loginGitHub(page: Page) {
  if (!BOT_USERNAME || !BOT_PASSWORD) {
    console.log('⏭️ Skipping GitHub (missing EVAL_BOT_USERNAME or EVAL_BOT_PASSWORD)');
    return;
  }
  console.log('▶ Logging into GitHub...');
  await page.goto('https://github.com/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#login_field', BOT_USERNAME);
  await page.fill('#password', BOT_PASSWORD);
  await page.click('input[type="submit"]');
  await page.waitForSelector('img.avatar', { timeout: 10_000 });
  console.log('✅ GitHub login successful');
}

async function loginReddit(page: Page) {
  if (!BOT_USERNAME || !BOT_PASSWORD) {
    console.log('⏭️ Skipping Reddit (missing EVAL_BOT_USERNAME or EVAL_BOT_PASSWORD)');
    return;
  }
  console.log('▶ Logging into Reddit...');
  await page.goto('https://www.reddit.com/login/', { waitUntil: 'domcontentloaded' });
  await page.fill('#loginUsername', BOT_USERNAME);
  await page.fill('#loginPassword', BOT_PASSWORD);
  await page.click('button[type="submit"]');
  // Wait for avatar — null if selector not found within timeout
  const found = await page.waitForSelector('#email-collection-tooltip-id', { timeout: 15_000 }).catch(() => null);
  if (!found) {
    throw new Error('Reddit login failed: avatar selector not found — session may have been blocked');
  }
  console.log('✅ Reddit login successful');
}

async function loginNotion(page: Page) {
  if (!BOT_EMAIL || !BOT_PASSWORD) {
    console.log('⏭️ Skipping Notion (missing EVAL_BOT_EMAIL or EVAL_BOT_PASSWORD)');
    return;
  }
  console.log('▶ Logging into Notion...');
  await page.goto('https://www.notion.so/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', BOT_EMAIL);
  await page.click('div[role="button"]:has-text("Continue with email")');
  await page.waitForSelector('input[type="password"]', { timeout: 10_000 });
  await page.fill('input[type="password"]', BOT_PASSWORD);
  await page.click('div[role="button"]:has-text("Continue with password")');
  await page.waitForSelector('.notion-sidebar', { timeout: 15_000 });
  console.log('✅ Notion login successful');
}

async function loginLinkedIn(page: Page) {
  if (!BOT_EMAIL || !BOT_PASSWORD) {
    console.log('⏭️ Skipping LinkedIn (missing EVAL_BOT_EMAIL or EVAL_BOT_PASSWORD)');
    return;
  }
  console.log('▶ Logging into LinkedIn...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#username', BOT_EMAIL);
  await page.fill('#password', BOT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('.global-nav__me-photo', { timeout: 15_000 });
  console.log('✅ LinkedIn login successful');
}

async function loginDiscord(page: Page) {
  if (!BOT_EMAIL || !BOT_PASSWORD) {
    console.log('⏭️ Skipping Discord (missing EVAL_BOT_EMAIL or EVAL_BOT_PASSWORD)');
    return;
  }
  console.log('▶ Logging into Discord...');
  await page.goto('https://discord.com/login', { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', BOT_EMAIL);
  await page.fill('input[name="password"]', BOT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[class*="sidebar"]', { timeout: 15_000 });
  console.log('✅ Discord login successful');
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
    { name: 'GitHub',   fn: loginGitHub },
    { name: 'Reddit',   fn: loginReddit },
    { name: 'Notion',   fn: loginNotion },
    { name: 'LinkedIn', fn: loginLinkedIn },
    { name: 'Discord',  fn: loginDiscord },
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
