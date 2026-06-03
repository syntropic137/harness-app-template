import { runInherit } from './lib/git';

const COVERAGE_TARGETS = [
  ['exec', 'vitest', 'run', 'scripts/tests', '--coverage'],
  [
    '--dir',
    'ws_apps/example-typescript',
    'exec',
    'vitest',
    'run',
    '--coverage',
    '--exclude',
    'tests/integration/**',
  ],
  ['--dir', 'harness/stack', 'exec', 'vitest', 'run', '--coverage'],
  ['--dir', 'harness/inspector', 'exec', 'vitest', 'run', '--coverage'],
];

export function main(argv: string[] = []): void {
  for (const target of COVERAGE_TARGETS) {
    runInherit('pnpm', [...target, ...argv]);
  }
}

/* v8 ignore next 3 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
