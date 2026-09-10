// Entrypoint for the cov-ts pre-push gate (`pnpm test:coverage`).
//
// Each target runs vitest with `--coverage` against its own vitest config, whose
// thresholds this script never touches. On top of that it adds two things:
//
//  1. Coverage scoping (scripts/lib/coverage-scope.ts): untracked scratch
//     files inside a target's coverage globs are excluded from the measured
//     set, loudly, because they are noise rather than a coverage regression.
//  2. A starved-runner retry (scripts/lib/starved-runner.ts): vitest's
//     worker-to-main RPC has a hardcoded 60s timeout with no config knob.
//     lefthook's pre-push phase runs jobs in parallel, so under machine load
//     the main thread can get starved past that deadline while every test
//     and every coverage threshold is still passing. That failure looks like:
//
//       Test Files  69 passed (69)
//       Tests       1250 passed (1250)
//       Duration    405.72s
//       Error: [vitest-worker]: Timeout calling "onTaskUpdate"
//
//     Measured on the same commit, twice: at load average 78 the run took
//     405s and exited 1; at load average <8 the identical run took 141s and
//     exited 0. That is the machine's load, not the code, so it gets exactly
//     one bounded, serialized retry -- loudly announced, never silent.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type CoverageScopeDeps,
  type CoverageTarget,
  scopeArgsForTarget,
} from './lib/coverage-scope';
import { isMainEntry } from './lib/entrypoint';
import { type ExecCaptureResult, execCapture } from './lib/exec-capture';
import { isStarvedRunnerFailure } from './lib/starved-runner';

interface CoverageRun extends CoverageTarget {
  /** Arguments passed to pnpm, before any scoping flags. */
  args: string[];
}

/**
 * Bound vitest's worker fan-out.
 *
 * lefthook runs the pre-push phase with `parallel: true`, so cov-ts runs
 * alongside other jobs (cargo builds, cov-py, typecheck, ...). Under load
 * that means vitest's default fan-out (roughly one worker per core) piles
 * onto an already-oversubscribed box, which is exactly the condition that
 * produces the starved-runner false red described above. Capping the
 * fan-out leaves headroom for the main thread instead of competing with it.
 * This changes no threshold and no assertion -- the same tests run, the same
 * coverage floors apply -- it just does not spawn enough workers to starve
 * its own reporter. Callers can override by passing their own --maxWorkers.
 */
const MAX_WORKERS = '--maxWorkers=2';

/** Forced serialization for the one starved-runner retry. */
const RETRY_MAX_WORKERS = '--maxWorkers=1';

const COVERAGE_RUNS: CoverageRun[] = [
  {
    dir: '',
    configPath: './vitest.config.ts',
    args: ['exec', 'vitest', 'run', 'scripts/tests', '--coverage'],
  },
  {
    dir: 'ws_apps/example-typescript',
    configPath: './ws_apps/example-typescript/vitest.config.ts',
    args: [
      '--dir',
      'ws_apps/example-typescript',
      'exec',
      'vitest',
      'run',
      '--coverage',
      '--exclude',
      'tests/integration/**',
    ],
  },
  {
    dir: 'harness/stack',
    configPath: './harness/stack/vitest.config.ts',
    args: ['--dir', 'harness/stack', 'exec', 'vitest', 'run', '--coverage'],
  },
  {
    dir: 'harness/inspector',
    configPath: './harness/inspector/vitest.config.ts',
    args: ['--dir', 'harness/inspector', 'exec', 'vitest', 'run', '--coverage'],
  },
];

export function listUntrackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });
  return out.split('\n').filter((line) => line.length > 0);
}

/**
 * Read a target's configured `coverage.exclude`. The path is resolved against
 * the repo root and converted to a file URL first: a bare relative specifier
 * would resolve against THIS module's directory (scripts/), silently importing
 * the wrong file or throwing.
 */
export async function loadConfiguredExcludes(
  configPath: string,
  root: string = process.cwd(),
): Promise<string[]> {
  const mod = (await import(pathToFileURL(resolve(root, configPath)).href)) as {
    default?: { test?: { coverage?: { exclude?: string[] } } };
  };
  return mod.default?.test?.coverage?.exclude ?? [];
}

export interface CoverageExecDeps {
  /** Run `pnpm <args>`, capturing combined stdout+stderr while still streaming it live. */
  exec: (args: string[]) => Promise<ExecCaptureResult>;
  /** Operator-visible announcement channel for a starved-runner retry. Distinct from
   *  CoverageScopeDeps.log so a retry warning is never mistaken for a routine scoping notice. */
  warn: (message: string) => void;
}

/** Swap (or append) a forced `--maxWorkers` value into an argv list. */
function withMaxWorkers(args: string[], value: string): string[] {
  const replaced = args.map((arg) => (arg.startsWith('--maxWorkers') ? value : arg));
  return replaced.some((arg) => arg.startsWith('--maxWorkers')) ? replaced : [...replaced, value];
}

/**
 * Run one `pnpm <args>` coverage target, retrying exactly once -- serialized
 * to a single worker -- if and only if the failure matches the
 * starved-runner signature (see scripts/lib/starved-runner.ts). Any other
 * failure, and a failed retry, is reported as-is.
 */
export async function runCoverageTarget(args: string[], deps: CoverageExecDeps): Promise<void> {
  const first = await deps.exec(args);
  if (first.status === 0) {
    return;
  }
  if (!isStarvedRunnerFailure(first.output)) {
    throw new Error(`pnpm ${args.join(' ')} failed with exit code ${first.status}`);
  }
  const retryArgs = withMaxWorkers(args, RETRY_MAX_WORKERS);
  deps.warn(
    '[cov:ts] WARNING: retrying after a starved-runner false red. Every test passed and every ' +
      "coverage threshold was met, but vitest's worker-to-main RPC hit its hardcoded 60s birpc " +
      'timeout under machine load (no config knob for this deadline exists). Retrying once, ' +
      `serialized: pnpm ${retryArgs.join(' ')}`,
  );
  const second = await deps.exec(retryArgs);
  if (second.status !== 0) {
    throw new Error(
      `pnpm ${retryArgs.join(' ')} failed with exit code ${second.status} after a starved-runner retry`,
    );
  }
}

export async function main(
  argv: string[] = [],
  runs: CoverageRun[] = COVERAGE_RUNS,
  // Exercised only by the real un-injected CLI entrypoint below; every test drives
  // main() with an explicit deps object instead.
  deps: CoverageScopeDeps & CoverageExecDeps = {
    listUntracked: listUntrackedFiles,
    loadExcludes: loadConfiguredExcludes,
    /* v8 ignore next */
    log: (message: string) => console.log(message),
    /* v8 ignore next */
    exec: (args: string[]) => execCapture('pnpm', args),
    /* v8 ignore next */
    warn: (message: string) => console.error(message),
  },
): Promise<void> {
  const untracked = deps.listUntracked();
  const overridesWorkers = argv.some((a) => a.startsWith('--maxWorkers'));
  for (const run of runs) {
    const scope = await scopeArgsForTarget(run, untracked, deps);
    const args = [...run.args, ...(overridesWorkers ? [] : [MAX_WORKERS]), ...scope, ...argv];
    await runCoverageTarget(args, deps);
  }
}

/* v8 ignore next 3 */
if (isMainEntry(import.meta.url)) {
  await main(process.argv.slice(2));
}
