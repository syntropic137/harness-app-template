// Sensor-of-sensors determinism guard.
//
// Three sensor PRs in a row (MT01 dead-code, CV01 coverage, PF01
// suite-duration) each passed locally and failed CI because the sensor
// emitted a different value local vs CI. The class of bug: a fitness
// metric whose value depends on hidden environment state (knip's
// resolution of an entry-point map, a wall-clock measurement, a
// CARGO_TARGET_DIR layout) instead of on the source tree only. A
// ratchet floor on a non-deterministic metric fails open or closed at
// random, which is worse than no floor at all.
//
// This file is the meta-guard that prevents the class from recurring:
// for every sensor that gate.mjs consumes, it runs the sensor TWICE in
// a single clean invocation against an identical input and asserts the
// two emitted metric envelopes are byte-identical. Any sensor whose
// value varies between two consecutive runs fails the test with a
// message that names the sensor and shows both values.
//
// Coverage:
//   - deadcode_scan.runDeadcodeScan           (MT01 unused-export-count)
//   - license_scan.scanLicenses               (LG01 denied-license-count)
//   - coverage_scan.buildEnvelopeFromOptions  (CV01 *_line_pct + min_line_pct)
//   - abstractness.analyzeFiles               (MD01 main-sequence distance)
//   - complexity.analyzeFiles                 (MT01 max-cognitive + spread)
//   - apss_topology.analyzeFromTopology       (MT01/MD01/ST01 APSS readings)
//   - aggregate.aggregate                     (downstream Martin per-folder)
//   - sentrux_scan.runSentrux (soft-skip)     (MT01/MD01/ST01 sentrux)
//   - suite_duration.evaluate (mocked io)     (PF01 p95 + iteration-count)
//
// Sensors that are fundamentally clock-bound (suite-duration) are
// tested with an injected `runner` + `now()` so the pure-aggregation
// core (median / p95 / coverage parse) is byte-deterministic. If a
// future refactor of the same core ever introduces a Date.now() / Math.random()
// / non-stable iteration order, this test catches it.
//
// Run via: node --test harness/sensors/tests/determinism.test.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyzeFiles as analyzeAbstractness } from '../abstractness.mjs';
import { aggregate } from '../aggregate.mjs';
import { analyzeFromTopology } from '../apss_topology.mjs';
import { analyzeFiles as analyzeComplexity } from '../complexity.mjs';
import { buildEnvelopeFromOptions } from '../coverage_scan.mjs';
import { runDeadcodeScan } from '../deadcode_scan.mjs';
import { DEFAULT_ROOTS as LICENSE_DEFAULT_ROOTS, scanLicenses } from '../license_scan.mjs';
import { runSentrux } from '../sentrux_scan.mjs';
import { evaluate as evaluateSuiteDuration } from '../suite_duration.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

/**
 * Canonical serializer for envelope comparison. JSON.stringify with
 * `null, 2` matches the on-disk shape that bin/sensors writes via the
 * adapter `--json` flags, so a byte-identical match here implies a
 * byte-identical match in the file the gate consumes.
 */
function serialize(value) {
  return JSON.stringify(value, null, 2);
}

/**
 * Run `produce()` twice and assert the two outputs are byte-identical.
 * Names the sensor in every failure message and includes a unified
 * diff-style preview of the first divergent line + the surrounding
 * context so the operator does not have to eyeball thousands of bytes
 * of JSON.
 */
function assertDeterministic(sensorName, produce) {
  const a = produce();
  const b = produce();
  const sa = serialize(a);
  const sb = serialize(b);
  if (sa === sb) {
    return;
  }
  const lineA = sa.split('\n');
  const lineB = sb.split('\n');
  let firstDiff = -1;
  for (let i = 0; i < Math.max(lineA.length, lineB.length); i += 1) {
    if (lineA[i] !== lineB[i]) {
      firstDiff = i;
      break;
    }
  }
  const preview = (lines, idx) => {
    const from = Math.max(0, idx - 2);
    const to = Math.min(lines.length, idx + 3);
    return lines.slice(from, to).join('\n');
  };
  assert.fail(
    `sensor "${sensorName}" emitted a non-deterministic value between two consecutive runs on identical input.\n` +
      `First divergent line (#${firstDiff + 1}):\n` +
      `--- run 1 ---\n${preview(lineA, firstDiff)}\n` +
      `--- run 2 ---\n${preview(lineB, firstDiff)}\n`,
  );
}

// ---------------------------------------------------------------------------
// Pure-fs adapters (deterministic given the same source tree)
// ---------------------------------------------------------------------------

test('determinism: deadcode_scan runs twice with byte-identical output', () => {
  assertDeterministic('deadcode-grep', () => runDeadcodeScan({ workspaceRoot: REPO_ROOT }));
});

test('determinism: license_scan runs twice with byte-identical output', () => {
  assertDeterministic('license-scan', () =>
    scanLicenses(LICENSE_DEFAULT_ROOTS.map((r) => join(REPO_ROOT, r))),
  );
});

test('determinism: apss_topology runs twice with byte-identical output', () => {
  // analyzeFromTopology degrades cleanly to {available:false, readings:[]}
  // when .topology/ is absent. We assert that the same shape is emitted
  // twice in either branch so the gate's APSS readings never flake.
  assertDeterministic('apss-topology', () => analyzeFromTopology(REPO_ROOT));
});

// ---------------------------------------------------------------------------
// ts-morph adapters (fresh Project per call so we test the input -> output
// purity, not Project-instance state)
// ---------------------------------------------------------------------------

const TS_FILES_SAMPLE = [
  join(REPO_ROOT, 'ws_packages/telemetry/src/index.ts'),
  join(REPO_ROOT, 'ws_packages/telemetry/src/node.ts'),
  join(REPO_ROOT, 'ws_packages/telemetry/src/web.ts'),
  join(REPO_ROOT, 'ws_packages/telemetry/src/resource.ts'),
  join(REPO_ROOT, 'ws_apps/example-typescript/src/main.ts'),
  join(REPO_ROOT, 'ws_apps/example-typescript/src/telemetry.ts'),
];

test('determinism: abstractness ts-morph adapter runs twice with byte-identical output', () => {
  assertDeterministic('ts-morph-abstractness', () => analyzeAbstractness(TS_FILES_SAMPLE));
});

test('determinism: complexity ts-morph adapter runs twice with byte-identical output', () => {
  assertDeterministic('ts-morph-complexity', () => analyzeComplexity(TS_FILES_SAMPLE));
});

// ---------------------------------------------------------------------------
// Coverage parsers (pure JSON in -> envelope out)
// ---------------------------------------------------------------------------

test('determinism: coverage_scan buildEnvelopeFromOptions runs twice with byte-identical output', () => {
  // Fixture JSONs in a temp dir so the test does not depend on a CI-only
  // env path. The fixtures cover all three lanes (rust llvm-cov shape,
  // pytest-cov totals shape, vitest coverage-summary shape) so the
  // composed min_line_pct is exercised.
  const tmpDir = mkdtempSync(join(tmpdir(), 'sensors-determinism-cov-'));
  try {
    const rustPath = join(tmpDir, 'rust.json');
    const pythonPath = join(tmpDir, 'python.json');
    const jsPath = join(tmpDir, 'js.json');
    writeFileSync(
      rustPath,
      JSON.stringify({
        data: [
          {
            totals: {
              lines: { count: 1000, covered: 1000 },
              functions: { count: 200, covered: 200 },
              regions: { count: 1500, covered: 1500 },
            },
          },
        ],
      }),
    );
    writeFileSync(pythonPath, JSON.stringify({ totals: { percent_covered: 100 } }));
    writeFileSync(
      jsPath,
      JSON.stringify({ total: { lines: { total: 50, covered: 50, pct: 100 } } }),
    );
    assertDeterministic('coverage-scan', () =>
      buildEnvelopeFromOptions({
        workspaceRoot: REPO_ROOT,
        rustCovJsonPath: rustPath,
        pythonCovJsonPath: pythonPath,
        javascriptCovJsonPath: jsPath,
      }),
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Aggregate (pure cruiser-JSON -> Martin report)
// ---------------------------------------------------------------------------

const CRUISER_FIXTURE = {
  summary: { totalCruised: 3, totalDependenciesCruised: 4 },
  modules: [
    {
      source: 'ws_packages/telemetry/src/index.ts',
      dependencies: [{ resolved: 'ws_packages/telemetry/src/node.ts' }],
      dependents: ['ws_apps/example-typescript/src/main.ts'],
    },
    {
      source: 'ws_packages/telemetry/src/node.ts',
      dependencies: [],
      dependents: ['ws_packages/telemetry/src/index.ts'],
    },
    {
      source: 'ws_apps/example-typescript/src/main.ts',
      dependencies: [{ resolved: 'ws_packages/telemetry/src/index.ts' }],
      dependents: [],
    },
  ],
  folders: [],
};

test('determinism: aggregate runs twice with byte-identical output', () => {
  assertDeterministic('aggregate', () => aggregate(CRUISER_FIXTURE));
});

// ---------------------------------------------------------------------------
// Sentrux (soft-skip path: binary absent)
// ---------------------------------------------------------------------------

test('determinism: sentrux_scan soft-skip envelope is identical between runs', () => {
  // The binary may or may not be installed in this env. We force the
  // soft-skip branch so the test exercises the envelope shape that is
  // emitted on every fork that has not installed sentrux, and asserts
  // that shape is byte-stable.
  assertDeterministic('sentrux', () =>
    runSentrux({ root: REPO_ROOT, binary: 'sentrux' }, { commandExists: () => false }),
  );
});

// ---------------------------------------------------------------------------
// Suite duration (timing-bound; injected runner + clock)
// ---------------------------------------------------------------------------

const SUITE_DURATION_BASELINE = {
  suite_command: 'true',
  workdir: 'harness/sensors/fixtures/suite_duration_demo',
  iteration_count: 5,
  duration_p95_seconds: 0.5,
  duration_median_seconds: 0.45,
  absolute_seconds_ceiling: 3,
  relative_delta_percent: 25,
  required_coverage_percent: 100,
  coverage_floor_metrics: ['branches', 'functions', 'lines'],
};

const COVERAGE_BLOCK_PASS = `
ℹ start of coverage report
ℹ ------------------------------------------------------------
ℹ file        | line % | branch % | funcs % | uncovered lines
ℹ ------------------------------------------------------------
ℹ  divide.mjs | 100.00 |   100.00 |  100.00 |
ℹ ------------------------------------------------------------
ℹ all files   | 100.00 |   100.00 |  100.00 |
ℹ ------------------------------------------------------------
ℹ end of coverage report
`;

test('determinism: suite_duration evaluate runs twice with byte-identical output', () => {
  // We inject a runner that always returns the same stdout and a
  // clock that returns a deterministic monotonic sequence (start /
  // end pair per iteration). This isolates the pure aggregation
  // (median, p95, coverage parse, ratchet-shape envelope) from the
  // unavoidable wall-clock noise that gave PR #29 trouble in CI.
  //
  // If a future change ever introduces a Date.now()/Math.random()/
  // non-stable iteration order in the aggregation core, this test
  // catches it on the first run.
  const fixedRunner = () => ({ stdout: COVERAGE_BLOCK_PASS, stderr: '', status: 0 });
  const makeFixedNow = () => {
    let i = 0;
    return () => {
      // Pairs of (start, end) per iteration: 0, 100, 100, 200, 200, ...
      // Elapsed = 100 ms per iteration = 0.100 s after the adapter's
      // .toFixed(3) rounding step. Constant across iterations -> p95
      // and median collapse to the same value with no rounding skew.
      const half = Math.floor(i / 2);
      const v = i % 2 === 0 ? half * 100 : (half + 1) * 100;
      i += 1;
      return v;
    };
  };
  assertDeterministic('suite-duration', () => {
    const { envelope } = evaluateSuiteDuration({
      mode: 'enforce',
      baseline: SUITE_DURATION_BASELINE,
      runner: fixedRunner,
      now: makeFixedNow(),
    });
    return envelope;
  });
});
