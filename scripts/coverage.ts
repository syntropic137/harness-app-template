// Entrypoint for the `just cov-*` recipes (ADR-0013-coverage-enforcement.md).
// Usage: bun run scripts/coverage.ts <lane>
// Lane definitions, thresholds, and worktree isolation live in
// scripts/lib/coverage.ts.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { COVERAGE_LANES, type CoverageLane, commandsForLane, isCoverageLane } from './lib/coverage';
import { isMainEntry } from './lib/entrypoint';

export interface CoverageDeps {
  spawn: typeof spawnSync;
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  exit: (code: number) => never;
  cwd?: string;
}

function runLane(lane: CoverageLane, root: string, deps: CoverageDeps): void {
  for (const cmd of commandsForLane(lane, root)) {
    deps.stdout.log(`[cov:${lane}] ${cmd.command} ${cmd.args.join(' ')}`);
    const result = deps.spawn(cmd.command, cmd.args, {
      cwd: cmd.cwd ? join(root, cmd.cwd) : root,
      stdio: 'inherit',
      env: cmd.env ? { ...process.env, ...cmd.env } : process.env,
    });
    if (result.status !== 0) {
      const detail = result.error
        ? `failed to run (${result.error.message})`
        : `exited with ${result.status ?? 'signal'}`;
      deps.stderr.error(`[cov:${lane}] FAIL: ${cmd.command} ${detail}`);
      deps.exit(result.status ?? 1);
    }
  }
}

export function main(argv: string[], deps: CoverageDeps): void {
  const lane = argv[0] ?? '';
  if (!isCoverageLane(lane)) {
    deps.stderr.error(`usage: coverage.ts <${COVERAGE_LANES.join('|')}>`);
    deps.exit(64);
  }
  runLane(lane, deps.cwd ?? process.cwd(), deps);
}

/* v8 ignore next 9 */
if (isMainEntry(import.meta.url)) {
  main(process.argv.slice(2), {
    spawn: spawnSync,
    stdout: console,
    stderr: console,
    exit: (code: number): never => process.exit(code),
  });
}
