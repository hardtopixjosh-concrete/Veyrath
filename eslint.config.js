import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/release/**', 'coverage/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The simulation and protocol must stay pure and deterministic: no platform APIs, no wall clock,
    // no unseeded randomness.
    files: ['packages/sim/**/*.ts', 'packages/protocol/**/*.ts', 'packages/content/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['node:*', 'electron', 'ws'] }],
      'no-restricted-globals': ['error', 'window', 'document', 'performance', 'process'],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded world RNG.' },
        { object: 'Date', property: 'now', message: 'The simulation is tick-based.' },
      ],
    },
  },
);
