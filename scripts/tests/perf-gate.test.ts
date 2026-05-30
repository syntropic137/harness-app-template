// Unit tests for harness/perf/gate.mjs — the startup-time fitness gate
// (bead create-harness-app-n48.13). Covers pure functions + the CLI
// main() via in-process IO stubs (no hyperfine call, no disk writes
// outside the captured-IO mocks).
import { describe, expect, test } from 'vitest';
import {
  compareBaseline,
  extractBaselineMetrics,
  main,
  renderReport,
  // @ts-expect-error — plain ESM, no .d.ts ships with the slot.
} from '../../harness/perf/gate.mjs';

function hyperfine(
  results: Array<{ command: string; mean?: number | null; stddev?: number | null; median?: number | null }>,
): {
  results: Array<{ command: string; mean: number | null; stddev: number | null; median: number | null }>;
} {
  return {
    results: results.map((r) => ({
      command: r.command,
      mean: r.mean ?? null,
      stddev: r.stddev ?? null,
      median: r.median ?? null,
    })),
  };
}

describe('perf gate — pure functions', () => {
  test('extractBaselineMetrics keys benchmarks by command and keeps numeric stats', () => {
    const out = extractBaselineMetrics(
      hyperfine([
        { command: 'startup-cold', mean: 0.42, stddev: 0.01, median: 0.41 },
        { command: 'startup-warm', mean: 0.21, stddev: 0.005, median: 0.21 },
      ]),
    );
    expect(out).toEqual({
      benchmarks: {
        'startup-cold': { mean: 0.42, stddev: 0.01, median: 0.41 },
        'startup-warm': { mean: 0.21, stddev: 0.005, median: 0.21 },
      },
    });
  });

  test('extractBaselineMetrics skips entries without a usable command name', () => {
    const out = extractBaselineMetrics({
      results: [
        // biome-ignore lint/suspicious/noExplicitAny: testing non-string rejection
        { command: 42 as any, mean: 0.5 },
        { command: '', mean: 0.6 },
        { command: 'ok', mean: 0.7 },
      ],
    });
    expect(Object.keys(out.benchmarks)).toEqual(['ok']);
  });

  test('extractBaselineMetrics tolerates a missing/empty results array', () => {
    expect(extractBaselineMetrics(null)).toEqual({ benchmarks: {} });
    expect(extractBaselineMetrics({})).toEqual({ benchmarks: {} });
    expect(extractBaselineMetrics({ results: [] })).toEqual({ benchmarks: {} });
  });

  test('compareBaseline is a clean PASS when no benchmark exceeds the per-bench ceiling', () => {
    const baseline = { benchmarks: { 'startup-cold': { mean: 0.40 } } };
    const result = compareBaseline(baseline, hyperfine([{ command: 'startup-cold', mean: 0.41 }]));
    expect(result.ok).toBe(true);
    expect(result.regressions).toEqual([]);
    expect(result.summary).toMatchObject({
      comparedBenchmarks: 1,
      newBenchmarks: [],
      removedBenchmarks: [],
    });
  });

  test('compareBaseline FAILs when current.mean exceeds baseline.mean × (1 + tolerance)', () => {
    const baseline = { benchmarks: { 'startup-cold': { mean: 0.40 } } };
    // default tolerance 0.25 → ceiling = 0.5; 0.55 > 0.5 → regression
    const result = compareBaseline(baseline, hyperfine([{ command: 'startup-cold', mean: 0.55 }]));
    expect(result.ok).toBe(false);
    expect(result.regressions).toHaveLength(1);
    const r = result.regressions[0];
    expect(r.benchmark).toBe('startup-cold');
    expect(r.metric).toBe('mean');
    expect(r.baseline).toBe(0.40);
    expect(r.current).toBe(0.55);
    expect(r.toleranceUsed).toBe(0.25);
    expect(r.delta).toBeCloseTo(0.15);
    expect(r.deltaPct).toBeCloseTo(0.375);
    expect(r.ceiling).toBeCloseTo(0.5);
  });

  test('compareBaseline tolerates noise inside the configured tolerance', () => {
    const baseline = { benchmarks: { 'b': { mean: 0.40 } } };
    // 0.49 is below the 0.5 ceiling at tolerance 0.25
    const stillOk = compareBaseline(baseline, hyperfine([{ command: 'b', mean: 0.49 }]));
    expect(stillOk.ok).toBe(true);
  });

  test('--tolerance shrinks the ceiling and surfaces previously-tolerated regressions', () => {
    const baseline = { benchmarks: { 'b': { mean: 0.40 } } };
    const ok25 = compareBaseline(baseline, hyperfine([{ command: 'b', mean: 0.49 }]), 0.25);
    expect(ok25.ok).toBe(true);
    const fail05 = compareBaseline(baseline, hyperfine([{ command: 'b', mean: 0.49 }]), 0.05);
    expect(fail05.ok).toBe(false);
    expect(fail05.regressions[0].toleranceUsed).toBe(0.05);
  });

  test('compareBaseline ignores benchmarks where either side lacks a numeric mean', () => {
    const baseline = {
      benchmarks: {
        bench: { mean: 0.4 },
        // biome-ignore lint/suspicious/noExplicitAny: deliberately non-numeric
        broken: { mean: 'oops' as any },
      },
    };
    const cur = hyperfine([
      { command: 'bench', mean: null },
      { command: 'broken', mean: 0.5 },
    ]);
    const result = compareBaseline(baseline, cur);
    expect(result.ok).toBe(true);
    expect(result.regressions).toEqual([]);
  });

  test('new benchmarks are counted but not flagged as regressions; removed benchmarks are counted as removed', () => {
    const baseline = { benchmarks: { gone: { mean: 0.1 }, stayed: { mean: 0.2 } } };
    const cur = hyperfine([
      { command: 'stayed', mean: 0.21 },
      { command: 'fresh', mean: 99 },
    ]);
    const result = compareBaseline(baseline, cur);
    expect(result.ok).toBe(true);
    expect(result.summary.newBenchmarks).toEqual(['fresh']);
    expect(result.summary.removedBenchmarks).toEqual(['gone']);
  });

  test('renderReport shows PASS/FAIL + regression lines + remediation hint', () => {
    const pass = renderReport({
      ok: true,
      regressions: [],
      summary: { comparedBenchmarks: 2, newBenchmarks: ['z'], removedBenchmarks: ['old'], tolerance: 0.25 },
    });
    expect(pass).toContain('PASS');
    expect(pass).toContain('compared 2 benchmark(s) at tolerance 25.0%');
    expect(pass).toContain('new: z');
    expect(pass).toContain('removed: old');
    expect(pass).not.toContain('regressions:');

    const fail = renderReport({
      ok: false,
      regressions: [
        { benchmark: 'b', metric: 'mean', baseline: 0.4, current: 0.55, ceiling: 0.5, toleranceUsed: 0.25, delta: 0.15, deltaPct: 0.375 },
      ],
      summary: { comparedBenchmarks: 1, newBenchmarks: [], removedBenchmarks: [], tolerance: 0.25 },
    });
    expect(fail).toContain('FAIL');
    expect(fail).toContain('b  mean: 0.400s → 0.550s  (+37.5%)  ceiling=0.500s');
    expect(fail).toContain('--update-baseline');
  });

  test('renderReport renders em-dashes for null baseline/current values', () => {
    const out = renderReport({
      ok: false,
      regressions: [
        { benchmark: 'b', metric: 'mean', baseline: null, current: null, ceiling: null, toleranceUsed: 0.25, delta: null, deltaPct: null },
      ],
      summary: { comparedBenchmarks: 1, newBenchmarks: [], removedBenchmarks: [], tolerance: 0.25 },
    });
    expect(out).toContain('— → —');
  });
});

describe('perf gate — CLI main', () => {
  function makeIo(opts: { stdin: string; files?: Record<string, string> }) {
    const files: Record<string, string> = { ...(opts.files ?? {}) };
    const stdout: string[] = [];
    const stderr: string[] = [];
    const writes: Record<string, string> = {};
    return {
      stdout,
      stderr,
      writes,
      io: {
        read: async () => opts.stdin,
        write: (s: string) => stdout.push(s),
        writeErr: (s: string) => stderr.push(s),
        readFile: (p: string) => {
          if (!(p in files)) throw new Error(`ENOENT: ${p}`);
          return files[p] as string;
        },
        writeFile: (p: string, s: string) => {
          writes[p] = s;
          files[p] = s;
        },
        fileExists: (p: string) => p in files,
      },
    };
  }

  test('first run writes a baseline snapshot and exits 0', async () => {
    const stdin = JSON.stringify(hyperfine([{ command: 'b', mean: 0.4 }]));
    const { io, writes, stdout } = makeIo({ stdin });
    const code = await main([], io);
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('baseline created');
    let written: { benchmarks?: Record<string, { mean: number }> } = {};
    try {
      written = JSON.parse(writes['harness/perf/baseline.json'] ?? '');
    } catch (err) {
      throw new Error(`expected baseline JSON: ${(err as Error).message}`);
    }
    expect(written.benchmarks?.['b']).toMatchObject({ mean: 0.4 });
  });

  test('--first-run-mode=strict fails when no baseline exists', async () => {
    const stdin = JSON.stringify(hyperfine([{ command: 'b', mean: 0.4 }]));
    const { io, stderr } = makeIo({ stdin });
    const code = await main(['--first-run-mode=strict'], io);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('strict');
  });

  test('subsequent clean run returns 0 (PASS)', async () => {
    const baseline = JSON.stringify({ benchmarks: { b: { mean: 0.4 } } });
    const stdin = JSON.stringify(hyperfine([{ command: 'b', mean: 0.42 }]));
    const { io, stdout } = makeIo({ stdin, files: { 'harness/perf/baseline.json': baseline } });
    const code = await main([], io);
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('PASS');
  });

  test('subsequent regression returns 1 (FAIL) with diff in stdout', async () => {
    const baseline = JSON.stringify({ benchmarks: { b: { mean: 0.4 } } });
    const stdin = JSON.stringify(hyperfine([{ command: 'b', mean: 0.6 }]));
    const { io, stdout } = makeIo({ stdin, files: { 'harness/perf/baseline.json': baseline } });
    const code = await main([], io);
    expect(code).toBe(1);
    expect(stdout.join('')).toContain('FAIL');
    expect(stdout.join('')).toContain('0.400s → 0.600s');
  });

  test('--update-baseline writes the current run as the new floor', async () => {
    const baseline = JSON.stringify({ benchmarks: { b: { mean: 0.4 } } });
    const stdin = JSON.stringify(hyperfine([{ command: 'b', mean: 0.6 }]));
    const { io, writes, stdout } = makeIo({ stdin, files: { 'harness/perf/baseline.json': baseline } });
    const code = await main(['--update-baseline'], io);
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('baseline updated');
    let written: { benchmarks?: Record<string, { mean: number }> } = {};
    try {
      written = JSON.parse(writes['harness/perf/baseline.json'] ?? '');
    } catch (err) {
      throw new Error(`expected updated JSON: ${(err as Error).message}`);
    }
    expect(written.benchmarks?.['b']).toMatchObject({ mean: 0.6 });
  });

  test('--baseline=<path> overrides the default baseline path', async () => {
    const stdin = JSON.stringify(hyperfine([{ command: 'b', mean: 0.4 }]));
    const { io, writes } = makeIo({ stdin });
    const code = await main(['--baseline=/tmp/perf-baseline.json'], io);
    expect(code).toBe(0);
    expect(writes['/tmp/perf-baseline.json']).toBeTruthy();
    expect(writes['harness/perf/baseline.json']).toBeUndefined();
  });

  test('--tolerance=<float> changes the per-benchmark ceiling', async () => {
    const baseline = JSON.stringify({ benchmarks: { b: { mean: 0.40 } } });
    // mean 0.49, baseline 0.40 → 22.5% delta. Pass at 0.25, fail at 0.10.
    const stdin = JSON.stringify(hyperfine([{ command: 'b', mean: 0.49 }]));
    const pass = makeIo({ stdin, files: { 'harness/perf/baseline.json': baseline } });
    expect(await main(['--tolerance=0.25'], pass.io)).toBe(0);
    const fail = makeIo({ stdin, files: { 'harness/perf/baseline.json': baseline } });
    expect(await main(['--tolerance=0.10'], fail.io)).toBe(1);
  });

  test('returns 2 on empty stdin', async () => {
    const { io, stderr } = makeIo({ stdin: '   ' });
    const code = await main([], io);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('empty stdin');
  });

  test('returns 2 on non-JSON stdin', async () => {
    const { io, stderr } = makeIo({ stdin: 'not json' });
    const code = await main([], io);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('not valid JSON');
  });

  test('returns 2 when the stdin read itself throws', async () => {
    const { io } = makeIo({ stdin: '' });
    const throwing = {
      ...io,
      read: async () => {
        throw new Error('stdin closed');
      },
    };
    const code = await main([], throwing);
    expect(code).toBe(2);
  });

  test('returns 2 on malformed existing baseline file', async () => {
    const stdin = JSON.stringify(hyperfine([{ command: 'b', mean: 0.4 }]));
    const { io, stderr } = makeIo({
      stdin,
      files: { 'harness/perf/baseline.json': 'not-json' },
    });
    const code = await main([], io);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('failed to read baseline');
  });

  test('ignores --tolerance values that are negative or non-numeric, keeping the default', async () => {
    const baseline = JSON.stringify({ benchmarks: { b: { mean: 0.40 } } });
    // mean 0.49 with default 0.25 → PASS. If --tolerance=oops were applied,
    // the default would override; if --tolerance=-0.5 silently took effect
    // the ceiling would shrink and the test would FAIL.
    const stdin = JSON.stringify(hyperfine([{ command: 'b', mean: 0.49 }]));
    for (const arg of ['--tolerance=oops', '--tolerance=-0.5']) {
      const { io } = makeIo({ stdin, files: { 'harness/perf/baseline.json': baseline } });
      expect(await main([arg], io)).toBe(0);
    }
  });
});
