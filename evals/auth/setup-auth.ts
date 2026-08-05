/**
 * Prepare authentication for evals from an explicitly provisioned test-account
 * Playwright storage state. CI must never automate third-party login forms.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

const AUTH_DIR = path.resolve(process.cwd(), 'evals/auth');
const STATE_PATH = path.join(AUTH_DIR, 'state.json');

async function main(): Promise<void> {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const authFilter = (process.env.EVAL_AUTH_FILTER ?? 'non-auth').toLowerCase();
  if (authFilter === 'non-auth') {
    console.log('Skipping auth setup for a non-auth evaluation run.');
    return;
  }

  const encodedState = process.env.STORAGE_STATE_BASE64;
  if (!encodedState) {
    throw new Error(
      'Auth evaluations require STORAGE_STATE_BASE64 from an isolated test account; automated third-party logins are disabled.',
    );
  }

  const decoded = Buffer.from(encodedState, 'base64').toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error('STORAGE_STATE_BASE64 is not valid JSON; re-export the isolated test-account state.');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).cookies) ||
    !Array.isArray((parsed as Record<string, unknown>).origins)
  ) {
    throw new Error('STORAGE_STATE_BASE64 must contain Playwright cookies and origins arrays.');
  }

  fs.writeFileSync(STATE_PATH, decoded, { encoding: 'utf8', mode: 0o600 });
  console.log(`Prepared isolated test-account state at ${STATE_PATH}.`);
}

main().catch((err) => {
  console.error('Fatal error during auth setup:', err);
  process.exit(1);
});
