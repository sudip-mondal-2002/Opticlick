import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

export const EXTENSION_PATH = path.resolve(__dirname, '../../.output/chrome-mv3');

export type E2ePrerequisiteResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Returns whether real Chromium extension E2E tests can run in this environment. */
export function extensionE2ePrerequisites(): E2ePrerequisiteResult {
  if (!fs.existsSync(EXTENSION_PATH)) {
    return {
      ok: false,
      reason: "Extension not built — run 'npm run build' first.",
    };
  }

  try {
    const executable = chromium.executablePath();
    if (!fs.existsSync(executable)) {
      return {
        ok: false,
        reason: "Playwright Chromium not installed — run 'npx playwright install chromium'.",
      };
    }
  } catch {
    return {
      ok: false,
      reason: "Playwright Chromium not installed — run 'npx playwright install chromium'.",
    };
  }

  return { ok: true };
}
