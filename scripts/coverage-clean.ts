// Clears what earlier `just cov-*` runs left in the isolated coverage target dir, so a reused
// worktree (the landing worktree, a verification slot) measures only objects built from the source
// it holds. Land runs it as a `prepare` step before a Rust coverage gate (land.config.json).
// Usage: bun run scripts/coverage-clean.ts <lane>
// A machine without cargo-llvm-cov cannot run the Rust coverage lanes either, so there is nothing
// to clean: it says so and exits 0.
import { spawnSync } from 'node:child_process';
import { COVERAGE_LANES, cleanCommandsForLane, isCoverageLane } from './lib/coverage';
import { isMainEntry } from './lib/entrypoint';

export interface CoverageCleanDeps {
  spawn: typeof spawnSync;
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  cwd: string;
}

function hasLlvmCov(deps: CoverageCleanDeps): boolean {
  const probe = deps.spawn('cargo', ['llvm-cov', '--version'], { stdio: 'ignore' });
  return probe.status === 0;
}

/** Runs the clean for `argv[0]`'s lane; returns the exit code. */
export function main(argv: string[], deps: CoverageCleanDeps): number {
  const lane = argv[0] ?? '';
  if (!isCoverageLane(lane)) {
    deps.stderr.error(`usage: coverage-clean.ts <${COVERAGE_LANES.join('|')}>`);
    return 64;
  }
  const commands = cleanCommandsForLane(lane, deps.cwd);
  if (commands.length > 0 && !hasLlvmCov(deps)) {
    deps.stdout.log(`[cov-clean:${lane}] cargo-llvm-cov is not installed; nothing to clean`);
    return 0;
  }
  for (const cmd of commands) {
    deps.stdout.log(`[cov-clean:${lane}] ${cmd.command} ${cmd.args.join(' ')}`);
    const result = deps.spawn(cmd.command, cmd.args, {
      cwd: deps.cwd,
      stdio: 'inherit',
      env: { ...process.env, ...cmd.env },
    });
    if (result.status !== 0) {
      const detail = result.error
        ? `failed to run (${result.error.message})`
        : `exited with ${result.status ?? 'signal'}`;
      deps.stderr.error(`[cov-clean:${lane}] FAIL: ${cmd.command} ${detail}`);
      return result.status ?? 1;
    }
  }
  return 0;
}

/* v8 ignore next 8 */
if (isMainEntry(import.meta.url)) {
  process.exit(
    main(process.argv.slice(2), {
      spawn: spawnSync,
      stdout: console,
      stderr: console,
      cwd: process.cwd(),
    }),
  );
}
