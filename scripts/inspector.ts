import { isMainEntry } from './lib/entrypoint';
import { runInherit } from './lib/git';

export function main(argv: string[]): void {
  runInherit('harness/inspector/bin/inspector', argv);
}

/* v8 ignore next 3 */
if (isMainEntry(import.meta.url)) {
  main(process.argv.slice(2));
}
