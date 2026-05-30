import { runInherit } from './lib/git';

export function main(argv: string[]): void {
  runInherit('pnpm', ['turbo', 'run', 'test', ...argv]);
  runInherit('pnpm', ['exec', 'vitest', 'run', 'scripts/tests', '--coverage']);
}

/* v8 ignore next 3 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
