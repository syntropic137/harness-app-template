import { runInherit } from './lib/git';

export function main(argv: string[]): void {
  runInherit('harness/stack/bin/stack', ['boot', ...argv]);
}

/* v8 ignore next 3 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
