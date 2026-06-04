import { runPnpmCoverageTargets, SENSORS_COVERAGE_TARGET } from './lib/coverage';

export function main(argv: string[] = []): void {
  runPnpmCoverageTargets([SENSORS_COVERAGE_TARGET], argv);
}

/* v8 ignore next 3 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
