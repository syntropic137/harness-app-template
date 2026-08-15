import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { consumerCoverageExclude } from '../../vitest.config';

// `vitest.config.ts` enforces 100 percent coverage over `scripts/**/*.ts`,
// and it is itself in the `just update` overwrite set (see
// HARNESS_OWNED_PATHS in scripts/update.ts). The optional, consumer-owned
// `vitest.consumer.json` at the repo root is the durable escape hatch: it
// is NOT in the overwrite set, so a fork's coverage exemptions survive a
// harness sync. This suite pins the contract.

function withRoot(files: Record<string, string>, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'cha-vitest-consumer-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(root, name), body);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('consumerCoverageExclude()', () => {
  test('returns no entries when the consumer file is absent (template default)', () => {
    withRoot({}, (root) => {
      expect(consumerCoverageExclude(root)).toEqual([]);
    });
  });

  test('returns the declared globs when the consumer file is present', () => {
    withRoot(
      {
        'vitest.consumer.json': JSON.stringify({
          coverage: { exclude: ['scripts/ingest-seed.ts', 'scripts/adhoc/**/*.ts'] },
        }),
      },
      (root) => {
        expect(consumerCoverageExclude(root)).toEqual([
          'scripts/ingest-seed.ts',
          'scripts/adhoc/**/*.ts',
        ]);
      },
    );
  });

  test('tolerates a consumer file that omits coverage.exclude', () => {
    withRoot({ 'vitest.consumer.json': JSON.stringify({ coverage: {} }) }, (root) => {
      expect(consumerCoverageExclude(root)).toEqual([]);
    });
    withRoot({ 'vitest.consumer.json': '{}' }, (root) => {
      expect(consumerCoverageExclude(root)).toEqual([]);
    });
  });

  test('fails loudly on malformed JSON rather than silently dropping excludes', () => {
    withRoot({ 'vitest.consumer.json': '{ not json' }, (root) => {
      expect(() => consumerCoverageExclude(root)).toThrow(/not valid JSON/);
    });
  });

  test('fails loudly when coverage.exclude is not an array of strings', () => {
    withRoot({ 'vitest.consumer.json': '{"coverage":{"exclude":"scripts/x.ts"}}' }, (root) => {
      expect(() => consumerCoverageExclude(root)).toThrow(/array of glob strings/);
    });
    withRoot({ 'vitest.consumer.json': '{"coverage":{"exclude":[1]}}' }, (root) => {
      expect(() => consumerCoverageExclude(root)).toThrow(/array of glob strings/);
    });
  });

  // Not asserted as empty: a fork legitimately ships a consumer file here,
  // and this suite must stay green in forks too.
  test('defaults the root argument to the directory holding vitest.config.ts', () => {
    expect(Array.isArray(consumerCoverageExclude())).toBe(true);
  });
});
