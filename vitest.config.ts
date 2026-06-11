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
      // template-hygiene-gate.mjs rides the scripts coverage gate even
      // though it lives under harness/hooks/: it is dependency-injected
      // and unit-tested from scripts/tests/template-hygiene-gate.test.ts
      // so the enforced 100 percent thresholds apply to it (its node:test
      // siblings under harness/hooks/tests/ predate this arrangement).
      include: ['scripts/**/*.ts', 'harness/hooks/template-hygiene-gate.mjs'],
      // fork-check.ts is an E2E orchestrator that snapshots the repo
      // into a temp dir and shells out to `just`; it has no
      // unit-testable surface, and its correctness is asserted by the
      // `just fork-check` recipe + the matching CI job, not vitest.
      exclude: ['scripts/tests/**/*.ts', 'scripts/fork-check.ts'],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
