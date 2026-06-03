import { runInherit } from './lib/git';

const DETACH_ARGS = new Set(['-d', '--detach']);

function withoutDetach(args: string[]): string[] {
  return args.filter((arg) => !DETACH_ARGS.has(arg));
}

export function main(argv: string[]): void {
  const args = argv.filter((arg) => arg !== '--');
  const [command, ...rest] = args;

  if (!command || command === 'up' || DETACH_ARGS.has(command)) {
    console.error('warning: just boot is deprecated; forwarding to just stack boot');
    const bootArgs = command === 'up' ? rest : args;
    runInherit('harness/stack/bin/stack', ['boot', ...withoutDetach(bootArgs)]);
    return;
  }

  if (command === 'stop') {
    console.error('warning: just boot stop is deprecated; forwarding to just stack stop');
    runInherit('harness/stack/bin/stack', ['stop', ...rest]);
    return;
  }

  if (command === 'down') {
    console.error('warning: just boot down is deprecated; forwarding to just stack destroy');
    runInherit('harness/stack/bin/stack', ['destroy', ...withoutDetach(rest)]);
    return;
  }

  console.error('usage: just boot [up|-d|stop|down] [--bug NAME]');
  console.error(
    'use just stack <boot|inspect|ports|stop|destroy|doctor> for the canonical stack-manager entrypoint',
  );
  process.exitCode = 64;
}

/* v8 ignore next 3 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
