import { isMainEntry } from './lib/entrypoint';
import { runInherit } from './lib/git';

export function main(argv: string[]): void {
  runInherit('cargo', argv);
}

/* v8 ignore next 3 */
if (isMainEntry(import.meta.url)) {
  main(process.argv.slice(2));
}
