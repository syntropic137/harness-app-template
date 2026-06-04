import { runInherit } from './git';

export type CoverageTarget = readonly string[];

export const SENSOR_TEST_FILES = [
  'scripts/tests/sensors-adapters.test.ts',
  'scripts/tests/sensors-apss-fitness.test.ts',
  'scripts/tests/sensors-apss-topology.test.ts',
  'scripts/tests/sensors-abstractness.test.ts',
  'scripts/tests/sensors-aggregate.test.ts',
  'scripts/tests/sensors-complexity.test.ts',
  'scripts/tests/sensors-gate.test.ts',
  'scripts/tests/sensors-license-scan.test.ts',
] as const;

export const SENSORS_COVERAGE_TARGET = [
  'exec',
  'vitest',
  'run',
  ...SENSOR_TEST_FILES,
  '--coverage',
  '--coverage.include=harness/sensors/**/*.mjs',
  '--coverage.exclude=harness/sensors/bin/**',
  '--coverage.all=true',
  '--coverage.thresholds.lines=84',
  '--coverage.thresholds.functions=84',
  '--coverage.thresholds.branches=83',
  '--coverage.thresholds.statements=84',
] as const;

export const PACKAGE_COVERAGE_TARGETS = [
  ['exec', 'vitest', 'run', 'scripts/tests', '--coverage'],
  [
    '--dir',
    'ws_apps/example-typescript',
    'exec',
    'vitest',
    'run',
    '--coverage',
    '--exclude',
    'tests/integration/**',
  ],
  ['--dir', 'harness/stack', 'exec', 'vitest', 'run', '--coverage'],
  ['--dir', 'harness/inspector', 'exec', 'vitest', 'run', '--coverage'],
  SENSORS_COVERAGE_TARGET,
] as const;

export function runPnpmCoverageTargets(
  targets: readonly CoverageTarget[],
  argv: string[] = [],
): void {
  for (const target of targets) {
    runInherit('pnpm', [...target, ...argv]);
  }
}
