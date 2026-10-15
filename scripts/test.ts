import { isMainEntry } from './lib/entrypoint';
import { runInherit } from './lib/git';

/**
 * A land's retry of a gate (ADR-0034 decision 9 flags a retry pass; the land engine sets
 * HARNESS_LAND_RETRY=1 on it) replays turbo's cache but writes no entry, so a pass that needed a
 * retry is never replayed later as a plain green.
 */
export function turboCacheArgs(env: Record<string, string | undefined>): string[] {
  return env.HARNESS_LAND_RETRY === '1' ? ['--cache=local:r'] : [];
}

export function main(argv: string[]): void {
  const cache = turboCacheArgs(process.env);
  runInherit('pnpm', ['turbo', 'run', 'test', '--concurrency=1', ...cache, ...argv]);
  runInherit('pnpm', ['exec', 'vitest', 'run', 'scripts/tests', '--coverage']);
}

/* v8 ignore next 3 */
if (isMainEntry(import.meta.url)) {
  main(process.argv.slice(2));
}
