import { runInherit } from './lib/git';
import { resolveSlotInvocation } from './lib/slots';

export function main(argv: string[]): void {
  const invocation = resolveSlotInvocation('profiling', argv, {
    fallbackEntrypoint: 'harness/profiling/bin/profile',
  });

  if (invocation.disabled) {
    console.log(invocation.message);
    return;
  }

  runInherit(invocation.command, invocation.args);
}

/* v8 ignore next 3 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
