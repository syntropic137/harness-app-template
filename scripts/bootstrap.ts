import { runInherit } from './lib/git';

export function main(): void {
  runInherit('bun', ['--version']);
  runInherit('pnpm', ['install']);
  runInherit('cargo', ['check']);
  runInherit('uv', ['sync']);
}

/* v8 ignore next 3 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
