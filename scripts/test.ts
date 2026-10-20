// Entrypoint for `just test` / `pnpm test`.
//
// Two steps, deliberately run through two different mechanisms:
//
//  1. `pnpm turbo run test` -- multi-package, long-lived, and the thing a
//     human actually watches scroll by. It stays on `runInherit` so its
//     stdio is handed straight to the child, unbuffered.
//  2. `pnpm exec vitest run scripts/tests --coverage` -- the same command
//     the cov-ts gate runs, and therefore subject to the same starved-runner
//     false red (see scripts/lib/starved-runner.ts): vitest's worker-to-main
//     RPC has a hardcoded 60s timeout with no config knob, so under machine
//     load a run whose tests all pass and whose coverage thresholds are all
//     met can still exit 1 with:
//
//       Test Files  69 passed (69)
//       Tests       1250 passed (1250)
//       Error: [vitest-worker]: Timeout calling "onTaskUpdate"
//
//     scripts/test-coverage.ts already retries that; this script did not,
//     so the identical failure read as a real red here. It now runs through
//     execCapture (live stdio preserved, output also captured) and gets
//     exactly one bounded, serialized, loudly-announced retry.
import { isMainEntry } from './lib/entrypoint';
import { type ExecCaptureResult, execCapture } from './lib/exec-capture';
import { runInherit } from './lib/git';
import { isStarvedRunnerFailure } from './lib/starved-runner';

/** Forced serialization for the one starved-runner retry. */
const RETRY_MAX_WORKERS = '--maxWorkers=1';

/** The script-coverage step, before any retry flags. */
const SCRIPT_COVERAGE_ARGS = ['exec', 'vitest', 'run', 'scripts/tests', '--coverage'];

export interface TestExecDeps {
  /** Run `pnpm <args>`, capturing combined stdout+stderr while still streaming it live. */
  exec: (args: string[]) => Promise<ExecCaptureResult>;
  /** Operator-visible announcement channel for a starved-runner retry. */
  warn: (message: string) => void;
  /** Streaming (uncaptured) runner, used for the multi-package turbo step. */
  runInherit: (command: string, args: string[]) => void;
}

/** Swap (or append) a forced `--maxWorkers` value into an argv list. */
function withMaxWorkers(args: string[], value: string): string[] {
  const replaced = args.map((arg) => (arg.startsWith('--maxWorkers') ? value : arg));
  return replaced.some((arg) => arg.startsWith('--maxWorkers')) ? replaced : [...replaced, value];
}

/**
 * Run the `pnpm <args>` script-coverage step, retrying exactly once --
 * serialized to a single worker -- if and only if the failure matches the
 * starved-runner signature. Any other failure, and a failed retry, is
 * reported as-is, so a real red is never masked.
 */
export async function runScriptCoverage(args: string[], deps: TestExecDeps): Promise<void> {
  const first = await deps.exec(args);
  if (first.status === 0) {
    return;
  }
  if (!isStarvedRunnerFailure(first.output)) {
    throw new Error(`pnpm ${args.join(' ')} failed with exit code ${first.status}`);
  }
  const retryArgs = withMaxWorkers(args, RETRY_MAX_WORKERS);
  deps.warn(
    '[test] WARNING: retrying after a starved-runner false red. Every test passed and every ' +
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
  // Exercised only by the real un-injected CLI entrypoint below; every test drives
  // main() with an explicit deps object instead.
  deps: TestExecDeps = {
    /* v8 ignore next */
    exec: (args: string[]) => execCapture('pnpm', args),
    /* v8 ignore next */
    warn: (message: string) => console.error(message),
    runInherit,
  },
): Promise<void> {
  deps.runInherit('pnpm', ['turbo', 'run', 'test', '--concurrency=1', ...argv]);
  await runScriptCoverage(SCRIPT_COVERAGE_ARGS, deps);
}

/* v8 ignore next 3 */
if (isMainEntry(import.meta.url)) {
  await main(process.argv.slice(2));
}
