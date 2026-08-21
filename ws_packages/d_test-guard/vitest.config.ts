import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { APP_ENV: 'test' },
    include: ['index.test.ts'],
    coverage: {
      provider: 'v8',
      // `coverage.all` was removed in vitest 4: coverage now always reports
      // every file matched by `include`, whether a test touched it or not,
      // which is exactly what `all: true` used to request. Dropping the key
      // preserves the behaviour the 100% thresholds below depend on.
      reporter: ['text'],
      include: ['index.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
});
