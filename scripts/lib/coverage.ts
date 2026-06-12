// HARNESS-ENGINEERING PROTECTED CONFIG / DO NOT ADJUST.
// Per-language coverage lane definitions for the `just cov-*` recipes
// (ADR-0013-coverage-enforcement.md). The justfile recipes stay thin and
// dispatch into scripts/coverage.ts; every threshold, flag, and isolation
// rule lives here so it is typed, testable, and reviewable in one place.
//
// Rust lanes: the root Cargo workspace intentionally contains only
// ws_apps/example-rust; harness/doc-validator and harness/versioning are
// self-contained slot workspaces (each carries its own [workspace] block by
// design, so the root never pulls slot stubs in transitively) and are
// covered by explicit --manifest-path invocations. Thresholds are pinned to
// protected baselines: example-rust stays 100/100/100, and doc-validator and
// versioning enforce 100 percent lines and functions over their library
// business logic. main.rs files are built separately and excluded per the
// ADR-0013 opt-out table because they are CLI shells with no business logic.
// These flags must stay aligned with the CV01 RUST_LANES table in
// harness/sensors/coverage_scan.mjs (the fitness ratchet measures with the
// same invocations).
//
// Disk hygiene: every Rust coverage command builds with the dedicated `cov`
// cargo profile (defined in the root Cargo.toml and mirrored in the
// self-contained slot workspaces harness/doc-validator and
// harness/versioning) and pins CARGO_INCREMENTAL=0. llvm-cov line, function,
// and region mapping comes from -C instrument-coverage, not from debuginfo,
// so the profile's line-tables-only debuginfo keeps coverage numbers
// byte-identical while shedding the full debuginfo and incremental caches
// that balloon CARGO_TARGET_DIR on instrumented builds.
//
// Worktree isolation: every cargo llvm-cov command pins CARGO_TARGET_DIR to
// a worktree-local path. Hosts (e.g. the swarm VPS) commonly export a shared
// CARGO_TARGET_DIR to amortise the cargo build cache across projects;
// without this override two worktrees running `just cov-rust` concurrently
// would write *.profraw into the same llvm-cov-target/ directory and corrupt
// each other's coverage reports (cargo-llvm-cov collects every profraw in
// that dir at report time, so a foreign run's PID-suffixed file looks like
// one of ours). Pinning to <repo>/target/coverage-isolated keeps each
// worktree's build artefacts and profraw inside the worktree.
import { join } from 'node:path';

export interface CoverageCommand {
  command: string;
  args: string[];
  /** Working directory relative to the repo root; repo root when absent. */
  cwd?: string;
  /** Extra environment entries layered over process.env. */
  env?: Record<string, string>;
}

export const COVERAGE_LANES = [
  'rust',
  'example-rust',
  'doc-validator',
  'versioning',
  'py',
  'sensors',
] as const;

export type CoverageLane = (typeof COVERAGE_LANES)[number];

export function isCoverageLane(value: string): value is CoverageLane {
  return (COVERAGE_LANES as readonly string[]).includes(value);
}

export function coverageTargetDir(root: string): string {
  return join(root, 'target', 'coverage-isolated');
}

interface RustLane {
  manifestPath: string;
  packageName: string;
  /** CLI shell binary to prebuild so --lib coverage still ships a runnable bin. */
  prebuildBin?: string;
  /** Restrict measurement to the library target (slot crates with main.rs shells). */
  libOnly: boolean;
  ignoreFilenameRegex?: string;
  failUnderLines: number;
  failUnderFunctions: number;
  failUnderRegions?: number;
}

const RUST_LANES: Record<'example-rust' | 'doc-validator' | 'versioning', RustLane> = {
  'example-rust': {
    manifestPath: 'ws_apps/example-rust/Cargo.toml',
    packageName: 'example-rust',
    libOnly: false,
    failUnderLines: 100,
    failUnderFunctions: 100,
    failUnderRegions: 100,
  },
  'doc-validator': {
    manifestPath: 'harness/doc-validator/Cargo.toml',
    packageName: 'harness-doc-validator',
    prebuildBin: 'harness-doc-validator',
    libOnly: true,
    ignoreFilenameRegex: 'main\\.rs',
    failUnderLines: 100,
    failUnderFunctions: 100,
  },
  versioning: {
    manifestPath: 'harness/versioning/Cargo.toml',
    packageName: 'harness-versioning',
    prebuildBin: 'harness-versioning',
    libOnly: true,
    ignoreFilenameRegex: 'main\\.rs',
    failUnderLines: 100,
    failUnderFunctions: 100,
  },
};

// Sensors slot coverage floor (node:test built-in coverage over the slot's
// own suite, `node --test tests/*.test.mjs` from harness/sensors). Measured
// over five runs on 2026-06-11 (node 26): 69.31-70.19 lines, 72.08-73.23
// branches, 64.59-65.35 functions; the spread comes from environment-probing
// paths (license_scan, sentrux_scan) whose coverage varies run to run.
// Floors sit roughly two points below the worst observed run to absorb that
// spread plus V8 coverage-counting variance across node versions (CI pins
// node 22). Ratchet upward as the slot's test suite grows; never lower
// without an ADR-0013 update.
export const SENSORS_COVERAGE_FLOOR = {
  lines: 67,
  branches: 70,
  functions: 62,
} as const;

function rustLaneCommands(lane: RustLane, root: string): CoverageCommand[] {
  const env = { CARGO_TARGET_DIR: coverageTargetDir(root), CARGO_INCREMENTAL: '0' };
  const commands: CoverageCommand[] = [];
  if (lane.prebuildBin) {
    commands.push({
      command: 'cargo',
      args: [
        'build',
        '--manifest-path',
        lane.manifestPath,
        '--bin',
        lane.prebuildBin,
        '--profile',
        'cov',
      ],
      env,
    });
  }
  const args = [
    'llvm-cov',
    '--manifest-path',
    lane.manifestPath,
    '--package',
    lane.packageName,
    '--profile',
    'cov',
  ];
  if (lane.libOnly) {
    args.push('--lib');
  }
  if (lane.ignoreFilenameRegex) {
    args.push('--ignore-filename-regex', lane.ignoreFilenameRegex);
  }
  args.push('--fail-under-lines', String(lane.failUnderLines));
  args.push('--fail-under-functions', String(lane.failUnderFunctions));
  if (lane.failUnderRegions !== undefined) {
    args.push('--fail-under-regions', String(lane.failUnderRegions));
  }
  commands.push({ command: 'cargo', args, env });
  return commands;
}

function pythonCommands(): CoverageCommand[] {
  // The 100 percent threshold lives in ws_apps/example-python/pyproject.toml
  // [tool.pytest.ini_options] (--cov-fail-under=100); this lane dispatches
  // pytest with the right project root so config and .coverage stay local.
  return [
    {
      command: 'sh',
      args: ['scripts/with-uv.sh', 'uv', 'run', 'pytest'],
      cwd: 'ws_apps/example-python',
    },
  ];
}

function sensorsCommands(): CoverageCommand[] {
  // node expands the tests/*.test.mjs glob itself (test-runner globbing,
  // node >= 21), so the pattern is passed literally and works without a
  // shell. Excludes keep the measurement scoped to the slot's .mjs modules.
  return [
    {
      command: 'node',
      args: [
        '--test',
        '--experimental-test-coverage',
        '--test-coverage-exclude=tests/**',
        '--test-coverage-exclude=fixtures/**',
        `--test-coverage-lines=${SENSORS_COVERAGE_FLOOR.lines}`,
        `--test-coverage-branches=${SENSORS_COVERAGE_FLOOR.branches}`,
        `--test-coverage-functions=${SENSORS_COVERAGE_FLOOR.functions}`,
        'tests/*.test.mjs',
      ],
      cwd: 'harness/sensors',
    },
  ];
}

export function commandsForLane(lane: CoverageLane, root: string): CoverageCommand[] {
  switch (lane) {
    case 'rust':
      return [
        ...rustLaneCommands(RUST_LANES['example-rust'], root),
        ...rustLaneCommands(RUST_LANES['doc-validator'], root),
        ...rustLaneCommands(RUST_LANES.versioning, root),
      ];
    case 'example-rust':
      return rustLaneCommands(RUST_LANES['example-rust'], root);
    case 'doc-validator':
      return rustLaneCommands(RUST_LANES['doc-validator'], root);
    case 'versioning':
      return rustLaneCommands(RUST_LANES.versioning, root);
    case 'py':
      return pythonCommands();
    case 'sensors':
      return sensorsCommands();
  }
}
