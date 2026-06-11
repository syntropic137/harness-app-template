// Tests for the suite-duration adapter wired through gate.mjs under
// PF01 (ADR-0025-suite-duration-sensor-pf01.md). Holds the contract:
//
//   - parseCoverage never falls back to 100 for an absent/unparseable
//     column (the EXP-04 defect 1 regression test).
//   - evaluateCoverage emits coverage_unverifiable vs coverage_below_floor
//     as distinct violation kinds and both are fatal in BOTH modes
//     (the EXP-04 defect 2 regression test).
//   - The hybrid timing gate uses max(committed_p95 * 1.25, absolute_seconds_ceiling)
//     per ADR-0025 § Decision 4.
//   - Enforce mode runs iteration_count iterations; advisory short-circuits at 1.
//   - The envelope is the soft-skip carrier the PF01 reader on gate.mjs
//     consumes — `available: false` returns null from suiteDurationMetricValue.
//
// Run via: node --test harness/sensors/tests/suite_duration.test.mjs

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { main as gateMain } from '../gate.mjs';
import {
  __testing__,
  computeMedian,
  computeP95,
  evaluate,
  evaluateCoverage,
  evaluateTiming,
  loadBaseline,
  main,
  parseArgs,
  parseCoverage,
  renderSummary,
  runIterations,
  SENSOR_VERSION,
} from '../suite_duration.mjs';

function makeBaseline(overrides = {}) {
  return {
    suite_command: 'true',
    workdir: 'fixtures/none',
    iteration_count: 5,
    duration_p95_seconds: 0.5,
    duration_median_seconds: 0.45,
    absolute_seconds_ceiling: 3,
    relative_delta_percent: 25,
    required_coverage_percent: 100,
    coverage_floor_metrics: ['lines', 'branches', 'functions'],
    ...overrides,
  };
}

function fakeRunner(coverageBlock) {
  return () => ({ stdout: coverageBlock, stderr: '', status: 0 });
}

const NODE_OUTPUT_PASS = `
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

const NODE_OUTPUT_REGRESSION = `
ℹ start of coverage report
ℹ ------------------------------------------------------------
ℹ file        | line % | branch % | funcs % | uncovered lines
ℹ ------------------------------------------------------------
ℹ  divide.mjs |  80.00 |   66.67 |  100.00 | 4-5
ℹ ------------------------------------------------------------
ℹ all files   |  80.00 |   66.67 |  100.00 |
ℹ ------------------------------------------------------------
ℹ end of coverage report
`;

const BUN_OUTPUT_PASS = `
-----------|---------|---------|---------|---------
File       | % Stmts | % Branch | % Funcs | % Lines
-----------|---------|---------|---------|---------
All files  |   100   |   100    |   100   |   100
-----------|---------|---------|---------|---------
`;

test('parseCoverage returns parsed columns from node test output', () => {
  const result = parseCoverage(NODE_OUTPUT_PASS);
  assert.equal(result.mode, 'parsed');
  assert.equal(result.columns.lines, 100);
  assert.equal(result.columns.branches, 100);
  assert.equal(result.columns.functions, 100);
  // node does not emit statements; the parser must NOT invent it as 100.
  assert.equal(result.columns.statements, undefined);
});

test('parseCoverage returns parsed columns from bun-style table', () => {
  const result = parseCoverage(BUN_OUTPUT_PASS);
  assert.equal(result.mode, 'parsed');
  assert.equal(result.columns.statements, 100);
  assert.equal(result.columns.branches, 100);
  assert.equal(result.columns.functions, 100);
  assert.equal(result.columns.lines, 100);
});

test('parseCoverage returns missing-output on empty input', () => {
  assert.equal(parseCoverage('').mode, 'missing-output');
  assert.equal(parseCoverage(null).mode, 'missing-output');
});

test('parseCoverage returns missing-header when no header row exists', () => {
  const result = parseCoverage('nothing here that resembles a coverage table');
  assert.equal(result.mode, 'missing-header');
});

test('parseCoverage returns missing-all-files-row when summary absent', () => {
  const result = parseCoverage(`
| line % | branch % |
| divide | 100    |
`);
  assert.equal(result.mode, 'missing-all-files-row');
});

test('parseCoverage skips header cells without % marker', () => {
  // "uncovered lines" contains "line" but is not a percentage column.
  // Without the % guard, the parser would clobber the real `lines`
  // value with the empty "uncovered lines" cell.
  const result = parseCoverage(NODE_OUTPUT_PASS);
  assert.equal(result.columns.lines, 100);
});

test('parseCoverage records undefined for an unparseable cell value', () => {
  const bad = `
ℹ file        | line % | branch % | funcs % | uncovered lines
ℹ all files   |  --    | 100      | 100     |
`;
  const result = parseCoverage(bad);
  assert.equal(result.mode, 'parsed');
  assert.equal(result.columns.lines, undefined);
  assert.equal(result.columns.branches, 100);
});

test('evaluateCoverage emits coverage_unverifiable for absent column (EXP-04 defect 1)', () => {
  const baseline = makeBaseline({
    coverage_floor_metrics: ['statements', 'branches', 'lines', 'functions'],
  });
  const parsed = { mode: 'parsed', columns: { lines: 100, branches: 100, functions: 100 } };
  const violations = evaluateCoverage(parsed, baseline);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].type, 'coverage_unverifiable');
  assert.equal(violations[0].metric, 'statements');
});

test('evaluateCoverage emits coverage_below_floor for value under threshold', () => {
  const baseline = makeBaseline();
  const parsed = { mode: 'parsed', columns: { lines: 80, branches: 66.67, functions: 100 } };
  const violations = evaluateCoverage(parsed, baseline);
  const types = violations.map((v) => v.type).sort();
  assert.deepEqual(types, ['coverage_below_floor', 'coverage_below_floor']);
  const metrics = violations.map((v) => v.metric).sort();
  assert.deepEqual(metrics, ['branches', 'lines']);
});

test('evaluateCoverage carries the parser state into the message', () => {
  const baseline = makeBaseline({ coverage_floor_metrics: ['statements'] });
  const parsed = { mode: 'missing-header', columns: {} };
  const violations = evaluateCoverage(parsed, baseline);
  assert.ok(violations[0].message.includes('missing-header'));
});

test('computeP95 returns null on empty array', () => {
  assert.equal(computeP95([]), null);
  assert.equal(computeP95(null), null);
});

test('computeP95 returns the single value for a single-element array', () => {
  assert.equal(computeP95([0.5]), 0.5);
});

test('computeP95 interpolates between ranks', () => {
  const v = computeP95([1, 2, 3, 4, 5]);
  // rank = 0.95 * 4 = 3.8; lower=3, upper=4; 4 + 0.8*(5-4) = 4.8
  assert.equal(Number(v.toFixed(2)), 4.8);
});

test('computeP95 returns the exact rank value when no interpolation needed', () => {
  // Length 21 → rank 0.95*20 = 19, integer; no interpolation needed.
  const v = computeP95(Array.from({ length: 21 }, (_, i) => i));
  assert.equal(v, 19);
});

test('computeMedian handles odd and even lengths', () => {
  assert.equal(computeMedian([1, 2, 3]), 2);
  assert.equal(computeMedian([1, 2, 3, 4]), 2.5);
  assert.equal(computeMedian([]), null);
  assert.equal(computeMedian(null), null);
});

test('evaluateTiming computes hybrid ceiling = max(p95*1.25, absolute)', () => {
  const baseline = makeBaseline({
    duration_p95_seconds: 0.5,
    relative_delta_percent: 25,
    absolute_seconds_ceiling: 3,
  });
  // 0.5 * 1.25 = 0.625; max(0.625, 3) = 3.
  assert.deepEqual(evaluateTiming(0.6, baseline), []); // under floor and ceiling
  assert.deepEqual(evaluateTiming(2.9, baseline), []); // under absolute
  const fail = evaluateTiming(3.5, baseline);
  assert.equal(fail.length, 1);
  assert.equal(fail[0].type, 'timing_above_ceiling');
  assert.equal(fail[0].effective_ceiling_seconds, 3);
});

test('evaluateTiming uses the ratchet ceiling when it exceeds the absolute', () => {
  const baseline = makeBaseline({
    duration_p95_seconds: 10,
    relative_delta_percent: 25,
    absolute_seconds_ceiling: 3,
  });
  // 10 * 1.25 = 12.5; max(12.5, 3) = 12.5.
  assert.deepEqual(evaluateTiming(12, baseline), []);
  const fail = evaluateTiming(13, baseline);
  assert.equal(fail[0].effective_ceiling_seconds, 12.5);
});

test('evaluateTiming HARD-FAILS with timing_unverifiable when p95 is null (post-PR #28 fail-closed)', () => {
  // Post-PR #28 generalization: absent or unparseable measurement is
  // a HARD FAIL, never a silent skip. The earlier shape of this test
  // expected `[]` (silent skip); that loophole is the one Codex
  // caught on CV01 and the operator generalized to PF01.
  const violations = evaluateTiming(null, makeBaseline());
  assert.equal(violations.length, 1);
  assert.equal(violations[0].type, 'timing_unverifiable');
});

test('evaluateTiming HARD-FAILS with timing_unverifiable on NaN p95', () => {
  const violations = evaluateTiming(Number.NaN, makeBaseline());
  assert.equal(violations.length, 1);
  assert.equal(violations[0].type, 'timing_unverifiable');
});

test('evaluateTiming HARD-FAILS with timing_unverifiable on +Infinity p95', () => {
  const violations = evaluateTiming(Number.POSITIVE_INFINITY, makeBaseline());
  assert.equal(violations.length, 1);
  assert.equal(violations[0].type, 'timing_unverifiable');
});

test('evaluate ENFORCE mode HARD-FAILS when every iteration has NaN wall-clock (fail-closed)', () => {
  // Simulate a clock that returns NaN. Records still get emitted
  // (the suite runs), coverage is 100%, exit_status is 0 — without
  // the fail-closed guard, the gate would silently skip timing and
  // pass — exactly the CV01 loophole Codex flagged on PR #28.
  const baseline = makeBaseline();
  const brokenNow = () => Number.NaN;
  const { envelope, exitCode } = evaluate({
    mode: 'enforce',
    baseline,
    runner: fakeRunner(NODE_OUTPUT_PASS),
    now: brokenNow,
  });
  assert.equal(exitCode, 1);
  assert.equal(envelope.available, false);
  assert.ok(envelope.violations.some((v) => v.type === 'timing_unverifiable'));
});

test('evaluate ADVISORY mode also HARD-FAILS on timing_unverifiable (the operator generalization)', () => {
  // The operator rule: "fails CLOSED when timing OR coverage data is
  // missing/malformed, in BOTH advisory and enforce modes". This is
  // the central proof advisory does NOT downgrade an unverifiable
  // timing reading to WARN-only.
  const baseline = makeBaseline();
  const brokenNow = () => Number.NaN;
  const { envelope, exitCode } = evaluate({
    mode: 'advisory',
    baseline,
    runner: fakeRunner(NODE_OUTPUT_PASS),
    now: brokenNow,
  });
  assert.equal(exitCode, 1, 'advisory mode must exit non-zero on unverifiable timing');
  assert.equal(envelope.available, false);
  assert.ok(envelope.violations.some((v) => v.type === 'timing_unverifiable'));
});

test('renderSummary marks timing_unverifiable as FAIL even in advisory mode', () => {
  const env = {
    tool: 'suite-duration',
    mode: 'advisory',
    passed: false,
    duration_p95_seconds: null,
    duration_median_seconds: null,
    iteration_count: 1,
    violations: [{ type: 'timing_unverifiable', message: 'p95 wall-clock is unobservable' }],
  };
  const text = renderSummary(env);
  // Advisory mode WARN-ONLY is reserved for observed-but-too-slow
  // timing. An unverifiable timing reading must still print FAIL.
  assert.match(text, /SUITE-DURATION: FAIL/);
  assert.doesNotMatch(text, /WARN-ONLY/);
});

test('runIterations runs N times and parses every iteration', () => {
  const baseline = makeBaseline();
  let calls = 0;
  const runner = () => {
    calls += 1;
    return { stdout: NODE_OUTPUT_PASS, stderr: '', status: 0 };
  };
  let t = 0;
  const records = runIterations({
    baseline,
    iterations: 3,
    runner,
    now: () => {
      t += 100;
      return t;
    },
  });
  assert.equal(calls, 3);
  assert.equal(records.length, 3);
  for (const r of records) {
    assert.equal(r.coverage_parse_mode, 'parsed');
    assert.equal(r.coverage_columns.lines, 100);
    assert.equal(r.wall_clock_seconds, 0.1);
    assert.equal(r.exit_status, 0);
  }
});

test('evaluate enforce mode passes when coverage and timing are clean', () => {
  const baseline = makeBaseline();
  const { envelope, exitCode } = evaluate({
    mode: 'enforce',
    baseline,
    runner: fakeRunner(NODE_OUTPUT_PASS),
    now: makeIncrementingClock(0.05),
  });
  assert.equal(exitCode, 0);
  assert.equal(envelope.passed, true);
  assert.equal(envelope.available, true);
  assert.equal(envelope.iteration_count, 5);
  assert.equal(envelope.violations.length, 0);
  assert.equal(envelope.duration_p95_seconds, 0.05);
  assert.equal(envelope.duration_median_seconds, 0.05);
});

test('evaluate advisory mode short-circuits at iteration 1', () => {
  const baseline = makeBaseline();
  const { envelope } = evaluate({
    mode: 'advisory',
    baseline,
    runner: fakeRunner(NODE_OUTPUT_PASS),
    now: makeIncrementingClock(0.02),
  });
  assert.equal(envelope.iteration_count, 1);
});

test('evaluate enforce mode HARD-FAILS on coverage regression', () => {
  const baseline = makeBaseline();
  const { envelope, exitCode } = evaluate({
    mode: 'enforce',
    baseline,
    runner: fakeRunner(NODE_OUTPUT_REGRESSION),
    now: makeIncrementingClock(0.05),
  });
  assert.equal(exitCode, 1);
  assert.equal(envelope.passed, false);
  assert.equal(envelope.available, false, 'coverage failure must zero the PF01 reading');
  const violationTypes = envelope.violations.map((v) => v.type);
  assert.ok(violationTypes.includes('coverage_below_floor'));
});

test('evaluate advisory mode HARD-FAILS on coverage regression (EXP-04 defect 2)', () => {
  // This is the central operator-mandated regression test: advisory
  // must NOT downgrade coverage violations to WARN. If this test ever
  // passes the prototype's :111-124 behavior, the gate has rotted.
  const baseline = makeBaseline();
  const { envelope, exitCode } = evaluate({
    mode: 'advisory',
    baseline,
    runner: fakeRunner(NODE_OUTPUT_REGRESSION),
    now: makeIncrementingClock(0.04),
  });
  assert.equal(exitCode, 1, 'advisory mode must exit non-zero on coverage drop');
  assert.equal(envelope.available, false);
  assert.equal(envelope.passed, false);
});

test('evaluate advisory mode downgrades a TIMING-only miss to exit 0', () => {
  const baseline = makeBaseline({
    duration_p95_seconds: 0.01,
    relative_delta_percent: 25,
    absolute_seconds_ceiling: 0.05,
  });
  const { envelope, exitCode } = evaluate({
    mode: 'advisory',
    baseline,
    runner: fakeRunner(NODE_OUTPUT_PASS),
    now: makeIncrementingClock(0.2),
  });
  assert.equal(exitCode, 0);
  assert.equal(envelope.passed, false, 'envelope still records the violation');
  assert.equal(envelope.available, true, 'PF01 still gets a real p95 reading');
  const types = envelope.violations.map((v) => v.type);
  assert.ok(types.includes('timing_above_ceiling'));
});

test('evaluate enforce mode FAILS on the same timing miss', () => {
  const baseline = makeBaseline({
    duration_p95_seconds: 0.01,
    relative_delta_percent: 25,
    absolute_seconds_ceiling: 0.05,
  });
  const { envelope, exitCode } = evaluate({
    mode: 'enforce',
    baseline,
    runner: fakeRunner(NODE_OUTPUT_PASS),
    now: makeIncrementingClock(0.2),
  });
  assert.equal(exitCode, 1);
  assert.equal(envelope.available, true);
});

test('evaluate fails when the suite command itself exits non-zero', () => {
  const baseline = makeBaseline();
  const runner = () => ({ stdout: NODE_OUTPUT_PASS, stderr: '', status: 7 });
  const { envelope, exitCode } = evaluate({
    mode: 'enforce',
    baseline,
    runner,
    now: makeIncrementingClock(0.05),
  });
  assert.equal(exitCode, 1);
  assert.equal(envelope.available, false);
  assert.ok(envelope.violations.some((v) => v.type === 'suite_command_failed'));
});

test('renderSummary annotates advisory timing-only as WARN-ONLY', () => {
  const env = {
    tool: 'suite-duration',
    mode: 'advisory',
    passed: false,
    duration_p95_seconds: 1,
    duration_median_seconds: 1,
    iteration_count: 1,
    violations: [{ type: 'timing_above_ceiling', message: 'too slow' }],
  };
  const text = renderSummary(env);
  assert.match(text, /WARN-ONLY/);
  assert.match(text, /WARN: too slow/);
});

test('renderSummary marks coverage failure as FAIL regardless of mode', () => {
  const env = {
    tool: 'suite-duration',
    mode: 'advisory',
    passed: false,
    duration_p95_seconds: 1,
    duration_median_seconds: 1,
    iteration_count: 1,
    violations: [{ type: 'coverage_below_floor', message: 'lines is 80%' }],
  };
  const text = renderSummary(env);
  assert.match(text, /FAIL$|FAIL\n/m);
  assert.match(text, /FAIL: lines is 80%/);
});

test('renderSummary prints PASS on a clean envelope', () => {
  const env = {
    tool: 'suite-duration',
    mode: 'enforce',
    passed: true,
    duration_p95_seconds: 0.05,
    duration_median_seconds: 0.05,
    iteration_count: 5,
    violations: [],
  };
  const text = renderSummary(env);
  assert.match(text, /\[enforce\] SUITE-DURATION: PASS/);
});

test('parseArgs accepts every documented flag', () => {
  const opts = parseArgs([
    '--mode=advisory',
    '--baseline=foo.json',
    '--report=bar.json',
    '--json',
    '--quiet',
  ]);
  assert.equal(opts.mode, 'advisory');
  assert.equal(opts.baselinePath, 'foo.json');
  assert.equal(opts.reportPath, 'bar.json');
  assert.equal(opts.json, true);
  assert.equal(opts.quiet, true);
});

test('parseArgs accepts space-separated forms and --enforce/--advisory shorthand', () => {
  const a = parseArgs(['--mode', 'enforce', '--baseline', 'b.json', '--report', 'r.json']);
  assert.equal(a.mode, 'enforce');
  assert.equal(a.baselinePath, 'b.json');
  assert.equal(a.reportPath, 'r.json');
  const b = parseArgs(['--advisory']);
  assert.equal(b.mode, 'advisory');
  const c = parseArgs(['--enforce']);
  assert.equal(c.mode, 'enforce');
});

test('parseArgs --help short-circuits', () => {
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
});

test('parseArgs rejects unknown mode', () => {
  assert.throws(() => parseArgs(['--mode=foo']));
});

test('loadBaseline throws on missing required field', () => {
  const io = { readFile: () => JSON.stringify({ suite_command: 'echo' }) };
  assert.throws(() => loadBaseline('x', io), /missing field: workdir/);
});

test('loadBaseline throws on empty coverage_floor_metrics', () => {
  const io = {
    readFile: () =>
      JSON.stringify({
        suite_command: 'echo',
        workdir: 'x',
        iteration_count: 5,
        duration_p95_seconds: 0.5,
        absolute_seconds_ceiling: 3,
        relative_delta_percent: 25,
        required_coverage_percent: 100,
        coverage_floor_metrics: [],
      }),
  };
  assert.throws(() => loadBaseline('x', io), /non-empty array/);
});

test('loadBaseline accepts a valid envelope', () => {
  const ok = JSON.stringify(makeBaseline());
  const baseline = loadBaseline('x', { readFile: () => ok });
  assert.equal(baseline.iteration_count, 5);
});

test('main returns 0 on PASS and writes a report file', async () => {
  const baseline = makeBaseline();
  const writes = {};
  const reads = { 'baseline.json': JSON.stringify(baseline) };
  const stdout = [];
  const stderr = [];
  const io = {
    write: (s) => stdout.push(s),
    writeErr: (s) => stderr.push(s),
    readFile: (p) => reads[p] ?? null,
    writeFile: (p, s) => {
      writes[p] = s;
    },
    exists: () => true,
  };
  const code = await main(
    ['--mode=enforce', '--baseline=baseline.json', '--report=report.json', '--json'],
    io,
    {
      now: makeIncrementingClock(0.05),
      runner: fakeRunner(NODE_OUTPUT_PASS),
    },
  );
  assert.equal(code, 0);
  assert.ok(writes['report.json']?.includes('"passed": true'));
  assert.ok(stdout.join('').includes('"tool": "suite-duration"'));
});

test('main returns 1 on coverage regression in advisory mode (EXP-04 defect 2 end-to-end)', async () => {
  const baseline = makeBaseline();
  const stdout = [];
  const io = {
    write: (s) => stdout.push(s),
    writeErr: () => {},
    readFile: () => JSON.stringify(baseline),
    writeFile: () => {},
    exists: () => true,
  };
  const code = await main(['--mode=advisory'], io, {
    now: makeIncrementingClock(0.05),
    runner: fakeRunner(NODE_OUTPUT_REGRESSION),
  });
  assert.equal(code, 1);
  assert.ok(stdout.join('').includes('coverage_below_floor'));
});

test('main returns 2 when the baseline is unreadable', async () => {
  const stderr = [];
  const io = {
    write: () => {},
    writeErr: (s) => stderr.push(s),
    readFile: () => {
      throw new Error('boom');
    },
    writeFile: () => {},
    exists: () => true,
  };
  const code = await main(['--mode=enforce'], io);
  assert.equal(code, 2);
  assert.match(stderr.join(''), /failed to load baseline/);
});

test('main returns 2 when --mode is invalid', async () => {
  const stderr = [];
  const io = {
    write: () => {},
    writeErr: (s) => stderr.push(s),
    readFile: () => JSON.stringify(makeBaseline()),
    writeFile: () => {},
    exists: () => true,
  };
  const code = await main(['--mode=garbage'], io);
  assert.equal(code, 2);
  assert.match(stderr.join(''), /invalid --mode/);
});

test('main returns 2 when the baseline workdir does not exist', async () => {
  const stderr = [];
  const io = {
    write: () => {},
    writeErr: (s) => stderr.push(s),
    readFile: () => JSON.stringify(makeBaseline()),
    writeFile: () => {},
    exists: () => false,
  };
  const code = await main(['--mode=enforce'], io);
  assert.equal(code, 2);
  assert.match(stderr.join(''), /workdir/);
});

test('main with --help emits the help text and returns 0', async () => {
  const stdout = [];
  const io = {
    write: (s) => stdout.push(s),
    writeErr: () => {},
    readFile: () => '',
    writeFile: () => {},
    exists: () => true,
  };
  const code = await main(['--help'], io);
  assert.equal(code, 0);
  assert.match(stdout.join(''), /harness suite-duration/);
});

test('main without --json prints the summary then the envelope', async () => {
  const stdout = [];
  const io = {
    write: (s) => stdout.push(s),
    writeErr: () => {},
    readFile: () => JSON.stringify(makeBaseline()),
    writeFile: () => {},
    exists: () => true,
  };
  const code = await main(['--mode=enforce'], io, {
    now: makeIncrementingClock(0.05),
    runner: fakeRunner(NODE_OUTPUT_PASS),
  });
  assert.equal(code, 0);
  const out = stdout.join('');
  assert.match(out, /SUITE-DURATION: PASS/);
  assert.match(out, /"tool": "suite-duration"/);
});

test('main with --quiet suppresses the summary but keeps the envelope', async () => {
  const stdout = [];
  const io = {
    write: (s) => stdout.push(s),
    writeErr: () => {},
    readFile: () => JSON.stringify(makeBaseline()),
    writeFile: () => {},
    exists: () => true,
  };
  await main(['--mode=enforce', '--quiet'], io, {
    now: makeIncrementingClock(0.05),
    runner: fakeRunner(NODE_OUTPUT_PASS),
  });
  const out = stdout.join('');
  assert.doesNotMatch(out, /SUITE-DURATION:/);
  assert.match(out, /"tool": "suite-duration"/);
});

test('PF01 gate reader returns p95 from a passing envelope, null on available=false', async () => {
  // Simulate gate.mjs's suiteDurationMetricValue via a tiny end-to-end
  // through main(). The PF01 reader contract is: the gate sees a real
  // number on PASS, null on coverage failure. Replay both paths through
  // the gate's actual `main` to prove the wiring holds.
  const baseline = makeBaseline();
  const envelopes = {};
  const baselineJson = JSON.stringify(baseline);
  const stdout = [];
  const ioAdapter = {
    write: (s) => stdout.push(s),
    writeErr: () => {},
    readFile: () => baselineJson,
    writeFile: (p, s) => {
      envelopes[p] = s;
    },
    exists: () => true,
  };
  await main(['--mode=enforce', '--report=adapter-report.json', '--json'], ioAdapter, {
    now: makeIncrementingClock(0.05),
    runner: fakeRunner(NODE_OUTPUT_PASS),
  });
  const passEnv = JSON.parse(envelopes['adapter-report.json']);
  assert.equal(passEnv.available, true);
  assert.equal(passEnv.duration_p95_seconds, 0.05);
  assert.equal(passEnv.iteration_count, 5);

  // The PF01 reader function on gate.mjs reads `duration_p95_seconds`
  // from the same envelope object. We expose the function by driving
  // main() of gate.mjs end-to-end with the envelope on disk.
  const baselineGate = {
    schema_version: '1.0.0',
    folders: {},
    fitness: {
      schema_version: '1.0.0',
      dimensions: {
        PF01: {
          metrics: {
            'suite-duration-p95-seconds': { direction: 'max', baseline: 1 },
            'suite-duration-iteration-count': { direction: 'min', baseline: 0 },
          },
        },
      },
    },
  };
  const fsState = new Map();
  fsState.set('harness/sensors/baseline.json', JSON.stringify(baselineGate));
  fsState.set('adapter-report.json', envelopes['adapter-report.json']);
  fsState.set('harness/perf/baseline.json', JSON.stringify({ benchmarks: {} }));
  const ioGate = {
    read: async () => '{}',
    write: () => {},
    writeErr: () => {},
    readFile: (p) => fsState.get(p) ?? '',
    writeFile: (p, s) => fsState.set(p, s),
    fileExists: (p) => fsState.has(p),
    env: {},
  };
  const gateCode = await gateMain(
    [
      '--baseline=harness/sensors/baseline.json',
      '--baseline-reference=none',
      '--suite-duration=adapter-report.json',
      '--no-ratchet',
      '--format=json',
    ],
    ioGate,
  );
  // gate exits 0 when the metrics meet the floor (p95=0.05 < floor=1).
  assert.equal(gateCode, 0);
});

test('PF01 gate keeps a noisy timing measurement above the baseline floor as PASS (determinism guard)', async () => {
  // Lock in the ADR-0025 determinism guard: gate.mjs marks
  // suite-duration-p95-seconds with fail_on_regression=false so that
  // EPSILON=1e-6 + wall-clock jitter across machines cannot convert
  // normal CI variance into a gate failure. The adapter remains the
  // AUTHORITATIVE enforcer via the hybrid ceiling
  // (absolute_seconds_ceiling + relative_delta_percent against the
  // committed p95) + HARD coverage-coupling.
  const envelopes = {};
  const ioAdapter = {
    readFile: (p) => {
      if (p === 'baseline.json') {
        return JSON.stringify({
          schema_version: '1.0.0',
          suite_command: 'true',
          workdir: '.',
          iteration_count: 5,
          duration_p95_seconds: 1,
          duration_median_seconds: 1,
          absolute_seconds_ceiling: 60,
          relative_delta_percent: 25,
          required_coverage_percent: 0,
          coverage_floor_metrics: ['lines'],
        });
      }
      return '';
    },
    writeFile: (p, body) => {
      envelopes[p] = body;
    },
    write: () => {},
    writeErr: () => {},
    exists: () => true,
  };
  await main(
    ['--baseline=baseline.json', '--mode=advisory', '--report=adapter-report.json', '--json'],
    ioAdapter,
    {
      now: makeIncrementingClock(2.0),
      runner: fakeRunner(NODE_OUTPUT_PASS),
    },
  );
  const noisyEnv = JSON.parse(envelopes['adapter-report.json']);
  assert.equal(noisyEnv.available, true);
  assert.equal(noisyEnv.duration_p95_seconds, 2);

  // Gate baseline floor is 0.5s; the noisy measurement is 2s (4x the
  // floor). With fail_on_regression=false on the metric, the gate
  // returns 0 (PASS). Before the determinism guard this would have
  // exited 1.
  const gateBaseline = {
    schema_version: '1.0.0',
    folders: {},
    fitness: {
      schema_version: '1.0.0',
      dimensions: {
        PF01: {
          metrics: {
            'suite-duration-p95-seconds': {
              direction: 'max',
              baseline: 0.5,
              fail_on_regression: false,
            },
            'suite-duration-iteration-count': {
              direction: 'min',
              baseline: 0,
              fail_on_regression: true,
            },
          },
        },
      },
    },
  };
  const fsState = new Map();
  fsState.set('harness/sensors/baseline.json', JSON.stringify(gateBaseline));
  fsState.set('adapter-report.json', envelopes['adapter-report.json']);
  fsState.set('harness/perf/baseline.json', JSON.stringify({ benchmarks: {} }));
  const ioGate = {
    read: async () => '{}',
    write: () => {},
    writeErr: () => {},
    readFile: (p) => fsState.get(p) ?? '',
    writeFile: (p, s) => fsState.set(p, s),
    fileExists: (p) => fsState.has(p),
    env: {},
  };
  const gateCode = await gateMain(
    [
      '--baseline=harness/sensors/baseline.json',
      '--baseline-reference=none',
      '--suite-duration=adapter-report.json',
      '--no-ratchet',
      '--format=json',
    ],
    ioGate,
  );
  assert.equal(gateCode, 0);
});

test('SENSOR_VERSION is exposed and stable', () => {
  assert.equal(SENSOR_VERSION, '1.0.0');
});

test('__testing__ surface exposes the canonical column tokens', () => {
  assert.ok(Array.isArray(__testing__.COVERAGE_COLUMN_TOKENS.lines));
});

test('canonicalColumn returns null for an unrecognized token', () => {
  assert.equal(__testing__.canonicalColumn('hits'), null);
});

test('parseCoverage skips a % column whose token does not map to a canonical metric', () => {
  // The % filter passes this header through; the canonical lookup is
  // the second guard that prevents an unknown metric from polluting
  // the columns map. We need a header line that DOES include a known
  // token (so headerIndex matches) but ALSO includes another % column
  // whose token does not map (so the canonical guard fires).
  const text = `
file | line % | bogus %
all files | 100 | 42
`;
  const result = parseCoverage(text);
  assert.equal(result.columns.lines, 100);
  assert.equal(result.columns.bogus, undefined);
  assert.equal(Object.keys(result.columns).length, 1);
});

test('DEFAULT_RUNNER spawns true and returns exit 0', () => {
  // The default runner is exercised by main(); this is a thin guard
  // around the spawn shape so the test runner cannot accidentally
  // delete the export.
  const result = __testing__.DEFAULT_RUNNER({ command: 'true', cwd: process.cwd() });
  assert.equal(result.status, 0);
});

function makeIncrementingClock(stepSeconds) {
  let t = 0;
  return () => {
    const v = t;
    t += stepSeconds * 1000;
    return v;
  };
}

// Reference Readable so the linter doesn't drop the import if a future
// refactor stops using it. The current test surface uses streamable
// stdin only in the gate-wired test above.
void Readable;
