// Unit tests for scripts/lib/coverage-scope.ts.
//
// The behaviour under test is the difference between a coverage REGRESSION
// and filesystem noise: an untracked scratch file inside a target's coverage
// globs is measured at 0 percent and fails a 100 percent threshold even
// though every real test still passes.
import { describe, expect, test } from 'vitest';
import { scopeArgsForTarget, untrackedWithin } from '../lib/coverage-scope';

const ROOT = { dir: '', configPath: './vitest.config.ts' };
const NESTED = { dir: 'harness/stack', configPath: './harness/stack/vitest.config.ts' };

function deps(overrides: Partial<Parameters<typeof scopeArgsForTarget>[2]> = {}) {
  const logs: string[] = [];
  return {
    logs,
    value: {
      listUntracked: () => [],
      loadExcludes: async () => [],
      log: (m: string) => logs.push(m),
      ...overrides,
    },
  };
}

describe('untrackedWithin', () => {
  test('the repo-root target owns every untracked path, unchanged', () => {
    expect(untrackedWithin(ROOT, ['scripts/a.ts', 'harness/stack/src/b.ts'])).toEqual([
      'scripts/a.ts',
      'harness/stack/src/b.ts',
    ]);
  });

  test('a nested target takes only its own files, rebased onto its directory', () => {
    expect(
      untrackedWithin(NESTED, ['scripts/a.ts', 'harness/stack/src/b.ts', 'harness/stackX/c.ts']),
    ).toEqual(['src/b.ts']);
  });

  test('a nested target with nothing of its own returns empty', () => {
    expect(untrackedWithin(NESTED, ['scripts/a.ts'])).toEqual([]);
  });
});

describe('scopeArgsForTarget', () => {
  test('a clean tree adds no flags at all and says nothing', async () => {
    const d = deps();
    expect(await scopeArgsForTarget(ROOT, [], d.value)).toEqual([]);
    expect(d.logs).toEqual([]);
  });

  test('an untracked file is excluded together with the config exclusions (union, not replace)', async () => {
    const d = deps({
      loadExcludes: async () => ['scripts/tests/**/*.ts', 'scripts/fork-check.ts'],
    });
    const args = await scopeArgsForTarget(ROOT, ['scripts/zz-scratch.ts'], d.value);
    expect(args).toEqual([
      '--coverage.exclude=scripts/tests/**/*.ts',
      '--coverage.exclude=scripts/fork-check.ts',
      '--coverage.exclude=scripts/zz-scratch.ts',
    ]);
  });

  test('the exclusion is announced loudly, naming the files and why', async () => {
    const d = deps();
    await scopeArgsForTarget(ROOT, ['scripts/zz-scratch.ts'], d.value);
    expect(d.logs).toHaveLength(1);
    expect(d.logs[0]).toContain('NOTICE');
    expect(d.logs[0]).toContain('scripts/zz-scratch.ts');
    expect(d.logs[0]).toContain('<repo root>');
    expect(d.logs[0]).toContain('Commit or `git add` a file to have it measured');
  });

  test('a nested target names its own directory in the notice', async () => {
    const d = deps();
    await scopeArgsForTarget(NESTED, ['harness/stack/src/scratch.ts'], d.value);
    expect(d.logs[0]).toContain('harness/stack');
    expect(d.logs[0]).toContain('src/scratch.ts');
  });

  test('a target with no untracked files of its own is untouched even when others have some', async () => {
    const d = deps();
    expect(await scopeArgsForTarget(NESTED, ['scripts/zz-scratch.ts'], d.value)).toEqual([]);
    expect(d.logs).toEqual([]);
  });
});
