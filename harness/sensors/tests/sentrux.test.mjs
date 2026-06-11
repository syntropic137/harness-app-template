// Tests for the sentrux adapter wired through harness/sensors/gate.mjs as
// the SECOND architectural lens reconciled into the same upward ratchet
// as APSS topology (ADR-0017 — sentrux preserved, not retired). Mirrors
// ratchet.test.mjs in shape: same stubIo + same end-to-end main() drive.
//
// The contract under test:
//   - Sentrux metrics flow in through the --sentrux=<path> CLI flag and
//     are exposed to the ratchet via FITNESS_METRICS for MT01/MD01/ST01.
//   - The ratchet tightens on improvement (smaller-is-better for the
//     count metrics; larger-is-better for the composite quality signal).
//   - Regressions on sentrux metrics fail the gate without moving the
//     floor — same no-broken-windows rule as the APSS dimensions.
//   - When the adapter envelope reports `available: false`, every
//     sentrux metric degrades to "no reading" rather than a false zero,
//     so a missing binary does not silently pass.
//
// Run via: node --test harness/sensors/tests/sentrux.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareBaseline, extractApssFitnessBaseline, main, ratchetBaseline } from '../gate.mjs';

function emptyReport() {
  return {
    workspace: { folders: [], modules: [], circular_edges: 0 },
  };
}

function envelope(metrics) {
  return {
    tool: 'sentrux',
    available: true,
    binary: 'sentrux',
    metrics,
  };
}

function baselineWithSentrux(metrics) {
  return extractApssFitnessBaseline(emptyReport(), { sentrux: envelope(metrics) });
}

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
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
  };
}

test('sentrux: god_file_count tightens (direction=max) on improvement', () => {
  const baseline = baselineWithSentrux({ god_file_count: 4 });
  const { tightenings, changed, next } = ratchetBaseline(baseline, emptyReport(), {
    sentrux: envelope({ god_file_count: 1 }),
  });
  assert.equal(changed, true);
  assert.equal(next.dimensions.MT01.metrics['sentrux-god-file-count'].baseline, 1);
  const t = tightenings.find((x) => x.metric === 'sentrux-god-file-count');
  assert.ok(t, 'expected tightening entry for sentrux-god-file-count');
  assert.equal(t.previous, 4);
  assert.equal(t.next, 1);
});

test('sentrux: quality_signal tightens (direction=min — larger is better)', () => {
  const baseline = baselineWithSentrux({ quality_signal: 0.5 });
  const { tightenings, changed, next } = ratchetBaseline(baseline, emptyReport(), {
    sentrux: envelope({ quality_signal: 0.82 }),
  });
  assert.equal(changed, true);
  assert.equal(next.dimensions.MT01.metrics['sentrux-quality-signal'].baseline, 0.82);
  const t = tightenings.find((x) => x.metric === 'sentrux-quality-signal');
  assert.ok(t, 'expected tightening entry for sentrux-quality-signal');
  assert.equal(t.direction, 'min');
});

test('sentrux: coupling_score regression fails the gate without moving the floor', () => {
  const baseline = baselineWithSentrux({ coupling_score: 0.2 });
  const cmp = compareBaseline(baseline, emptyReport(), {
    sentrux: envelope({ coupling_score: 0.45 }),
  });
  assert.equal(cmp.ok, false);
  assert.ok(
    cmp.regressions.some((r) => r.dimension === 'MD01' && r.metric === 'sentrux-coupling-score'),
    'expected MD01 sentrux-coupling-score regression to be flagged',
  );
});

test('sentrux: cycle_count is a regression when sentrux finds a new cycle', () => {
  const baseline = baselineWithSentrux({ cycle_count: 0 });
  const cmp = compareBaseline(baseline, emptyReport(), {
    sentrux: envelope({ cycle_count: 2 }),
  });
  assert.equal(cmp.ok, false);
  assert.ok(
    cmp.regressions.some((r) => r.dimension === 'ST01' && r.metric === 'sentrux-cycle-count'),
    'expected ST01 sentrux-cycle-count regression to be flagged',
  );
});

test('sentrux: quality_signal dropping is a regression (direction=min)', () => {
  const baseline = baselineWithSentrux({ quality_signal: 0.8 });
  const cmp = compareBaseline(baseline, emptyReport(), {
    sentrux: envelope({ quality_signal: 0.4 }),
  });
  assert.equal(cmp.ok, false);
  assert.ok(
    cmp.regressions.some((r) => r.dimension === 'MT01' && r.metric === 'sentrux-quality-signal'),
    'expected MT01 sentrux-quality-signal regression to be flagged',
  );
});

test('sentrux: absent envelope (available=false) degrades to no-reading, not a false zero', () => {
  const baseline = baselineWithSentrux({ god_file_count: 3 });
  const cmp = compareBaseline(baseline, emptyReport(), {
    sentrux: { tool: 'sentrux', available: false, reason: 'not on PATH' },
  });
  // No regression — when sentrux is unavailable every metric reads as null
  // so worsened() returns false (the gate cannot regress against an
  // un-measurable current state). Same shape as the SC01/LG01 no-reading
  // contract for missing scanners.
  assert.equal(cmp.ok, true);
});

test('sentrux: main() with --sentrux flag — tightens baseline.json on improvement', async () => {
  // Seed baseline carries a floor of god_file_count=3; current sentrux
  // envelope reports 0. Expect the gate to rewrite the floor at 0 and
  // exit 0.
  const seedEnvelope = envelope({ god_file_count: 3 });
  const baselineJson = `${JSON.stringify(
    extractApssFitnessBaseline(emptyReport(), { sentrux: seedEnvelope }),
    null,
    2,
  )}\n`;
  const currentEnvelope = envelope({ god_file_count: 0 });
  const sentruxJson = `${JSON.stringify(currentEnvelope, null, 2)}\n`;

  const { io, writes, stdout } = stubIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': baselineJson,
      '/tmp/sentrux.json': sentruxJson,
    },
  });

  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--skip-baseline-relaxation-guard',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
      '--sentrux=/tmp/sentrux.json',
    ],
    io,
  );

  assert.equal(code, 0, 'sentrux improvement should exit 0');
  assert.equal(writes.length, 1, 'expected one baseline write for the tightened floor');
  const written = JSON.parse(writes[0].content);
  assert.equal(written.dimensions.MT01.metrics['sentrux-god-file-count'].baseline, 0);
  assert.match(stdout(), /VERDICT: PASS sensors gate/);
  assert.match(stdout(), /RATCHET: floor tightened/);
});

test('sentrux: main() with --sentrux flag — regression fails and leaves floor untouched', async () => {
  const seedEnvelope = envelope({ god_file_count: 0 });
  const baselineJson = `${JSON.stringify(
    extractApssFitnessBaseline(emptyReport(), { sentrux: seedEnvelope }),
    null,
    2,
  )}\n`;
  const worseEnvelope = envelope({ god_file_count: 2 });
  const sentruxJson = `${JSON.stringify(worseEnvelope, null, 2)}\n`;

  const { io, writes, stdout } = stubIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': baselineJson,
      '/tmp/sentrux.json': sentruxJson,
    },
  });

  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--skip-baseline-relaxation-guard',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
      '--sentrux=/tmp/sentrux.json',
    ],
    io,
  );

  assert.equal(code, 1, 'sentrux regression should exit non-zero');
  assert.equal(writes.length, 0, 'regression must not rewrite baseline');
  assert.match(stdout(), /VERDICT: FAIL sensors gate/);
  assert.match(stdout(), /sentrux-god-file-count/);
});
