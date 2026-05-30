import { defineConfig } from 'vitest/config';

// Local vitest config so test runs from this dir don't climb to lab-root.
// Forked consumers: this file ships as the canonical-template's test
// config; `just update` overwrites it on every sync, so do NOT edit it.
// Consumer test config belongs in ws_apps/<name>/vitest.config.ts.
export default defineConfig({
  test: {
    include: ['scripts/tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      all: true,
      include: ['scripts/**/*.ts'],
      exclude: ['scripts/tests/**/*.ts'],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
