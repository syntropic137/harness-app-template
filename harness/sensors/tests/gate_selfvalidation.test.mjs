// gate_selfvalidation.test.mjs - integration self-validation of the
// fitness gates against synthesized regressions.
//
// This suite is DISTINCT from ratchet.test.mjs / sentrux.test.mjs /
// complexity.test.mjs / cx_gate.test.mjs - those exercise the ratchet
// math and per-piece comparators with stubbed primitives. This file
// proves the CLOSED LOOP: each fitness lens, driven through its real
// entry point (cx_gate.main / gate.mjs main), fails on a deliberately-
// regressed fixture and passes once the regression is removed.
//
// One test per lens; each test runs BOTH the regression and clean cases
// against an isolated temp dir / synthetic envelope, so it cannot
// pollute the real repo's baseline.json or .topology snapshot. A
// MATRIX[] accumulator records the pass/fail of each direction; the
// final test asserts every lens closed the loop in both directions and
// prints the matrix to stdout for the gate-self-validation report.
//
// Run via: node --test harness/sensors/tests/gate_selfvalidation.test.mjs

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BASELINE_RELAXATION_APPROVAL_KEY,
  dimensionRelaxationPath,
  evaluateBaselineRelaxationGuard,
  folderRelaxationPath,
} from '../baseline_guard.mjs';
import { main as cxGateMain } from '../cx_gate.mjs';
import { compareBaseline, extractApssFitnessBaseline, main as fitnessGateMain } from '../gate.mjs';

/**
 * MATRIX accumulator. Each entry: { lens, failsOnRegression, passesOnClean,
 * failureFingerprint, durationMs }. Rendered by the trailing
 * "self-validation matrix" test.
 */
const MATRIX = [];

function record(entry) {
  MATRIX.push(entry);
}

function hasViolation(result, path, reason) {
  if (reason === undefined) {
    return result.violations.some((v) => v.path === path);
  }
  return result.violations.some((v) => v.path === path && v.reason === reason);
}

// ---------------------------------------------------------------------
// Helpers shared by every lens test.
// ---------------------------------------------------------------------

function makeTempRoot(label) {
  const root = mkdtempSync(join(tmpdir(), `gate-selfval-${label}-`));
  mkdirSync(join(root, 'ws_apps', 'fixture', 'src'), { recursive: true });
  mkdirSync(join(root, 'harness', 'sensors'), { recursive: true });
  return root;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function relaxationReferenceBaseline() {
  return {
    schema_version: '1.0.0',
    standard: 'APS-V1-0002',
    generated_by: 'harness/sensors/gate.mjs',
    folders: {
      'ws_apps/fixture/src': {
        I: 0.4,
        D: 0.4,
      },
    },
    dimensions: {
      MT01: {
        metrics: {
          'max-cyclomatic': {
            direction: 'max',
            baseline: 6,
          },
          'sentrux-quality-signal': {
            direction: 'min',
            baseline: 0.8,
          },
        },
      },
    },
  };
}

function writeBaseline(root, baseline) {
  const path = join(root, 'harness', 'sensors', 'baseline.json');
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
  return path;
}

function capturingIo({ stdin = '{}', files = {} } = {}) {
  const written = { ...files };
  const writes = [];
  const stdout = [];
  const stderr = [];
  return {
    io: {
      read: async () => stdin,
      write: (s) => stdout.push(s),
      writeErr: (s) => stderr.push(s),
      readFile: (p) => {
        if (!(p in written)) {
          throw new Error(`stub: no such file ${p}`);
        }
        return written[p];
      },
      writeFile: (p, s) => {
        written[p] = s;
        writes.push({ path: p, content: s });
      },
      fileExists: (p) => p in written,
      env: {},
    },
    writes,
    written,
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
  };
}

// ---------------------------------------------------------------------
// Lens 1 - cyclomatic complexity (real ts-morph parse, real fs walk).
// Drives cx_gate.main against an isolated fixture workspace; the fixture
// only contains the file the test writes, so no other workspace code
// leaks in.
// ---------------------------------------------------------------------

function highCyclomaticSource() {
  // 12 if/else-if branches → cyclomatic complexity well above the
  // baseline floor of 5 used below. No nested function definitions, so
  // the spike is concentrated in this one function's max_cyclomatic.
  return `export function classify(value: number): string {
  if (value < 0) return 'neg';
  if (value === 0) return 'zero';
  if (value < 10) return 'tiny';
  if (value < 100) return 'small';
  if (value < 1000) return 'med';
  if (value < 10000) return 'large';
  if (value < 100000) return 'huge';
  if (value === 100000) return 'edge-low';
  if (value === 100001) return 'edge-high';
  if (value > 1000000) return 'mega';
  if (value > 10000000) return 'giga';
  if (value > 100000000) return 'tera';
  return 'unknown';
}
`;
}

function cleanCyclomaticSource() {
  return `export function classify(value: number): string {
  return value < 0 ? 'neg' : value === 0 ? 'zero' : 'pos';
}
`;
}

test('lens=cyclomatic: cx_gate FAILS on synthesized regression, PASSES once removed', async () => {
  const root = makeTempRoot('cx');
  try {
    // Floors: max-cognitive=6, max-cyclomatic=5, high-cognitive-fn-count=0.
    // The clean fixture sits at (max-cog<=3, max-cyc<=2, high-cog=0) so
    // every direction:max metric is at or below the floor.
    const baselinePath = writeBaseline(root, {
      schema_version: '1.0.0',
      folders: {},
      dimensions: {
        MT01: {
          metrics: {
            'max-cognitive': { direction: 'max', baseline: 6, fail_on_regression: true },
            'max-cyclomatic': { direction: 'max', baseline: 5, fail_on_regression: true },
            'high-cognitive-fn-count': {
              direction: 'max',
              baseline: 0,
              fail_on_regression: true,
            },
          },
        },
      },
    });

    const fixtureFile = join(root, 'ws_apps', 'fixture', 'src', 'classify.ts');

    // (a) CLEAN: low-complexity workspace passes.
    writeFileSync(fixtureFile, cleanCyclomaticSource());
    const cleanIo = ioCapture();
    const cleanStart = Date.now();
    const cleanCode = await cxGateMain(
      [`--repo-root=${root}`, `--baseline=${baselinePath}`, '--format=json'],
      cleanIo.io,
    );
    const cleanMs = Date.now() - cleanStart;
    assert.equal(cleanCode, 0, `clean run should pass; stderr=${cleanIo.stderr()}`);
    const cleanPayload = JSON.parse(cleanIo.stdout());
    assert.equal(cleanPayload.ok, true);
    assert.deepEqual(cleanPayload.failures, []);

    // (b) REGRESSION: a single high-cyclomatic function trips the gate.
    writeFileSync(fixtureFile, highCyclomaticSource());
    const regIo = ioCapture();
    const regStart = Date.now();
    const regCode = await cxGateMain(
      [`--repo-root=${root}`, `--baseline=${baselinePath}`, '--format=json'],
      regIo.io,
    );
    const regMs = Date.now() - regStart;
    assert.equal(regCode, 1, `regression run should fail; stdout=${regIo.stdout()}`);
    const regPayload = JSON.parse(regIo.stdout());
    assert.equal(regPayload.ok, false);
    const cycHit = regPayload.failures.find((f) => f.metric === 'max-cyclomatic');
    assert.ok(
      cycHit,
      `expected max-cyclomatic failure; got ${JSON.stringify(regPayload.failures)}`,
    );
    assert.ok(cycHit.current > cycHit.floor, 'reported current must exceed reported floor');

    // (c) Restoring the clean source closes the loop: gate passes again
    // without any baseline change. Proves the gate is reading the
    // current source, not caching a verdict.
    writeFileSync(fixtureFile, cleanCyclomaticSource());
    const restoredIo = ioCapture();
    const restoredCode = await cxGateMain(
      [`--repo-root=${root}`, `--baseline=${baselinePath}`, '--format=json'],
      restoredIo.io,
    );
    assert.equal(restoredCode, 0, 'restoring clean source should re-pass');

    // Fast-feedback assertion: cx_gate must run on a single-file
    // fixture in well under a second. Generous wall-clock cap so CI
    // jitter does not flake the test; the in-process bench typically
    // lands under 200 ms.
    assert.ok(regMs < 5000, `cx-gate should fail FAST on a tiny fixture; took ${regMs} ms`);

    record({
      lens: 'cyclomatic',
      failsOnRegression: true,
      passesOnClean: true,
      failureFingerprint: `max-cyclomatic ${cycHit.current}>${cycHit.floor}`,
      durationMs: { regression: regMs, clean: cleanMs },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------
// Lens 2 - cognitive complexity (same cx_gate end-to-end shape, distinct
// source pattern: deeply nested control flow drives cognitive complexity
// up without necessarily peaking cyclomatic).
// ---------------------------------------------------------------------

function highCognitiveSource() {
  // Sonar-shaped: each nested control-flow break adds 1 + depth. The
  // five-level nest yields a cognitive score >> 6 (the floor used
  // below) while keeping cyclomatic at a moderate value, so this test
  // exercises cognitive specifically.
  return `export function nest(values: number[]): number {
  let total = 0;
  for (const v of values) {
    if (v > 0) {
      if (v % 2 === 0) {
        if (v > 100) {
          if (v < 1000) {
            for (const inner of [1, 2, 3]) {
              if (inner === 2) {
                total += v * inner;
              }
            }
          }
        }
      }
    }
  }
  return total;
}
`;
}

function cleanCognitiveSource() {
  return `export function nest(values: number[]): number {
  return values.filter((v) => v > 0).reduce((a, b) => a + b, 0);
}
`;
}

test('lens=cognitive: cx_gate FAILS on synthesized regression, PASSES once removed', async () => {
  const root = makeTempRoot('cog');
  try {
    const baselinePath = writeBaseline(root, {
      schema_version: '1.0.0',
      folders: {},
      dimensions: {
        MT01: {
          metrics: {
            'max-cognitive': { direction: 'max', baseline: 6, fail_on_regression: true },
            'max-cyclomatic': { direction: 'max', baseline: 20, fail_on_regression: true },
            'high-cognitive-fn-count': {
              direction: 'max',
              baseline: 0,
              fail_on_regression: true,
            },
          },
        },
      },
    });
    const fixtureFile = join(root, 'ws_apps', 'fixture', 'src', 'nest.ts');

    writeFileSync(fixtureFile, cleanCognitiveSource());
    const cleanIo = ioCapture();
    const cleanCode = await cxGateMain(
      [`--repo-root=${root}`, `--baseline=${baselinePath}`, '--format=json'],
      cleanIo.io,
    );
    assert.equal(cleanCode, 0, 'clean cognitive fixture should pass');
    const cleanPayload = JSON.parse(cleanIo.stdout());
    assert.equal(cleanPayload.ok, true);

    writeFileSync(fixtureFile, highCognitiveSource());
    const regIo = ioCapture();
    const regStart = Date.now();
    const regCode = await cxGateMain(
      [`--repo-root=${root}`, `--baseline=${baselinePath}`, '--format=json'],
      regIo.io,
    );
    const regMs = Date.now() - regStart;
    assert.equal(regCode, 1, 'high-cognitive fixture should fail');
    const regPayload = JSON.parse(regIo.stdout());
    const cogHit = regPayload.failures.find((f) => f.metric === 'max-cognitive');
    assert.ok(cogHit, `expected max-cognitive failure; got ${JSON.stringify(regPayload.failures)}`);
    assert.ok(cogHit.current > cogHit.floor);

    // Loop-close: removing the regression must re-pass with the same
    // baseline.
    writeFileSync(fixtureFile, cleanCognitiveSource());
    const restoredCode = await cxGateMain(
      [`--repo-root=${root}`, `--baseline=${baselinePath}`, '--format=json'],
      ioCapture().io,
    );
    assert.equal(restoredCode, 0);

    assert.ok(regMs < 5000, `cognitive gate should fail FAST; took ${regMs} ms`);

    record({
      lens: 'cognitive',
      failsOnRegression: true,
      passesOnClean: true,
      failureFingerprint: `max-cognitive ${cogHit.current}>${cogHit.floor}`,
      durationMs: { regression: regMs },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------
// Lens 3 - APSS topology / Martin coupling (gate.mjs main, stub IO).
// The aggregator's output is deterministic JSON; piping a synthesized
// "report with worsened folder instability" through the full gate
// pipeline (compareBaseline → renderReport → exitCode) drives the same
// code path that the real aggregate.mjs feeds in production.
// ---------------------------------------------------------------------

function reportWithFolder(folder, vals) {
  return {
    workspace: {
      folders: [{ name: folder, I: vals.I, D: vals.D, max_cognitive: null, max_cyclomatic: null }],
      modules: [],
      circular_edges: 0,
    },
  };
}

test('lens=apss-topology: gate.mjs FAILS on coupling regression, PASSES on clean', async () => {
  // Seed floor at I=0.20, D=0.20 in fixture folder. Current report at
  // I=0.70 must regress; current report at I=0.20 must pass.
  const seed = reportWithFolder('ws_apps/fixture/src', { I: 0.2, D: 0.2 });
  const baseline = extractApssFitnessBaseline(seed);
  const baselineJson = `${JSON.stringify(baseline, null, 2)}\n`;

  // (a) Regression case.
  const worse = reportWithFolder('ws_apps/fixture/src', { I: 0.7, D: 0.2 });
  const regIo = capturingIo({
    stdin: JSON.stringify(worse),
    files: { 'harness/sensors/baseline.json': baselineJson },
  });
  const regStart = Date.now();
  const regCode = await fitnessGateMain(
    [
      '--baseline=harness/sensors/baseline.json',
      '--skip-baseline-relaxation-guard',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
    ],
    regIo.io,
  );
  const regMs = Date.now() - regStart;
  assert.equal(regCode, 1, 'APSS coupling regression must fail the gate');
  assert.equal(regIo.writes.length, 0, 'regression must not move the floor');
  assert.match(regIo.stdout(), /VERDICT: FAIL sensors gate/);
  assert.match(regIo.stdout(), /ws_apps\/fixture\/src/);

  // Cross-check via direct comparator: the closed-loop pipeline reports
  // the same shape as the unit-level comparator, so the failure surface
  // is the gate's, not a renderer quirk.
  const cmp = compareBaseline(baseline, worse);
  assert.equal(cmp.ok, false);
  const folderReg = cmp.regressions.find(
    (r) => r.folder === 'ws_apps/fixture/src' && r.metric === 'I',
  );
  assert.ok(folderReg, 'expected folder I regression in direct comparator');

  // (b) Clean case.
  const clean = reportWithFolder('ws_apps/fixture/src', { I: 0.2, D: 0.2 });
  const cleanIo = capturingIo({
    stdin: JSON.stringify(clean),
    files: { 'harness/sensors/baseline.json': baselineJson },
  });
  const cleanCode = await fitnessGateMain(
    [
      '--baseline=harness/sensors/baseline.json',
      '--skip-baseline-relaxation-guard',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
    ],
    cleanIo.io,
  );
  assert.equal(cleanCode, 0, 'APSS coupling clean run must pass');
  assert.match(cleanIo.stdout(), /VERDICT: PASS sensors gate/);

  assert.ok(regMs < 2000, `gate should fail FAST on synthetic report; took ${regMs} ms`);

  record({
    lens: 'apss-topology',
    failsOnRegression: true,
    passesOnClean: true,
    failureFingerprint: `folder I ${folderReg.current}>${folderReg.baseline}`,
    durationMs: { regression: regMs },
  });
});

// ---------------------------------------------------------------------
// Lens 4 - sentrux (gate.mjs main, --sentrux=<path>, stub IO).
// Two metric directions exercised: cycle_count (direction:max — a
// brand-new circular dependency is a regression) AND quality_signal
// (direction:min — dropping composite quality is a regression). The
// per-metric ratchet unit tests in sentrux.test.mjs check each metric
// in isolation; here we drive the FULL gate.mjs main() so the
// envelope-file→fitness-options→compareBaseline→exit-code wiring is
// exercised end-to-end.
// ---------------------------------------------------------------------

function emptyReport() {
  return { workspace: { folders: [], modules: [], circular_edges: 0 } };
}

function sentruxEnvelope(metrics) {
  return { tool: 'sentrux', available: true, binary: 'sentrux', metrics };
}

test('lens=sentrux: gate.mjs FAILS on new cycle regression, PASSES on clean', async () => {
  // Seed at cycle_count=0 (no cycles); regression envelope reports 2
  // cycles. The gate must trip on sentrux-cycle-count via the ST01
  // dimension.
  const seedEnvelope = sentruxEnvelope({ cycle_count: 0 });
  const baseline = extractApssFitnessBaseline(emptyReport(), { sentrux: seedEnvelope });
  const baselineJson = `${JSON.stringify(baseline, null, 2)}\n`;

  // (a) Regression: sentrux finds a brand-new cycle.
  const worseEnvelope = sentruxEnvelope({ cycle_count: 2 });
  const regIo = capturingIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': baselineJson,
      '/tmp/sentrux-selfval.json': `${JSON.stringify(worseEnvelope, null, 2)}\n`,
    },
  });
  const regStart = Date.now();
  const regCode = await fitnessGateMain(
    [
      '--baseline=harness/sensors/baseline.json',
      '--skip-baseline-relaxation-guard',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
      '--sentrux=/tmp/sentrux-selfval.json',
    ],
    regIo.io,
  );
  const regMs = Date.now() - regStart;
  assert.equal(regCode, 1, 'sentrux cycle regression must fail the gate');
  assert.equal(regIo.writes.length, 0, 'sentrux regression must not move the floor');
  assert.match(regIo.stdout(), /VERDICT: FAIL sensors gate/);
  assert.match(regIo.stdout(), /sentrux-cycle-count/);

  // (b) Clean: same baseline, current envelope still at 0 cycles.
  const cleanEnvelope = sentruxEnvelope({ cycle_count: 0 });
  const cleanIo = capturingIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': baselineJson,
      '/tmp/sentrux-selfval.json': `${JSON.stringify(cleanEnvelope, null, 2)}\n`,
    },
  });
  const cleanCode = await fitnessGateMain(
    [
      '--baseline=harness/sensors/baseline.json',
      '--skip-baseline-relaxation-guard',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
      '--sentrux=/tmp/sentrux-selfval.json',
    ],
    cleanIo.io,
  );
  assert.equal(cleanCode, 0, 'sentrux clean envelope must pass');
  assert.match(cleanIo.stdout(), /VERDICT: PASS sensors gate/);

  // (c) Quality signal drop exercises the OTHER direction (min) - same
  // gate path, different metric class. Floor at 0.8; current at 0.4 is
  // a regression because larger is better for quality_signal.
  const qualSeed = sentruxEnvelope({ cycle_count: 0, quality_signal: 0.8 });
  const qualBaseline = extractApssFitnessBaseline(emptyReport(), { sentrux: qualSeed });
  const qualBaselineJson = `${JSON.stringify(qualBaseline, null, 2)}\n`;
  const qualBad = sentruxEnvelope({ cycle_count: 0, quality_signal: 0.4 });
  const qualIo = capturingIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': qualBaselineJson,
      '/tmp/sentrux-selfval.json': `${JSON.stringify(qualBad, null, 2)}\n`,
    },
  });
  const qualCode = await fitnessGateMain(
    [
      '--baseline=harness/sensors/baseline.json',
      '--skip-baseline-relaxation-guard',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
      '--sentrux=/tmp/sentrux-selfval.json',
    ],
    qualIo.io,
  );
  assert.equal(qualCode, 1, 'quality_signal drop must fail (direction:min)');
  assert.match(qualIo.stdout(), /sentrux-quality-signal/);

  assert.ok(regMs < 2000, `sentrux gate should fail FAST; took ${regMs} ms`);

  record({
    lens: 'sentrux',
    failsOnRegression: true,
    passesOnClean: true,
    failureFingerprint: 'sentrux-cycle-count 2>0 AND sentrux-quality-signal 0.4<0.8',
    durationMs: { regression: regMs },
  });
});

test('lens=baseline-relaxation-guard: fails on untagged regression and passes on tightening/justified edits', () => {
  const reference = relaxationReferenceBaseline();

  const regressed = cloneJson(reference);
  regressed.folders['ws_apps/fixture/src'].I = 0.9;
  regressed.dimensions.MT01.metrics['max-cyclomatic'].baseline = 12;
  regressed.dimensions.MT01.metrics['sentrux-quality-signal'].baseline = 0.5;
  const regressedResult = evaluateBaselineRelaxationGuard({
    workingBaseline: regressed,
    referenceBaseline: reference,
    generatedBaseline: cloneJson(regressed),
  });
  assert.equal(regressedResult.ok, false);
  assert.equal(
    hasViolation(regressedResult, folderRelaxationPath('ws_apps/fixture/src', 'I')),
    true,
  );

  const tightened = cloneJson(reference);
  tightened.folders['ws_apps/fixture/src'].I = 0.2;
  tightened.dimensions.MT01.metrics['max-cyclomatic'].baseline = 3;
  tightened.dimensions.MT01.metrics['sentrux-quality-signal'].baseline = 0.95;
  const tightenedResult = evaluateBaselineRelaxationGuard({
    workingBaseline: tightened,
    referenceBaseline: reference,
    generatedBaseline: cloneJson(tightened),
  });
  assert.equal(tightenedResult.ok, true);

  const deletedFolder = cloneJson(reference);
  delete deletedFolder.folders['ws_apps/fixture/src'];
  const deletedFolderResult = evaluateBaselineRelaxationGuard({
    workingBaseline: deletedFolder,
    referenceBaseline: reference,
    generatedBaseline: cloneJson(deletedFolder),
  });
  assert.equal(deletedFolderResult.ok, false);
  assert.equal(
    hasViolation(
      deletedFolderResult,
      folderRelaxationPath('ws_apps/fixture/src', 'I'),
      'floor-replaced-with-null',
    ),
    true,
  );
  assert.equal(
    hasViolation(
      deletedFolderResult,
      folderRelaxationPath('ws_apps/fixture/src', 'D'),
      'floor-replaced-with-null',
    ),
    true,
  );

  const directionFlip = cloneJson(reference);
  directionFlip.dimensions.MT01.metrics['max-cyclomatic'].direction = 'min';
  const directionFlipResult = evaluateBaselineRelaxationGuard({
    workingBaseline: directionFlip,
    referenceBaseline: reference,
    generatedBaseline: cloneJson(directionFlip),
  });
  assert.equal(directionFlipResult.ok, false);
  assert.equal(
    hasViolation(
      directionFlipResult,
      dimensionRelaxationPath('MT01', 'max-cyclomatic'),
      'direction-flip',
    ),
    true,
  );

  const missingDirection = cloneJson(reference);
  delete missingDirection.dimensions.MT01.metrics['max-cyclomatic'].direction;
  const missingDirectionResult = evaluateBaselineRelaxationGuard({
    workingBaseline: missingDirection,
    referenceBaseline: reference,
    generatedBaseline: cloneJson(missingDirection),
  });
  assert.equal(missingDirectionResult.ok, false);
  assert.equal(
    hasViolation(
      missingDirectionResult,
      dimensionRelaxationPath('MT01', 'max-cyclomatic'),
      'missing-direction',
    ),
    true,
  );

  const invalidDirection = cloneJson(reference);
  invalidDirection.dimensions.MT01.metrics['max-cyclomatic'].direction = 'auto';
  const invalidDirectionResult = evaluateBaselineRelaxationGuard({
    workingBaseline: invalidDirection,
    referenceBaseline: reference,
    generatedBaseline: cloneJson(invalidDirection),
  });
  assert.equal(invalidDirectionResult.ok, false);
  assert.equal(
    hasViolation(
      invalidDirectionResult,
      dimensionRelaxationPath('MT01', 'max-cyclomatic'),
      'invalid-direction',
    ),
    true,
  );

  const justifiedMissingDirection = cloneJson(reference);
  delete justifiedMissingDirection.dimensions.MT01.metrics['max-cyclomatic'].direction;
  justifiedMissingDirection[BASELINE_RELAXATION_APPROVAL_KEY] = {
    [dimensionRelaxationPath('MT01', 'max-cyclomatic')]:
      'BASELINE-RELAX-OK: intentional metric direction migration',
  };
  const justifiedMissingDirectionResult = evaluateBaselineRelaxationGuard({
    workingBaseline: justifiedMissingDirection,
    referenceBaseline: reference,
    generatedBaseline: cloneJson(justifiedMissingDirection),
  });
  assert.equal(justifiedMissingDirectionResult.ok, true);

  const justified = cloneJson(reference);
  justified.folders['ws_apps/fixture/src'].I = 0.9;
  justified.dimensions.MT01.metrics['max-cyclomatic'].baseline = 12;
  justified.dimensions.MT01.metrics['sentrux-quality-signal'].baseline = 0.5;
  justified[BASELINE_RELAXATION_APPROVAL_KEY] = {
    [folderRelaxationPath('ws_apps/fixture/src', 'I')]:
      'BASELINE-RELAX-OK: intentional architecture shift',
    [dimensionRelaxationPath('MT01', 'max-cyclomatic')]:
      'BASELINE-RELAX-OK: intentional architecture shift',
    [dimensionRelaxationPath('MT01', 'sentrux-quality-signal')]:
      'BASELINE-RELAX-OK: intentional architecture shift',
  };
  const justifiedResult = evaluateBaselineRelaxationGuard({
    workingBaseline: justified,
    referenceBaseline: reference,
    generatedBaseline: cloneJson(justified),
  });
  assert.equal(justifiedResult.ok, true);

  const justifiedDirectionFlip = cloneJson(reference);
  justifiedDirectionFlip.dimensions.MT01.metrics['max-cyclomatic'].direction = 'min';
  justifiedDirectionFlip[BASELINE_RELAXATION_APPROVAL_KEY] = {
    [dimensionRelaxationPath('MT01', 'max-cyclomatic')]:
      'BASELINE-RELAX-OK: intentional direction flip for gate',
  };
  const justifiedDirectionFlipResult = evaluateBaselineRelaxationGuard({
    workingBaseline: justifiedDirectionFlip,
    referenceBaseline: reference,
    generatedBaseline: cloneJson(justifiedDirectionFlip),
  });
  assert.equal(justifiedDirectionFlipResult.ok, true);
  record({
    lens: 'baseline-relaxation-guard',
    failsOnRegression: true,
    passesOnClean: true,
    failureFingerprint: 'folders/ws_apps/fixture/src/I 0.4->0.9',
    durationMs: { test: 0 },
  });
});

// ---------------------------------------------------------------------
// Matrix render + invariants. Runs last (node:test preserves source
// order within a file). Prints the closed-loop matrix to stdout for
// the gate-self-validation report and asserts every lens covered both
// directions.
// ---------------------------------------------------------------------

test('self-validation matrix: every lens closes the loop in both directions', () => {
  const expected = [
    'cyclomatic',
    'cognitive',
    'apss-topology',
    'sentrux',
    'baseline-relaxation-guard',
  ];
  for (const lens of expected) {
    const row = MATRIX.find((r) => r.lens === lens);
    assert.ok(row, `matrix missing row for lens=${lens}`);
    assert.equal(row.failsOnRegression, true, `${lens} did NOT fail on regression`);
    assert.equal(row.passesOnClean, true, `${lens} did NOT pass on clean`);
  }

  // Emit a human-readable matrix so the closed loop is visible in CI
  // logs even when no assertion fires. Prefixed with a stable marker so
  // it is greppable from the test runner output.
  const lines = ['', 'GATE-SELFVAL MATRIX', '-------------------'];
  lines.push('lens             | fails-on-regression | passes-on-clean | failure fingerprint');
  for (const row of MATRIX) {
    const lens = row.lens.padEnd(16);
    const fr = String(row.failsOnRegression).padEnd(19);
    const pc = String(row.passesOnClean).padEnd(15);
    lines.push(`${lens} | ${fr} | ${pc} | ${row.failureFingerprint}`);
  }
  lines.push('');
  // node:test buffers stdout per-test; using process.stdout writes
  // bypass the buffer so the matrix lands directly in the run output.
  process.stdout.write(`${lines.join('\n')}\n`);
});

// Local alias kept distinct from capturingIo only for naming clarity in
// the cx_gate tests, which only need write/writeErr.
function ioCapture() {
  const stdout = [];
  const stderr = [];
  return {
    io: {
      write: (s) => stdout.push(s),
      writeErr: (s) => stderr.push(s),
    },
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
  };
}
