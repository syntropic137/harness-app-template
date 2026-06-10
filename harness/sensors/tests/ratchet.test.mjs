// Tests for the upward-ratchet behaviour of harness/sensors/gate.mjs.
//
// The ratchet is the architectural-fitness floor: quality may improve
// freely (floor tightens automatically), but a regression below the floor
// fails the gate. These tests exercise BOTH directions and the escape
// hatches recorded in ADR-0020.
//
// Run via: node --test harness/sensors/tests/ratchet.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareBaseline,
  extractApssFitnessBaseline,
  main,
  ratchetBaseline,
} from '../gate.mjs';

function reportWith(folders = {}) {
  return {
    workspace: {
      folders: Object.entries(folders).map(([name, vals]) => ({
        name,
        I: vals.I ?? null,
        D: vals.D ?? null,
        max_cognitive: vals.max_cognitive ?? null,
        max_cyclomatic: vals.max_cyclomatic ?? null,
      })),
      modules: [],
      circular_edges: 0,
    },
  };
}

function baselineFrom(report) {
  return extractApssFitnessBaseline(report);
}

/**
 * Build a stub IO object that captures every writeFile call. Used to drive
 * `main` end-to-end without touching the real filesystem.
 */
function stubIo({ stdin = '{}', files = {} } = {}) {
  const writes = [];
  const stdout = [];
  const stderr = [];
  const written = { ...files };
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

test('ratchetBaseline: improving folder I tightens the floor', () => {
  const seed = reportWith({
    'ws_apps/x/src': { I: 0.5, D: 0.5 },
  });
  const baseline = baselineFrom(seed);

  const better = reportWith({
    'ws_apps/x/src': { I: 0.2, D: 0.5 },
  });
  const { next, tightenings, changed } = ratchetBaseline(baseline, better);

  assert.equal(changed, true);
  assert.equal(next.folders['ws_apps/x/src'].I, 0.2);
  assert.equal(next.folders['ws_apps/x/src'].D, 0.5);
  const folderTightening = tightenings.find((t) => t.kind === 'folder' && t.metric === 'I');
  assert.ok(folderTightening, 'expected folder I tightening to be recorded');
  assert.equal(folderTightening.previous, 0.5);
  assert.equal(folderTightening.next, 0.2);
});

test('ratchetBaseline: no change when metrics are equal', () => {
  const seed = reportWith({
    'ws_apps/x/src': { I: 0.4, D: 0.3 },
  });
  const baseline = baselineFrom(seed);

  const same = reportWith({
    'ws_apps/x/src': { I: 0.4, D: 0.3 },
  });
  const { tightenings, changed } = ratchetBaseline(baseline, same);
  assert.equal(changed, false);
  assert.deepEqual(tightenings, []);
});

test('ratchetBaseline: regression does NOT widen the floor', () => {
  // The ratchet itself never widens. Even if it is invoked on a regressing
  // report, the existing floor stays put.
  const seed = reportWith({
    'ws_apps/x/src': { I: 0.2, D: 0.2 },
  });
  const baseline = baselineFrom(seed);

  const worse = reportWith({
    'ws_apps/x/src': { I: 0.5, D: 0.5 },
  });
  const { next, changed } = ratchetBaseline(baseline, worse);
  assert.equal(changed, false);
  assert.equal(next.folders['ws_apps/x/src'].I, 0.2);
  assert.equal(next.folders['ws_apps/x/src'].D, 0.2);
});

test('ratchetBaseline: null baseline meeting a real measurement is treated as improvement', () => {
  const baseline = {
    schema_version: '1.0.0',
    folders: { 'ws_apps/x/src': { I: null, D: null } },
    dimensions: {},
  };
  const seed = reportWith({
    'ws_apps/x/src': { I: 0.4, D: 0.3 },
  });
  const { next, tightenings, changed } = ratchetBaseline(baseline, seed);
  assert.equal(changed, true);
  assert.equal(next.folders['ws_apps/x/src'].I, 0.4);
  assert.equal(next.folders['ws_apps/x/src'].D, 0.3);
  assert.ok(tightenings.some((t) => t.reason === 'null-to-real'));
});

test('ratchetBaseline: improving APSS dimension metric tightens floor (direction=max)', () => {
  const baseline = {
    schema_version: '1.0.0',
    folders: {},
    dimensions: {
      MT01: {
        metrics: {
          'max-cognitive': {
            name: 'Maximum Cognitive Complexity',
            direction: 'max',
            baseline: 12,
            fail_on_regression: true,
          },
        },
      },
    },
  };
  // Build a report whose APSS function values surface max_cognitive = 5.
  const better = {
    workspace: {
      folders: [],
      modules: [
        {
          source: 'ws_apps/x/src/a.ts',
          apss: {
            functions: [{ cognitive: 5, cyclomatic: 2 }],
          },
        },
      ],
      circular_edges: 0,
    },
  };
  const { next, tightenings, changed } = ratchetBaseline(baseline, better);
  assert.equal(changed, true);
  assert.equal(next.dimensions.MT01.metrics['max-cognitive'].baseline, 5);
  const dimT = tightenings.find((t) => t.kind === 'dimension' && t.metric === 'max-cognitive');
  assert.ok(dimT, 'expected dimension tightening for max-cognitive');
  assert.equal(dimT.previous, 12);
  assert.equal(dimT.next, 5);
});

test('compareBaseline: regression below floor is reported and ratchet is not triggered', () => {
  const seed = reportWith({
    'ws_apps/x/src': { I: 0.3, D: 0.3 },
  });
  const baseline = baselineFrom(seed);
  const worse = reportWith({
    'ws_apps/x/src': { I: 0.7, D: 0.3 },
  });
  const cmp = compareBaseline(baseline, worse);
  assert.equal(cmp.ok, false);
  assert.ok(cmp.regressions.some((r) => r.folder === 'ws_apps/x/src' && r.metric === 'I'));
});

test('main: improving run auto-tightens baseline.json (writes the tighter floor)', async () => {
  // Seed: floor at I=0.4. Current report: I=0.1. Expect the gate to write
  // a baseline with I=0.1 and exit 0.
  const seed = reportWith({
    'ws_apps/x/src': { I: 0.4, D: 0.4 },
  });
  const baselineJson = `${JSON.stringify(baselineFrom(seed), null, 2)}\n`;

  const better = reportWith({
    'ws_apps/x/src': { I: 0.1, D: 0.1 },
  });

  const { io, writes, stdout } = stubIo({
    stdin: JSON.stringify(better),
    files: { 'harness/sensors/baseline.json': baselineJson },
  });

  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
    ],
    io,
  );

  assert.equal(code, 0, 'improving run should exit 0');
  // Should have written exactly one tightened baseline.
  assert.equal(writes.length, 1, 'expected exactly one baseline write');
  assert.equal(writes[0].path, 'harness/sensors/baseline.json');
  const written = JSON.parse(writes[0].content);
  assert.equal(written.folders['ws_apps/x/src'].I, 0.1);
  assert.equal(written.folders['ws_apps/x/src'].D, 0.1);
  assert.match(stdout(), /VERDICT: PASS sensors gate/);
  assert.match(stdout(), /RATCHET: floor tightened/);
});

test('main: regression below floor fails AND does not move the baseline', async () => {
  const seed = reportWith({
    'ws_apps/x/src': { I: 0.1, D: 0.1 },
  });
  const baselineJson = `${JSON.stringify(baselineFrom(seed), null, 2)}\n`;

  const worse = reportWith({
    'ws_apps/x/src': { I: 0.6, D: 0.6 },
  });
  const { io, writes, stdout } = stubIo({
    stdin: JSON.stringify(worse),
    files: { 'harness/sensors/baseline.json': baselineJson },
  });

  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
    ],
    io,
  );

  assert.equal(code, 1, 'regression should exit non-zero');
  assert.equal(writes.length, 0, 'regression must NOT rewrite the baseline');
  assert.match(stdout(), /VERDICT: FAIL sensors gate/);
  // Regression line should name the folder + metric + direction.
  assert.match(stdout(), /ws_apps\/x\/src\s+I:/);
  // The remediation hint should mention the escape hatch but emphasise the
  // no-broken-windows rule.
  assert.match(stdout(), /no broken windows/);
  assert.match(stdout(), /--update-baseline/);
});

test('main: --no-ratchet preserves comparison behaviour but skips the rewrite', async () => {
  const seed = reportWith({
    'ws_apps/x/src': { I: 0.4, D: 0.4 },
  });
  const baselineJson = `${JSON.stringify(baselineFrom(seed), null, 2)}\n`;

  const better = reportWith({
    'ws_apps/x/src': { I: 0.1, D: 0.1 },
  });
  const { io, writes, stdout } = stubIo({
    stdin: JSON.stringify(better),
    files: { 'harness/sensors/baseline.json': baselineJson },
  });

  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--policy=none',
      '--no-ratchet',
      '--perf-baseline=harness/perf/baseline.json',
    ],
    io,
  );

  assert.equal(code, 0);
  assert.equal(writes.length, 0, '--no-ratchet must not write the baseline');
  assert.match(stdout(), /VERDICT: PASS sensors gate/);
  // RATCHET banner is suppressed when the flag is off.
  assert.doesNotMatch(stdout(), /RATCHET: floor tightened/);
});

test('main: --update-baseline is the escape hatch — relaxes the floor on a regressing run', async () => {
  const seed = reportWith({
    'ws_apps/x/src': { I: 0.1, D: 0.1 },
  });
  const baselineJson = `${JSON.stringify(baselineFrom(seed), null, 2)}\n`;

  const worse = reportWith({
    'ws_apps/x/src': { I: 0.6, D: 0.6 },
  });
  const { io, writes } = stubIo({
    stdin: JSON.stringify(worse),
    files: { 'harness/sensors/baseline.json': baselineJson },
  });

  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--policy=none',
      '--update-baseline',
      '--perf-baseline=harness/perf/baseline.json',
    ],
    io,
  );

  assert.equal(code, 0, '--update-baseline must succeed even on regression');
  assert.equal(writes.length, 1, 'baseline must be rewritten with the new (looser) floor');
  const written = JSON.parse(writes[0].content);
  assert.equal(written.folders['ws_apps/x/src'].I, 0.6);
});

test('main: no improvement, no regression → ratchet does not churn the baseline file', async () => {
  const seed = reportWith({
    'ws_apps/x/src': { I: 0.3, D: 0.3 },
  });
  const baselineJson = `${JSON.stringify(baselineFrom(seed), null, 2)}\n`;

  const same = reportWith({
    'ws_apps/x/src': { I: 0.3, D: 0.3 },
  });
  const { io, writes } = stubIo({
    stdin: JSON.stringify(same),
    files: { 'harness/sensors/baseline.json': baselineJson },
  });

  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
    ],
    io,
  );

  assert.equal(code, 0);
  assert.equal(writes.length, 0, 'no improvement must produce no git churn');
});
