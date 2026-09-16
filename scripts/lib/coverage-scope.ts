// Scope TypeScript coverage collection to git-tracked files.
//
// The cov-ts pre-push gate runs vitest with `all: true` and 100 percent
// thresholds over filesystem globs (`scripts/**/*.ts`, `src/**/*.ts`, ...).
// "Filesystem" is the problem: an UNTRACKED scratch file inside one of those
// globs is pulled into the measurement with zero covered lines, so the totals
// drop below 100 and the push is rejected. Reproduced on a clean checkout:
// adding one untracked `scripts/zz-scratch-repro.ts` moved the root suite
// from 100/100/100/100 below threshold and failed the gate, with every
// existing test still passing.
//
// That is background noise, not a coverage regression. A file that is not in
// git is not part of the shipped surface the gate is protecting, and no commit
// introduced it. A file that IS in git -- including one merely `git add`ed and
// not yet committed, since `git ls-files --others` excludes staged paths --
// stays measured at the full threshold. So this narrows the noise without
// opening any hole: to dodge the gate you would have to not commit your code,
// at which point it is not in the change either.
//
// No threshold is touched. The only thing that changes is WHICH files are in
// the measured set, and the exclusion is announced on stdout every time it
// happens so a contaminated run is never silently different from a clean one.
//
// Mechanics note: vitest's `--coverage.exclude` CLI flag REPLACES the config's
// exclude array rather than appending to it (verified: passing a single
// unrelated exclude pulled a config-excluded file back into the report at 0
// percent and cratered the totals). So this module reads each target's own
// vitest config at runtime and emits the UNION, which keeps the configs as
// the single source of truth for their real exclusions.

import { relative } from 'node:path';

/** One `pnpm ... vitest run --coverage` target from scripts/test-coverage.ts. */
export interface CoverageTarget {
  /** Repo-relative directory the target runs in; '' for the repo root. */
  dir: string;
  /** Repo-relative path to that target's vitest config. */
  configPath: string;
}

export interface CoverageScopeDeps {
  /** Repo-relative paths of files git considers untracked and not ignored. */
  listUntracked: () => string[];
  /** Read a vitest config's `test.coverage.exclude` array. */
  loadExcludes: (configPath: string) => Promise<string[]>;
  /** Operator-visible announcement channel. */
  log: (message: string) => void;
}

/**
 * Untracked files that fall inside a target's directory, expressed relative to
 * that directory (which is how the target's own coverage globs are written).
 *
 * Scoping by directory rather than by re-implementing each config's include
 * globs is deliberate: over-matching is harmless here (an untracked file is
 * never part of the gated surface for ANY target), while re-implementing globs
 * would be a second source of truth that drifts from the configs.
 */
export function untrackedWithin(target: CoverageTarget, untracked: string[]): string[] {
  if (target.dir === '') {
    return [...untracked];
  }
  const prefix = `${target.dir}/`;
  return untracked
    .filter((path) => path.startsWith(prefix))
    .map((path) => relative(target.dir, path));
}

/**
 * Extra vitest CLI arguments for one target. Empty when the tree is clean,
 * which is the normal case: a clean checkout runs byte-identically to before
 * this module existed.
 */
export async function scopeArgsForTarget(
  target: CoverageTarget,
  untracked: string[],
  deps: CoverageScopeDeps,
): Promise<string[]> {
  const local = untrackedWithin(target, untracked);
  if (local.length === 0) {
    return [];
  }
  const configured = await deps.loadExcludes(target.configPath);
  deps.log(
    `[cov:ts] NOTICE: excluding ${local.length} untracked file(s) from coverage for ` +
      `${target.dir === '' ? '<repo root>' : target.dir}: ${local.join(', ')}. ` +
      'Untracked scratch files are not part of the gated surface and would ' +
      'otherwise be measured at 0 percent and fail the coverage threshold. ' +
      'Commit or `git add` a file to have it measured.',
  );
  return [...configured, ...local].map((pattern) => `--coverage.exclude=${pattern}`);
}
