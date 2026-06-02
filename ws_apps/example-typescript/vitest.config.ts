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
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
    coverage: {
      // Policy: PER_APP_COVERAGE_POLICY_DOC, "Per-App Unit Coverage".
      provider: 'v8',
      all: true,
      reporter: ['text'],
      include: ['src/**/*.ts'],
      thresholds: PER_APP_UNIT_COVERAGE_THRESHOLDS,
    },
  },
});

void PER_APP_COVERAGE_POLICY_DOC;
