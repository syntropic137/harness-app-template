import { isMainEntry } from './lib/entrypoint';
import { runInherit } from './lib/git';

export function main(argv: string[]): void {
  if (argv.includes('--fix')) {
    runInherit('pnpm', [
      'exec',
      'biome',
      'check',
      '.',
      '--write',
      ...argv.filter((arg) => arg !== '--fix'),
    ]);
    return;
  }

  runInherit('pnpm', ['turbo', 'run', 'lint', ...argv]);
}

/* v8 ignore next 3 */
if (isMainEntry(import.meta.url)) {
  main(process.argv.slice(2));
}
