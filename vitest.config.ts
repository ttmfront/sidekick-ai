import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/**/src/**/*.test.ts',
      'tests/**/*.test.ts'
    ],
    environment: 'node',
    passWithNoTests: false,
    testTimeout: 20000,
    hookTimeout: 20000
  }
});
