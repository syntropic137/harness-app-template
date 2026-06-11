// Unit tests for the profiling slot core: shared lib, budgets parser, and
// the generalized per-signal gate (bead create-harness-app-z41).
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_TOLERANCE,
  loadBudgets,
  normalizeBudgets,
  parseTomlSubset,
  // @ts-expect-error - plain ESM, no .d.ts ships with the slot.
} from '../../harness/profiling/src/budgets.mjs';
import {
  buildVerdict,
  evaluateSignals,
  main as gateMain,
  gateSignals,
  normalizeSignals,
  renderGateReport,
  toBaseline,
  // @ts-expect-error - plain ESM, no .d.ts ships with the slot.
} from '../../harness/profiling/src/gate.mjs';
import {
  artifactDirName,
  generateSpanId,
  generateTraceId,
  isoKey,
  isScriptEntry,
  parseArgs,
  percentile,
  summarizeLatencies,
  traceparent,
  walkFiles,
  // @ts-expect-error - plain ESM, no .d.ts ships with the slot.
} from '../../harness/profiling/src/lib.mjs';
import { makeStubIo } from './helpers/profiling-io';

describe('profiling lib', () => {
  test('percentile uses nearest-rank over an unsorted sample', () => {
    const sample = [50, 10, 20, 40, 30, 60, 70, 80, 90, 100];
    expect(percentile(sample, 0.5)).toBe(50);
    expect(percentile(sample, 0.95)).toBe(100);
    expect(percentile(sample, 0.99)).toBe(100);
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile(undefined, 0.5)).toBeNull();
  });

  test('summarizeLatencies reports count, percentiles, mean, min, max', () => {
    const stats = summarizeLatencies([10, 20, 30, 40]);
    expect(stats).toEqual({ count: 4, p50: 20, p95: 40, p99: 40, mean: 25, min: 10, max: 40 });
    expect(summarizeLatencies([])).toEqual({
      count: 0,
      p50: null,
      p95: null,
      p99: null,
      mean: null,
      min: null,
      max: null,
    });
  });

  test('trace and span ids are hex of the right width; traceparent is W3C-shaped', () => {
    const { io } = makeStubIo();
    const randomBytes = io.randomBytes as (n: number) => Buffer;
    const traceId = generateTraceId(randomBytes);
    const spanId = generateSpanId(randomBytes);
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(traceparent(traceId, spanId)).toBe(`00-${traceId}-${spanId}-01`);
  });

  test('isoKey and artifactDirName produce a sortable trace-linked name', () => {
    const date = new Date('2026-06-11T01:02:03.456Z');
    expect(isoKey(date)).toBe('20260611T010203Z');
    expect(artifactDirName(date, 'abc123')).toBe('20260611T010203Z--abc123');
  });

  test('walkFiles recurses and filters by pattern, sorted', () => {
    const { io } = makeStubIo({
      files: {
        'root/a.js': 'a',
        'root/sub/b.css': 'b',
        'root/sub/deep/c.js': 'c',
        'root/skip.txt': 'no',
      },
    });
    expect(walkFiles(io, 'root', /\.(js|css)$/)).toEqual([
      'root/a.js',
      'root/sub/b.css',
      'root/sub/deep/c.js',
    ]);
  });

  test('parseArgs splits flags and positional arguments', () => {
    expect(parseArgs(['--url=http://x', '--update-baseline', 'pos', '--n=2'])).toEqual({
      flags: { url: 'http://x', 'update-baseline': true, n: '2' },
      positional: ['pos'],
    });
  });

  test('isScriptEntry resolves real paths and never throws', () => {
    const self = join(tmpdir(), `profiling-entry-${process.pid}.mjs`);
    writeFileSync(self, '// entry probe\n');
    expect(isScriptEntry(pathToFileURL(self).href, self)).toBe(true);
    expect(isScriptEntry(pathToFileURL(self).href, '/nonexistent/other.mjs')).toBe(false);
    expect(isScriptEntry(pathToFileURL(self).href, undefined)).toBe(false);
  });
});

describe('budgets parser', () => {
  test('parses the documented subset: tables, quoted segments, scalars, comments', () => {
    const doc = parseTomlSubset(`
# top comment
[signals."api.latency.p99"]
budget = 250.0 # trailing comment
tolerance = 0.5
gate = true
label = "tail latency"

[signals."api.throughput.rps"]
direction = "higher"
gate = false
`);
    expect(doc).toEqual({
      signals: {
        'api.latency.p99': { budget: 250, tolerance: 0.5, gate: true, label: 'tail latency' },
        'api.throughput.rps': { direction: 'higher', gate: false },
      },
    });
  });

  test('rejects everything outside the subset with a line-numbered error', () => {
    const bad = [
      '[signals."unterminated]',
      '[signals.]',
      '[]',
      '[signals."a" extra]',
      'just words',
      '= 3',
      'key = [1, 2]',
    ];
    for (const text of bad) {
      expect(() => parseTomlSubset(text)).toThrow(/budgets parse error at line 1/);
    }
  });

  test('normalizeBudgets fills defaults and validates fields', () => {
    const normalized = normalizeBudgets({ signals: { s: {} } });
    expect(normalized.signals['s']).toEqual({
      tolerance: DEFAULT_TOLERANCE,
      gate: false,
      direction: 'lower',
    });
    expect(() => normalizeBudgets({ signals: { s: 5 } })).toThrow(/must be a table/);
    expect(() => normalizeBudgets({ signals: { s: { budget: 'x' } } })).toThrow(/budget/);
    expect(() => normalizeBudgets({ signals: { s: { tolerance: -1 } } })).toThrow(/tolerance/);
    expect(() => normalizeBudgets({ signals: { s: { gate: 'yes' } } })).toThrow(/gate/);
    expect(() => normalizeBudgets({ signals: { s: { direction: 'up' } } })).toThrow(/direction/);
    expect(normalizeBudgets({}).signals).toEqual({});
  });

  test('loadBudgets parses end to end', () => {
    const budgets = loadBudgets('[signals."x"]\ngate = true\n');
    expect(budgets.signals['x']).toMatchObject({ gate: true, direction: 'lower' });
  });
});

describe('profiling gate evaluation', () => {
  test('normalizeSignals accepts numbers and {value, unit}; drops junk', () => {
    expect(
      normalizeSignals({
        plain: 5,
        shaped: { value: 1.5, unit: 'ms' },
        noUnit: { value: 2 },
        bad: { value: 'x' },
        nan: { value: Number.NaN },
        nope: 'str',
      }),
    ).toEqual({
      plain: { value: 5, unit: null },
      shaped: { value: 1.5, unit: 'ms' },
      noUnit: { value: 2, unit: null },
    });
  });

  test('signals without baseline are NEW; within tolerance is PASS', () => {
    const baseline = { signals: { known: { value: 100, unit: 'ms' } } };
    const result = evaluateSignals(
      { known: { value: 110, unit: 'ms' }, fresh: { value: 5, unit: 'ms' } },
      baseline,
      { signals: {} },
    );
    expect(result.ok).toBe(true);
    expect(result.results.find((r: { signal: string }) => r.signal === 'known')?.status).toBe(
      'pass',
    );
    expect(result.summary.newSignals).toEqual(['fresh']);
  });

  test('regression is ADVISORY by default and GATED with gate = true', () => {
    const baseline = { signals: { s: { value: 100, unit: 'ms' } } };
    const current = { s: { value: 140, unit: 'ms' } };
    const advisory = evaluateSignals(current, baseline, { signals: {} });
    expect(advisory.ok).toBe(true);
    expect(advisory.results[0].status).toBe('advisory-regression');
    const gated = evaluateSignals(current, baseline, {
      signals: { s: { gate: true, tolerance: 0.25, direction: 'lower' } },
    });
    expect(gated.ok).toBe(false);
    expect(gated.results[0].status).toBe('fail-regression');
  });

  test('absolute budget fails regardless of baseline, in both directions', () => {
    const overhead = evaluateSignals(
      { lat: { value: 300, unit: 'ms' } },
      { signals: {} },
      { signals: { lat: { budget: 250, tolerance: 0.25, gate: false, direction: 'lower' } } },
    );
    expect(overhead.ok).toBe(false);
    expect(overhead.results[0].status).toBe('fail-budget');

    const throughput = evaluateSignals(
      { rps: { value: 20, unit: 'rps' } },
      { signals: {} },
      { signals: { rps: { budget: 50, tolerance: 0.25, gate: false, direction: 'higher' } } },
    );
    expect(throughput.ok).toBe(false);
    expect(throughput.results[0].status).toBe('fail-budget');

    const fine = evaluateSignals(
      { rps: { value: 80, unit: 'rps' } },
      { signals: {} },
      { signals: { rps: { budget: 50, tolerance: 0.25, gate: false, direction: 'higher' } } },
    );
    expect(fine.results[0].status).toBe('new');
  });

  test('higher-is-better regression compares against a floor ceiling', () => {
    const baseline = { signals: { rps: { value: 100, unit: 'rps' } } };
    const regressed = evaluateSignals({ rps: { value: 60, unit: 'rps' } }, baseline, {
      signals: { rps: { gate: true, tolerance: 0.25, direction: 'higher' } },
    });
    expect(regressed.ok).toBe(false);
    expect(regressed.results[0].ceiling).toBeCloseTo(75);
    const fine = evaluateSignals({ rps: { value: 90, unit: 'rps' } }, baseline, {
      signals: { rps: { gate: true, tolerance: 0.25, direction: 'higher' } },
    });
    expect(fine.ok).toBe(true);
  });

  test('toBaseline snapshots normalized signals', () => {
    expect(toBaseline({ a: 1, b: { value: 2, unit: 's' } })).toEqual({
      signals: { a: { value: 1, unit: null }, b: { value: 2, unit: 's' } },
    });
  });

  test('renderGateReport prints one labeled line per signal plus remediation on FAIL', () => {
    const evaluation = evaluateSignals(
      {
        pass: { value: 90, unit: 'ms' },
        fail: { value: 400, unit: 'ms' },
        fresh: { value: 1, unit: 'ms' },
      },
      { signals: { pass: { value: 100, unit: 'ms' }, fail: { value: 100, unit: 'ms' } } },
      { signals: { fail: { gate: true, tolerance: 0.25, direction: 'lower', budget: 200 } } },
    );
    const report = renderGateReport(evaluation);
    expect(report).toContain('profiling gate: FAIL');
    expect(report).toContain('[ OK ] PASS');
    expect(report).toContain('[FAIL] over budget');
    expect(report).toContain('[ -- ] NEW');
    expect(report).toContain('budget 200ms');
    expect(report).toContain('--update-baseline');

    const ok = renderGateReport(
      evaluateSignals(
        { s: { value: 1, unit: null } },
        { signals: { s: { value: 1 } } },
        { signals: {} },
      ),
    );
    expect(ok).toContain('profiling gate: PASS');
    expect(ok).not.toContain('--update-baseline');
  });

  test('renderGateReport renders advisory regressions with ceiling and baseline', () => {
    const evaluation = evaluateSignals(
      { s: { value: 140, unit: 'ms' } },
      { signals: { s: { value: 100, unit: 'ms' } } },
      { signals: {} },
    );
    const report = renderGateReport(evaluation);
    expect(report).toContain('[WARN] ADVISORY regression');
    expect(report).toContain('(baseline 100ms)');
    expect(report).toContain('ceiling 125ms');
  });

  test('buildVerdict assembles the persisted document shape', () => {
    const evaluation = evaluateSignals({ s: 1 }, { signals: {} }, { signals: {} });
    const verdict = buildVerdict({
      mode: 'api',
      capturedAt: '2026-06-11T01:02:03.456Z',
      traceId: 'abc',
      signals: { s: 1 },
      evaluation,
      artifacts: ['verdict.json'],
    });
    expect(verdict).toMatchObject({
      schemaVersion: '1.0',
      slot: 'profiling',
      mode: 'api',
      traceId: 'abc',
      advisory: true,
      artifacts: ['verdict.json'],
    });
    expect(verdict.signals['s']).toEqual({ value: 1, unit: null });
    const minimal = buildVerdict({
      mode: 'ui',
      capturedAt: 'x',
      traceId: undefined,
      signals: {},
      evaluation,
    });
    expect(minimal.traceId).toBeNull();
    expect(minimal.artifacts).toEqual([]);
  });
});

describe('gateSignals flow', () => {
  test('first run snapshots the baseline and passes', () => {
    const { io, writes } = makeStubIo();
    const outcome = gateSignals({ s: { value: 5, unit: 'ms' } }, io, {
      baselinePath: 'base.json',
      budgetsPath: 'budgets.toml',
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.messages[0]).toContain('baseline created at base.json');
    expect(JSON.parse(writes['base.json'] ?? '')).toEqual({
      signals: { s: { value: 5, unit: 'ms' } },
    });
  });

  test('update-baseline rewrites the floor deliberately', () => {
    const { io, writes } = makeStubIo({ files: { 'base.json': '{"signals":{"s":{"value":1}}}' } });
    const outcome = gateSignals({ s: { value: 9, unit: 'ms' } }, io, {
      baselinePath: 'base.json',
      updateBaseline: true,
    });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.messages[0]).toContain('baseline updated');
    expect(JSON.parse(writes['base.json'] ?? '').signals['s'].value).toBe(9);
  });

  test('budgets file is honored when present; gated regression exits 1', () => {
    const { io } = makeStubIo({
      files: {
        'base.json': JSON.stringify({ signals: { s: { value: 100, unit: 'ms' } } }),
        'budgets.toml': '[signals."s"]\ngate = true\n',
      },
    });
    const outcome = gateSignals({ s: { value: 200, unit: 'ms' } }, io, {
      baselinePath: 'base.json',
      budgetsPath: 'budgets.toml',
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.evaluation.ok).toBe(false);
  });

  test('default paths point at the slot files', () => {
    const { io, writes } = makeStubIo();
    gateSignals({ s: 1 }, io, {});
    expect(Object.keys(writes)).toEqual(['harness/profiling/baseline.json']);
  });
});

describe('profiling gate CLI', () => {
  function cliIo(stdin: string, files: Record<string, string> = {}) {
    const handle = makeStubIo({ files });
    (handle.io as Record<string, unknown>)['read'] = async () => stdin;
    return handle;
  }

  test('returns 2 on empty stdin, bad JSON, and stdin read failures', async () => {
    const empty = cliIo('   ');
    expect(await gateMain([], empty.io)).toBe(2);
    expect(empty.stderr.join('')).toContain('empty stdin');

    const bad = cliIo('not json');
    expect(await gateMain([], bad.io)).toBe(2);
    expect(bad.stderr.join('')).toContain('not valid JSON');

    const failing = cliIo('');
    (failing.io as Record<string, unknown>)['read'] = async () => {
      throw new Error('closed');
    };
    expect(await gateMain([], failing.io)).toBe(2);
    expect(failing.stderr.join('')).toContain('failed to read stdin');
  });

  test('accepts a bare signals map or a verdict document with .signals', async () => {
    const bare = cliIo(JSON.stringify({ s: { value: 1, unit: 'ms' } }));
    expect(await gateMain(['--baseline=b.json'], bare.io)).toBe(0);
    expect(bare.stdout.join('')).toContain('baseline created');

    const wrapped = cliIo(JSON.stringify({ signals: { s: { value: 2, unit: 'ms' } } }), {
      'b.json': JSON.stringify({ signals: { s: { value: 2, unit: 'ms' } } }),
    });
    expect(await gateMain(['--baseline=b.json'], wrapped.io)).toBe(0);
    expect(wrapped.stdout.join('')).toContain('profiling gate: PASS');
  });

  test('gated regression exits 1; malformed budgets exit 2', async () => {
    const gated = cliIo(JSON.stringify({ s: { value: 200, unit: 'ms' } }), {
      'b.json': JSON.stringify({ signals: { s: { value: 100, unit: 'ms' } } }),
      'g.toml': '[signals."s"]\ngate = true\n',
    });
    expect(await gateMain(['--baseline=b.json', '--budgets=g.toml'], gated.io)).toBe(1);

    const broken = cliIo(JSON.stringify({ s: 1 }), { 'g.toml': 'not toml at all' });
    expect(await gateMain(['--budgets=g.toml'], broken.io)).toBe(2);
    expect(broken.stderr.join('')).toContain('budgets parse error');
  });

  test('--update-baseline snapshots stdin signals as the new floor', async () => {
    const handle = cliIo(JSON.stringify({ s: { value: 7, unit: 'ms' } }), {
      'b.json': JSON.stringify({ signals: { s: { value: 1, unit: 'ms' } } }),
    });
    expect(await gateMain(['--baseline=b.json', '--update-baseline'], handle.io)).toBe(0);
    expect(JSON.parse(handle.writes['b.json'] ?? '').signals['s'].value).toBe(7);
  });
});
