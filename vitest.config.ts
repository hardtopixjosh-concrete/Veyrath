import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Network tests measure real tick timing; running files one at a time keeps them honest.
    fileParallelism: false,
  },
});
