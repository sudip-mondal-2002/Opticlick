import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  // ── Files to skip ────────────────────────────────────────────────────────
  {
    ignores: [
      '.wxt/**',
      '.output/**',
      'node_modules/**',
      'coverage/**',
      'sandbox/dist/**',
    ],
  },

  // ── Base JS recommended ───────────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript recommended (parser + rules for all TS/TSX files) ─────────
  ...tseslint.configs.recommended,

  // ── Source files (src/**, sandbox/src/**) ─────────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}', 'sandbox/src/**/*.{ts,tsx}', 'wxt.config.ts', 'vitest.config.ts', 'vitest.config.e2e.ts'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        chrome: 'readonly',
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // React
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',  // React 17+ JSX transform — no import needed
      'react/prop-types': 'off',           // TypeScript handles prop types

      // TypeScript
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },

  // ── Test files ────────────────────────────────────────────────────────────
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        chrome: 'readonly',
      },
    },
    rules: {
      // Tests legitimately use `any` for mock args and cast assertions
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Test setup files use process.env and similar node-isms
      'no-undef': 'off',
    },
  },

  // ── Sandbox Service Worker ────────────────────────────────────────────────
  {
    files: ['sandbox/public/sw.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
    rules: {
      'no-useless-escape': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // ── Sandbox Chrome Mock Shims ─────────────────────────────────────────────
  {
    files: ['sandbox/src/chrome-mock/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // ── Scripts & Configuration Files ─────────────────────────────────────────
  {
    files: ['scripts/**/*.mjs', 'postcss.config.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
