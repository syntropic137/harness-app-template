import { isMainEntry } from './lib/entrypoint';
import { runInherit } from './lib/git';

export function main(argv: string[]): void {
  runInherit('harness/versioning/bin/versioning', argv);
}

/* v8 ignore next 3 */
if (isMainEntry(import.meta.url)) {
  main(process.argv.slice(2));
}
