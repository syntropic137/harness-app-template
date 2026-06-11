import { isMainEntry } from './lib/entrypoint';
import { runInherit } from './lib/git';

export function main(argv: string[]): void {
  runInherit('pnpm', ['turbo', 'run', 'test', '--concurrency=1', ...argv]);
  runInherit('pnpm', ['exec', 'vitest', 'run', 'scripts/tests', '--coverage']);
}

/* v8 ignore next 3 */
if (isMainEntry(import.meta.url)) {
  main(process.argv.slice(2));
}
