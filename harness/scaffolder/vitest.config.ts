import { defineConfig } from 'vitest/config';

// 100 percent coverage on the scaffolder slot. The implementation is
// dependency-injected so every branch (including the spawn error paths,
// the strip-list validator, the dry-run preview, and the CLI argument
// parser) is reachable from unit tests without touching the real
// filesystem or running real init.ts / git.
const COVERAGE_THRESHOLDS = {
  lines: 100,
  functions: 100,
  statements: 100,
  branches: 100,
} as const;

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,mts,mjs}'],
    coverage: {
      provider: 'v8',
      // bin/create-harness-app.mjs is a 3-line dispatch shim. Its
      // tests/bin-entry test runs it as a real subprocess (vitest's
      // static-import analyser cannot dynamically import a sibling
      // .mjs without erroring), so v8 coverage cannot instrument it in
      // process. The CI scaffolder-fork-check job exercises it
      // end-to-end as the real correctness oracle.
      include: ['scaffolder.mjs'],
      exclude: ['tests/**', 'node_modules/**', 'coverage/**', '*.config.*'],
      reporter: ['text', 'text-summary'],
      thresholds: COVERAGE_THRESHOLDS,
    },
  },
});
