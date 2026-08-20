import { defineConfig } from 'vitest/config';

const PER_APP_COVERAGE_POLICY_DOC = 'docs/sensors/coverage-and-gate.md';
const PER_APP_UNIT_COVERAGE_THRESHOLDS = {
  lines: 100,
  functions: 100,
  statements: 100,
  branches: 100,
} as const;

export default defineConfig({
  test: {
    env: { APP_ENV: 'test' },
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
    coverage: {
      // Policy: PER_APP_COVERAGE_POLICY_DOC, "Per-App Unit Coverage".
      provider: 'v8',
      // `coverage.all` was removed in vitest 4: coverage now always reports
      // every file matched by `include`, whether a test touched it or not,
      // which is exactly what `all: true` used to request. Dropping the key
      // preserves the behaviour the 100% thresholds below depend on.
      reporter: ['text'],
      include: ['src/**/*.ts'],
      thresholds: PER_APP_UNIT_COVERAGE_THRESHOLDS,
    },
  },
});

void PER_APP_COVERAGE_POLICY_DOC;
