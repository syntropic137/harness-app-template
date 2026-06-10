// Tests for the fast complexity-only ratchet gate (cx_gate.mjs).
//
// The gate composes three pieces - per-source readings from
// complexity.mjs, the MT01 floors snapshotted in baseline.json, and the
// compare-to-floor logic in cx_gate.mjs. The tests below pin the
// composition contract:
//
//   1. A workspace whose per-source readings sit at the floor passes.
//   2. A workspace whose readings push any of the three metrics above
//      the floor fails, and the failure list names the offending
//      metric.
//   3. Tightening the floor (smaller value for a direction:max metric)
//      flips a previously-passing reading into a failure, which is the
//      "improving raises the floor" promise of the ratchet from this
//      gate's side: once the full ratchet writes a tighter baseline,
//      the fast gate enforces it on the next commit without any code
//      changes.
//
// Run via:
//   node --test harness/sensors/tests/cx_gate.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareToFloor, extractFloors, rollupReadings } from '../cx_gate.mjs';

function baselineWith(floors) {
  return {
    dimensions: {
      MT01: {
        metrics: {
          'max-cognitive': { baseline: floors['max-cognitive'] },
          'max-cyclomatic': { baseline: floors['max-cyclomatic'] },
          'high-cognitive-fn-count': { baseline: floors['high-cognitive-fn-count'] },
        },
      },
    },
  };
}

test('extractFloors: pulls the three MT01 complexity floors and ignores other dims', () => {
  const baseline = baselineWith({
    'max-cognitive': 8,
    'max-cyclomatic': 6,
    'high-cognitive-fn-count': 1,
  });
  // Add a non-MT01 metric to be sure the extractor is scoped to MT01.
  baseline.dimensions.MD01 = { metrics: { 'max-fan-out': { baseline: 99 } } };
  const floors = extractFloors(baseline);
  assert.deepEqual(floors, {
    'max-cognitive': 8,
    'max-cyclomatic': 6,
    'high-cognitive-fn-count': 1,
  });
});

test('extractFloors: missing or non-numeric floor becomes null', () => {
  const baseline = {
    dimensions: { MT01: { metrics: { 'max-cognitive': { baseline: 'oops' } } } },
  };
  const floors = extractFloors(baseline);
  assert.equal(floors['max-cognitive'], null);
  assert.equal(floors['max-cyclomatic'], null);
  assert.equal(floors['high-cognitive-fn-count'], null);
});

test('rollupReadings: max of per-source max and sum of high-cognitive count', () => {
  const readings = [
    { source: 'a.ts', max_cognitive: 3, max_cyclomatic: 2, high_cognitive_count: 0 },
    { source: 'b.ts', max_cognitive: 8, max_cyclomatic: 6, high_cognitive_count: 1 },
    { source: 'c.ts', max_cognitive: 5, max_cyclomatic: 4, high_cognitive_count: 2 },
  ];
  const rollup = rollupReadings(readings);
  assert.equal(rollup['max-cognitive'], 8);
  assert.equal(rollup['max-cyclomatic'], 6);
  assert.equal(rollup['high-cognitive-fn-count'], 3);
});

test('rollupReadings: empty workspace yields nulls for peaks, zero for spread', () => {
  const rollup = rollupReadings([]);
  assert.equal(rollup['max-cognitive'], null);
  assert.equal(rollup['max-cyclomatic'], null);
  assert.equal(rollup['high-cognitive-fn-count'], 0);
});

test('compareToFloor: at the floor passes; above the floor fails', () => {
  const floors = {
    'max-cognitive': 8,
    'max-cyclomatic': 6,
    'high-cognitive-fn-count': 1,
  };
  const atFloor = compareToFloor(
    { 'max-cognitive': 8, 'max-cyclomatic': 6, 'high-cognitive-fn-count': 1 },
    floors,
  );
  assert.equal(atFloor.ok, true);
  assert.deepEqual(atFloor.failures, []);

  const regressed = compareToFloor(
    { 'max-cognitive': 9, 'max-cyclomatic': 6, 'high-cognitive-fn-count': 1 },
    floors,
  );
  assert.equal(regressed.ok, false);
  assert.equal(regressed.failures.length, 1);
  assert.equal(regressed.failures[0].metric, 'max-cognitive');
  assert.equal(regressed.failures[0].current, 9);
  assert.equal(regressed.failures[0].floor, 8);
});

test('compareToFloor: tightening the floor flips a previously-passing reading into a failure', () => {
  // This is the gate-side half of the ratchet promise:
  //   - the full sensors-gate is the only place that WRITES a tighter
  //     baseline (on an improving run, the ratchet auto-tightens
  //     direction:max floors downward toward the new minimum);
  //   - the fast cx-gate must ENFORCE whatever floor lands in
  //     baseline.json, so the next commit after a tightening cannot
  //     silently regress back to the old value.
  // The fast gate is stateless - it just reads the baseline. So the
  // proof here is: same readings, two baselines, one passes, the
  // tightened one fails on exactly the metric that tightened.
  const readings = {
    'max-cognitive': 6,
    'max-cyclomatic': 4,
    'high-cognitive-fn-count': 0,
  };
  const wideFloor = {
    'max-cognitive': 8,
    'max-cyclomatic': 6,
    'high-cognitive-fn-count': 1,
  };
  const tightenedFloor = {
    ...wideFloor,
    'max-cognitive': 5, // ratchet tightened from 8 to 5
  };
  assert.equal(compareToFloor(readings, wideFloor).ok, true);
  const tightened = compareToFloor(readings, tightenedFloor);
  assert.equal(tightened.ok, false);
  assert.equal(tightened.failures[0].metric, 'max-cognitive');
  assert.equal(tightened.failures[0].current, 6);
  assert.equal(tightened.failures[0].floor, 5);
});

test('compareToFloor: a null floor is advisory (does not regress)', () => {
  const floors = {
    'max-cognitive': null,
    'max-cyclomatic': 6,
    'high-cognitive-fn-count': 1,
  };
  const result = compareToFloor(
    { 'max-cognitive': 99, 'max-cyclomatic': 6, 'high-cognitive-fn-count': 1 },
    floors,
  );
  assert.equal(result.ok, true);
});
