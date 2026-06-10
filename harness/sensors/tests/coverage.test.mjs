// Tests for the deterministic test-coverage adapter (CV01) wired
// through harness/sensors/gate.mjs as the 4th composition lens after
// dep-cruiser/ts-morph, sentrux, and deadcode. Mirrors deadcode.test.mjs
// in shape: same stubIo + same end-to-end main() drive, because the
// gate-side contract is identical (envelope-on-disk, soft-skip on
// available=false, direction=min ratchet under CV01).
//
// The contract under test (ADR-0025-coverage-ratchet.md):
//   - Parsers are pure: same input -> same output, no filesystem, no
//     network. Determinism is the whole point of the slot.
//   - Metrics flow in through the --coverage=<path> CLI flag; the
//     gate's CV01 dimension reads rust_line_pct, rust_function_pct,
//     rust_region_pct, python_line_pct, javascript_line_pct, and the
//     project-wide min_line_pct.
//   - direction=min so the ratchet only ever tightens UPWARD (larger
//     is better; floor at 100 is the operator invariant).
//   - Regressions fail the gate WITHOUT moving the floor.
//   - When the adapter envelope is requested but unavailable / malformed,
//     CV01 hard-fails instead of degrading to a false zero.
//
// Run via: node --test harness/sensors/tests/coverage.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildEnvelopeFromOptions,
  composeMetrics,
  main as coverageMain,
  parseJavascriptCoverageSummary,
  parsePythonCoverageJson,
  parseRustLlvmCovJson,
} from '../coverage_scan.mjs';
import { compareBaseline, extractApssFitnessBaseline, main, ratchetBaseline } from '../gate.mjs';

function emptyReport() {
  return {
    workspace: { folders: [], modules: [], circular_edges: 0 },
  };
}

function envelope(metrics) {
  return {
    tool: 'coverage-scan',
    available: true,
    version: '1.0.0',
    scanned_lanes: ['rust', 'python', 'javascript'],
    metrics: {
      rust_line_pct: 100,
      rust_function_pct: 100,
      rust_region_pct: 100,
      python_line_pct: 100,
      javascript_line_pct: 100,
      min_line_pct: 100,
      ...metrics,
    },
  };
}

function baselineWithCoverage(metrics) {
  return extractApssFitnessBaseline(emptyReport(), { coverage: envelope(metrics) });
}

function stubIo({ stdin = '{}', files = {} } = {}) {
  const stdout = [];
  const stderr = [];
  const writes = [];
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

// ---------------------------------------------------------------------------
// Parser unit tests
// ---------------------------------------------------------------------------

test('parseRustLlvmCovJson reads line / function / region totals from cargo-llvm-cov shape', () => {
  const payload = {
    data: [
      {
        totals: {
          lines: { count: 200, covered: 200, percent: 100 },
          functions: { count: 50, covered: 50, percent: 100 },
          regions: { count: 300, covered: 300, percent: 100 },
        },
      },
    ],
  };
  const m = parseRustLlvmCovJson(payload);
  assert.deepEqual(m, { line_pct: 100, function_pct: 100, region_pct: 100 });
});

test('parseRustLlvmCovJson computes percent from count/covered when percent field missing', () => {
  const payload = {
    data: [
      {
        totals: {
          lines: { count: 200, covered: 199 },
          functions: { count: 50, covered: 49 },
          regions: { count: 300, covered: 297 },
        },
      },
    ],
  };
  const m = parseRustLlvmCovJson(payload);
  assert.equal(m.line_pct, 99.5);
  assert.equal(m.function_pct, 98);
  assert.equal(m.region_pct, 99);
});

test('parseRustLlvmCovJson treats zero-count crate as 100 percent', () => {
  const payload = {
    data: [
      {
        totals: {
          lines: { count: 0, covered: 0 },
          functions: { count: 0, covered: 0 },
          regions: { count: 0, covered: 0 },
        },
      },
    ],
  };
  const m = parseRustLlvmCovJson(payload);
  assert.deepEqual(m, { line_pct: 100, function_pct: 100, region_pct: 100 });
});

test('parseRustLlvmCovJson returns null on malformed payload', () => {
  assert.equal(parseRustLlvmCovJson(null), null);
  assert.equal(parseRustLlvmCovJson({}), null);
  assert.equal(parseRustLlvmCovJson({ data: [] }), null);
});

test('parsePythonCoverageJson reads totals.percent_covered (coverage.py >=6)', () => {
  const payload = { totals: { percent_covered: 100 } };
  assert.deepEqual(parsePythonCoverageJson(payload), { line_pct: 100 });
});

test('parsePythonCoverageJson falls back to covered_lines / num_statements when percent absent', () => {
  const payload = { totals: { covered_lines: 99, num_statements: 100 } };
  assert.deepEqual(parsePythonCoverageJson(payload), { line_pct: 99 });
});

test('parsePythonCoverageJson returns null on malformed payload', () => {
  assert.equal(parsePythonCoverageJson(null), null);
  assert.equal(parsePythonCoverageJson({}), null);
  assert.equal(parsePythonCoverageJson({ totals: {} }), null);
});

test('parseJavascriptCoverageSummary reads istanbul-style total.lines.pct', () => {
  const payload = { total: { lines: { total: 100, covered: 100, pct: 100 } } };
  assert.deepEqual(parseJavascriptCoverageSummary(payload), { line_pct: 100 });
});

test('parseJavascriptCoverageSummary derives pct from covered/total when pct missing', () => {
  const payload = { total: { lines: { total: 200, covered: 198 } } };
  assert.deepEqual(parseJavascriptCoverageSummary(payload), { line_pct: 99 });
});

test('composeMetrics picks the MIN line pct across present lanes', () => {
  const m = composeMetrics({
    rust: { line_pct: 100, function_pct: 100, region_pct: 100 },
    python: { line_pct: 95 },
    javascript: { line_pct: 99 },
  });
  assert.equal(m.rust_line_pct, 100);
  assert.equal(m.python_line_pct, 95);
  assert.equal(m.javascript_line_pct, 99);
  assert.equal(m.min_line_pct, 95);
});

test('composeMetrics treats absent lanes as null and skips them in min_line_pct', () => {
  const m = composeMetrics({ rust: { line_pct: 100, function_pct: 100, region_pct: 100 } });
  assert.equal(m.python_line_pct, null);
  assert.equal(m.javascript_line_pct, null);
  assert.equal(m.min_line_pct, 100);
});

test('composeMetrics with no lanes returns all nulls', () => {
  const m = composeMetrics({});
  assert.equal(m.rust_line_pct, null);
  assert.equal(m.python_line_pct, null);
  assert.equal(m.javascript_line_pct, null);
  assert.equal(m.min_line_pct, null);
});

test('buildEnvelopeFromOptions with no input returns available=false (no false zero)', () => {
  const env = buildEnvelopeFromOptions({
    workspaceRoot: '/tmp/nowhere',
    rustCovJsonPath: null,
    pythonCovJsonPath: null,
    javascriptCovJsonPath: null,
    runRust: false,
  });
  assert.equal(env.available, false);
  assert.deepEqual(env.scanned_lanes, []);
  // metrics block exists but every value is null
  assert.equal(env.metrics.rust_line_pct, null);
  assert.equal(env.metrics.min_line_pct, null);
});

test('buildEnvelopeFromOptions treats missing lane JSON as hard-fail when that lane is requested', () => {
  const env = buildEnvelopeFromOptions({
    workspaceRoot: '/tmp/nowhere',
    rustCovJsonPath: '/tmp/does-not-exist-rust-coverage.json',
    pythonCovJsonPath: '/tmp/does-not-exist-python-coverage.json',
    javascriptCovJsonPath: '/tmp/does-not-exist-js-coverage.json',
    runRust: false,
  });
  assert.equal(env.available, false);
  assert.equal(env.hard_fail, true);
  assert.equal(env.scanned_lanes.length, 0);
  assert.equal(env.metrics.min_line_pct, null);
  assert.match(env.reason, /missing rust coverage JSON/);
});

test('buildEnvelopeFromOptions with --run-rust but no discovered Rust lanes hard-fails', () => {
  const env = buildEnvelopeFromOptions({
    workspaceRoot: '/tmp/nowhere',
    rustCovJsonPath: null,
    pythonCovJsonPath: null,
    javascriptCovJsonPath: null,
    runRust: true,
  });
  assert.equal(env.available, false);
  assert.equal(env.hard_fail, true);
  assert.equal(env.scanned_lanes.length, 0);
  assert.equal(env.metrics.min_line_pct, null);
  assert.match(env.reason, /no Rust lanes discovered for --run-rust/);
});

test('coverage_scan.main returns non-zero on missing lane JSON', async () => {
  const stdout = [];
  const io = { write: (s) => stdout.push(s) };
  const code = await coverageMain(['--rust-cov-json=/tmp/does-not-exist-rust-coverage.json'], io);
  assert.equal(code, 1);
  const envelope = JSON.parse(stdout.join(''));
  assert.equal(envelope.available, false);
  assert.equal(envelope.hard_fail, true);
  assert.match(envelope.reason, /missing rust coverage JSON/);
});

// ---------------------------------------------------------------------------
// Gate integration: ratchet + regression + soft-skip
// ---------------------------------------------------------------------------

test('coverage: rust_line_pct tightens (direction=min) on improvement from a sub-100 floor', () => {
  // Hypothetical opt-in fork starts at 90 percent and improves to 95.
  const baseline = baselineWithCoverage({ rust_line_pct: 90 });
  const { tightenings, changed, next } = ratchetBaseline(baseline, emptyReport(), {
    coverage: envelope({ rust_line_pct: 95 }),
  });
  assert.equal(changed, true);
  assert.equal(next.dimensions.CV01.metrics['rust-line-coverage-pct'].baseline, 95);
  const t = tightenings.find((x) => x.metric === 'rust-line-coverage-pct');
  assert.ok(t, 'expected tightening entry for rust-line-coverage-pct');
  assert.equal(t.previous, 90);
  assert.equal(t.next, 95);
});

test('coverage: regression below the floor is flagged without moving the floor', () => {
  const baseline = baselineWithCoverage({ rust_line_pct: 100, min_line_pct: 100 });
  const cmp = compareBaseline(baseline, emptyReport(), {
    coverage: envelope({ rust_line_pct: 99, min_line_pct: 99 }),
  });
  assert.equal(cmp.ok, false);
  assert.ok(
    cmp.regressions.some((r) => r.dimension === 'CV01' && r.metric === 'rust-line-coverage-pct'),
    'expected CV01 rust-line-coverage-pct regression to be flagged',
  );
  assert.ok(
    cmp.regressions.some((r) => r.dimension === 'CV01' && r.metric === 'min-line-coverage-pct'),
    'expected CV01 min-line-coverage-pct regression to be flagged',
  );
});

test('coverage: 100 percent baseline at 100 percent current is PASS (no regression, no tightening)', () => {
  const baseline = baselineWithCoverage({});
  const cmp = compareBaseline(baseline, emptyReport(), { coverage: envelope({}) });
  assert.equal(cmp.ok, true);
  const { changed } = ratchetBaseline(baseline, emptyReport(), { coverage: envelope({}) });
  assert.equal(changed, false, 'a floor already at 100 cannot tighten further');
});

test('coverage: explicit --coverage envelope unavailable / malformed hard-fails', () => {
  const baseline = baselineWithCoverage({});
  const cmp = compareBaseline(baseline, emptyReport(), {
    coverage: { tool: 'coverage-scan', available: false, reason: 'no input' },
  });
  assert.equal(cmp.ok, false);
  assert.ok(
    cmp.regressions.some((r) => r.dimension === 'CV01' && r.metric === 'rust-line-coverage-pct'),
  );
  assert.ok(
    cmp.regressions.some((r) => r.dimension === 'CV01' && r.metric === 'min-line-coverage-pct'),
  );
  assert.match(
    cmp.regressions[0].diagnostic ?? '',
    /coverage adapter reported unavailable: no input/,
  );
});

test('coverage: main() with --coverage flag tightens baseline.json on improvement', async () => {
  // Seed baseline at 95 percent (a fork that opted to ratchet up from
  // below 100), then improve to 100. The ratchet must rewrite the
  // floor with the better number.
  const seedEnvelope = envelope({
    rust_line_pct: 95,
    rust_function_pct: 95,
    rust_region_pct: 95,
    python_line_pct: 95,
    javascript_line_pct: 95,
    min_line_pct: 95,
  });
  const baselineJson = `${JSON.stringify(
    extractApssFitnessBaseline(emptyReport(), { coverage: seedEnvelope }),
    null,
    2,
  )}\n`;
  const currentEnvelope = envelope({});
  const coverageJson = `${JSON.stringify(currentEnvelope, null, 2)}\n`;

  const { io, writes, stdout } = stubIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': baselineJson,
      '/tmp/coverage.json': coverageJson,
    },
  });

  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
      '--coverage=/tmp/coverage.json',
    ],
    io,
  );

  assert.equal(code, 0, 'coverage improvement should exit 0');
  assert.ok(writes.length >= 1, 'expected at least one baseline write for the tightened floor');
  const written = JSON.parse(writes[writes.length - 1].content);
  assert.equal(written.dimensions.CV01.metrics['rust-line-coverage-pct'].baseline, 100);
  assert.equal(written.dimensions.CV01.metrics['min-line-coverage-pct'].baseline, 100);
  assert.match(stdout(), /VERDICT: PASS sensors gate/);
  assert.match(stdout(), /RATCHET: floor tightened/);
});

test('coverage: main() with --coverage flag flags regression and leaves floor untouched', async () => {
  // Seed baseline at 100, then regress to 99. The gate must fail and
  // baseline.json must not be rewritten.
  const seedEnvelope = envelope({});
  const baselineJson = `${JSON.stringify(
    extractApssFitnessBaseline(emptyReport(), { coverage: seedEnvelope }),
    null,
    2,
  )}\n`;
  const worseEnvelope = envelope({
    rust_line_pct: 99,
    rust_function_pct: 99,
    rust_region_pct: 99,
    python_line_pct: 99,
    javascript_line_pct: 99,
    min_line_pct: 99,
  });
  const coverageJson = `${JSON.stringify(worseEnvelope, null, 2)}\n`;

  const { io, writes, stdout } = stubIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': baselineJson,
      '/tmp/coverage.json': coverageJson,
    },
  });

  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
      '--coverage=/tmp/coverage.json',
    ],
    io,
  );

  assert.equal(code, 1, 'coverage regression should exit non-zero');
  assert.equal(writes.length, 0, 'regression must not rewrite baseline');
  assert.match(stdout(), /VERDICT: FAIL sensors gate/);
  assert.match(stdout(), /rust-line-coverage-pct/);
  assert.match(stdout(), /min-line-coverage-pct/);
});

test('coverage: main() with absent --coverage flag stays PASS when CV01 floor is null', async () => {
  // The repo-committed CV01 floor is 100, but a CV01 metric with a
  // null current value triggers worsened()=false (no-reading). This
  // confirms that omitting the adapter does NOT silently fail an
  // otherwise-passing gate run; the metric just goes unmeasured.
  const baselineJson = `${JSON.stringify(
    extractApssFitnessBaseline(emptyReport(), { coverage: envelope({}) }),
    null,
    2,
  )}\n`;
  const { io } = stubIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': baselineJson,
    },
  });
  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
    ],
    io,
  );
  assert.equal(code, 0, 'no --coverage flag must not crash or fail the gate');
});
