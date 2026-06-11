import { isMainEntry } from './lib/entrypoint';
import { runInherit } from './lib/git';
import { resolveSlotInvocation } from './lib/slots';

export function main(argv: string[]): void {
  const invocation = resolveSlotInvocation('sensors', argv, {
    fallbackEntrypoint: 'harness/sensors/bin/sensors',
  });

  if (invocation.disabled) {
    console.log(invocation.message);
    return;
  }

  runInherit(invocation.command, invocation.args);
}

/* v8 ignore next 3 */
if (isMainEntry(import.meta.url)) {
  main(process.argv.slice(2));
}
