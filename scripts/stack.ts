import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInherit } from './lib/git';

const HELP_ARGS = new Set(['--help', '-h', 'help']);
const STACK_USAGE = 'Usage: harness <boot|inspect|ports|stop|destroy|doctor> [...args]';

export function main(argv: string[]): void {
  const [cmd] = argv.filter((a) => a !== '--');

  /* v8 ignore next 4 */
  if (cmd && HELP_ARGS.has(cmd)) {
    console.log(STACK_USAGE);
    return;
  }

  runInherit('harness/stack/bin/stack', argv);
}

/* v8 ignore start */
function isEntrypoint(metaUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return fileURLToPath(metaUrl) === argv1;
  }
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2));
}
/* v8 ignore stop */
