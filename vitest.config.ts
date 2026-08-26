import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Local vitest config so test runs from this dir don't climb to lab-root.
// Forked consumers: this file ships as the canonical-template's test
// config; `just update` overwrites it on every sync, so do NOT edit it.
// Consumer test config belongs in ws_apps/<name>/vitest.config.ts.
//
// EXTENSION POINT for consumers who need to exclude their OWN scripts from
// the enforced 100 percent `scripts/**/*.ts` coverage gate: create an
// optional `vitest.consumer.json` at the repo root (sibling to this file).
// It is consumer-owned — deliberately absent from HARNESS_OWNED_PATHS in
// `scripts/update.ts`, so `just update` never overwrites or deletes it.
//
//   // vitest.consumer.json
//   {
//     "coverage": {
//       "exclude": ["scripts/ingest-my-seed-data.ts"]
//     }
//   }
//
// Absent file = zero entries = byte-identical behaviour to a fresh clone.
// See docs/updating.md ("Excluding your own scripts from the coverage
// gate") and docs/adrs/ADR-0013-coverage-enforcement.md.

const CONSUMER_CONFIG_FILE = 'vitest.consumer.json';

interface ConsumerConfig {
  coverage?: { exclude?: unknown };
}

function readConsumerConfig(path: string): ConsumerConfig {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ConsumerConfig;
  } catch (error) {
    // Loud, not silent: a malformed consumer file that quietly degraded to
    // "no excludes" would reproduce the exact failure mode this extension
    // point exists to fix (a gate whose behaviour diverges from what the
    // consumer assumes).
    throw new Error(
      `${CONSUMER_CONFIG_FILE}: not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

/**
 * Extra `coverage.exclude` globs contributed by the optional, consumer-owned
 * `vitest.consumer.json`. Returns `[]` when the file is absent, which is the
 * canonical-template default.
 *
 * Exported for `scripts/tests/vitest-consumer-config.test.ts`. This file is
 * not itself in the coverage include list, so the helper carries no coverage
 * obligation of its own.
 */
export function consumerCoverageExclude(
  rootDir: string = dirname(fileURLToPath(import.meta.url)),
): string[] {
  const path = join(rootDir, CONSUMER_CONFIG_FILE);
  if (!existsSync(path)) return [];

  const entries = readConsumerConfig(path).coverage?.exclude;
  if (entries === undefined) return [];
  if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${CONSUMER_CONFIG_FILE}: coverage.exclude must be an array of glob strings`);
  }
  return entries as string[];
}

export default defineConfig({
  test: {
    include: ['scripts/tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // `coverage.all` was removed in vitest 4: coverage now always reports
      // every file matched by `include`, whether a test touched it or not,
      // which is exactly what `all: true` used to request. Dropping the key
      // preserves the behaviour the 100% thresholds below depend on.
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
      exclude: ['scripts/tests/**/*.ts', 'scripts/fork-check.ts', ...consumerCoverageExclude()],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
