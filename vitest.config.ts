import { defineConfig } from 'vitest/config';
import path from 'path';

const srcAlias = { '@': path.resolve(__dirname, 'src') };

// Suppress console.log/info noise in test output; keep console.error/warn.
const onConsoleLog = (_log: string, type: 'stdout' | 'stderr'): false | void => {
  if (type === 'stderr') return;
  return false;
};

export default defineConfig({
  resolve: { alias: srcAlias },

  test: {
    projects: [
      // ── Unit: pure functions, no Chrome APIs ─────────────────────────────
      {
        resolve: { alias: srcAlias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          setupFiles: [
            'tests/setup/fake-browser-setup.ts',
            'tests/setup/chrome-mocks.ts',
          ],
          globals: true,
        },
      },
      // ── Sandbox: mock Chrome APIs and proxy environments ─────────────────
      {
        resolve: { alias: srcAlias },
        test: {
          name: 'sandbox',
          include: ['tests/sandbox/**/*.test.ts'],
          environment: 'node',
          globals: true,
        },
      },

      // ── Integration: IndexedDB + Chrome API mocks ────────────────────────
      {
        resolve: { alias: srcAlias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: [
            'tests/setup/indexeddb-setup.ts',
            'tests/setup/fake-browser-setup.ts',
            'tests/setup/chrome-mocks.ts',
          ],
          globals: true,
        },
      },
      // ── DOM: content script functions (jsdom environment) ────────────────
      {
        resolve: { alias: srcAlias },
        test: {
          name: 'dom',
          include: ['tests/dom/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['tests/setup/dom-setup.ts'],
          globals: true,
        },
      },
      // ── E2E: real Chromium via Playwright (requires Xvfb on CI) ──────────
      {
        resolve: { alias: srcAlias },
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          environment: 'node',
          globals: true,
          testTimeout: 60_000,
          hookTimeout: 30_000,
        },
      },
    ],
    onConsoleLog,
    coverage: {
      provider: 'v8',
      include: ['src/utils/**', 'src/entrypoints/content/**'],
      exclude: [
        'src/utils/types.ts',
        'src/utils/cdp/index.ts',
        'src/utils/db/index.ts',
      ],
      reporter: ['text', 'html', 'lcov', 'json', 'json-summary'],
      reportOnFailure: true,
    },
  },
});
