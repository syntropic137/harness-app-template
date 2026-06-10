// Unit tests for the profiling startup + api runners
// (bead create-harness-app-z41). All IO is stubbed in-memory; no bench,
// server, or VictoriaMetrics is touched.
import { describe, expect, test } from 'vitest';
import {
  main as apiMain,
  collectCpuProfiles,
  queryVmQuantiles,
  runLoad,
  // @ts-expect-error - plain ESM, no .d.ts ships with the slot.
} from '../../harness/profiling/src/api.mjs';
import {
  hyperfineToSignals,
  main as startupMain,
  // @ts-expect-error - plain ESM, no .d.ts ships with the slot.
} from '../../harness/profiling/src/startup.mjs';
import { makeStubIo, type StubFetch } from './helpers/profiling-io';

const ARTIFACT_FLAG = '--artifact-root=artifacts';
const EXPECTED_DIR = 'artifacts/20260611T010203Z--01010101010101010101010101010101';

function hyperfineDoc(mean = 0.4) {
  return JSON.stringify({ results: [{ command: 'example-typescript-start', mean }] });
}

describe('profile startup', () => {
  test('hyperfineToSignals converts benchmarks and skips unusable rows', () => {
    expect(
      hyperfineToSignals({
        results: [
          { command: 'a', mean: 0.5 },
          { command: '', mean: 0.6 },
          { command: 'no-mean' },
          { mean: 0.7 },
        ],
      }),
    ).toEqual({ 'startup.a.mean': { value: 0.5, unit: 's' } });
    expect(hyperfineToSignals(null)).toEqual({});
  });

  test('bench failure, non-JSON output, and empty results all exit 2', async () => {
    const failing = makeStubIo();
    (failing.io as Record<string, unknown>)['runBench'] = () => ({ status: 1, stdout: '' });
    expect(await startupMain([], failing.io)).toBe(2);
    expect(failing.stderr.join('')).toContain('exited 1');

    const garbled = makeStubIo();
    (garbled.io as Record<string, unknown>)['runBench'] = () => ({ status: 0, stdout: 'nope' });
    expect(await startupMain([], garbled.io)).toBe(2);
    expect(garbled.stderr.join('')).toContain('not valid JSON');

    const empty = makeStubIo();
    (empty.io as Record<string, unknown>)['runBench'] = () => ({
      status: 0,
      stdout: JSON.stringify({ results: [] }),
    });
    expect(await startupMain([], empty.io)).toBe(2);
    expect(empty.stderr.join('')).toContain('no usable benchmarks');
  });

  test('skips cleanly on the bench unavailable sentinel', async () => {
    const handle = makeStubIo();
    (handle.io as Record<string, unknown>)['runBench'] = () => ({
      status: 0,
      stdout: JSON.stringify({ results: [], available: false, reason: 'hyperfine-not-installed' }),
    });
    expect(await startupMain([], handle.io)).toBe(0);
    expect(handle.stdout.join('')).toContain('skipped (hyperfine-not-installed)');
    expect(Object.keys(handle.writes)).toEqual([]);

    const reasonless = makeStubIo();
    (reasonless.io as Record<string, unknown>)['runBench'] = () => ({
      status: 0,
      stdout: JSON.stringify({ results: [], available: false }),
    });
    expect(await startupMain([], reasonless.io)).toBe(0);
    expect(reasonless.stdout.join('')).toContain('bench unavailable');
  });

  test('happy path: first run snapshots baseline and persists artifacts', async () => {
    const handle = makeStubIo();
    const benchPaths: string[] = [];
    (handle.io as Record<string, unknown>)['runBench'] = (path: string) => {
      benchPaths.push(path);
      return { status: 0, stdout: hyperfineDoc() };
    };
    const code = await startupMain(['--baseline=base.json', ARTIFACT_FLAG], handle.io);
    expect(code).toBe(0);
    expect(benchPaths).toEqual(['harness/perf/bench.sh']);
    expect(handle.stdout.join('')).toContain('baseline created at base.json');
    expect(handle.stdout.join('')).toContain(`artifacts at ${EXPECTED_DIR}`);
    const verdict = JSON.parse(handle.writes[`${EXPECTED_DIR}/verdict.json`] ?? '');
    expect(verdict.mode).toBe('startup');
    expect(verdict.signals['startup.example-typescript-start.mean']).toEqual({
      value: 0.4,
      unit: 's',
    });
    expect(handle.writes[`${EXPECTED_DIR}/hyperfine.json`]).toBeTruthy();
  });

  test('gated regression exits 1; malformed budgets exit 2; --bench overrides', async () => {
    const files = {
      'base.json': JSON.stringify({
        signals: { 'startup.example-typescript-start.mean': { value: 0.2, unit: 's' } },
      }),
      'g.toml': '[signals."startup.example-typescript-start.mean"]\ngate = true\n',
    };
    const gated = makeStubIo({ files });
    (gated.io as Record<string, unknown>)['runBench'] = () => ({
      status: 0,
      stdout: hyperfineDoc(0.4),
    });
    expect(
      await startupMain(
        ['--baseline=base.json', '--budgets=g.toml', '--bench=custom/bench.sh', ARTIFACT_FLAG],
        gated.io,
      ),
    ).toBe(1);

    const broken = makeStubIo({ files: { 'g.toml': '???' } });
    (broken.io as Record<string, unknown>)['runBench'] = () => ({
      status: 0,
      stdout: hyperfineDoc(),
    });
    expect(await startupMain(['--budgets=g.toml', ARTIFACT_FLAG], broken.io)).toBe(2);
    expect(broken.stderr.join('')).toContain('budgets parse error');
  });

  test('--update-baseline moves the floor and exits 0', async () => {
    const handle = makeStubIo({
      files: {
        'base.json': JSON.stringify({
          signals: { 'startup.example-typescript-start.mean': { value: 0.1, unit: 's' } },
        }),
      },
    });
    (handle.io as Record<string, unknown>)['runBench'] = () => ({
      status: 0,
      stdout: hyperfineDoc(0.9),
    });
    expect(
      await startupMain(['--baseline=base.json', '--update-baseline', ARTIFACT_FLAG], handle.io),
    ).toBe(0);
    expect(
      JSON.parse(handle.writes['base.json'] ?? '').signals['startup.example-typescript-start.mean']
        .value,
    ).toBe(0.9);
  });
});

describe('profile api helpers', () => {
  test('runLoad sends traceparent per request and counts failures', async () => {
    const responses: StubFetch = async (url) =>
      url.endsWith('/fail') ? { ok: false, status: 500 } : { ok: true };
    const handle = makeStubIo({ fetch: responses });
    const ok = await runLoad(handle.io, 'http://h/ok', {
      requests: 3,
      concurrency: 2,
      traceId: 'a'.repeat(32),
    });
    expect(ok.latencies).toHaveLength(3);
    expect(ok.errors).toBe(0);
    expect(ok.spanIds).toHaveLength(3);
    for (const call of handle.fetchCalls) {
      expect(call.headers['traceparent']).toMatch(
        new RegExp(`^00-${'a'.repeat(32)}-[0-9a-f]{16}-01$`),
      );
    }

    const failing = makeStubIo({ fetch: responses });
    const bad = await runLoad(failing.io, 'http://h/fail', {
      requests: 2,
      concurrency: 1,
      traceId: 'b'.repeat(32),
    });
    expect(bad.latencies).toHaveLength(0);
    expect(bad.errors).toBe(2);

    const throwing = makeStubIo({
      fetch: async () => {
        throw new Error('refused');
      },
    });
    const crashed = await runLoad(throwing.io, 'http://h/x', {
      requests: 2,
      concurrency: 1,
      traceId: 'c'.repeat(32),
    });
    expect(crashed.errors).toBe(2);
  });

  test('queryVmQuantiles snapshots three quantiles and tolerates failure', async () => {
    const seen: string[] = [];
    const handle = makeStubIo({
      fetch: async (url) => {
        seen.push(url);
        return { ok: true, json: async () => ({ status: 'success' }) };
      },
    });
    const out = await queryVmQuantiles(
      handle.io,
      'http://vm:8428/',
      'http_server_duration_milliseconds_bucket',
    );
    expect(Object.keys(out)).toEqual(['p50', 'p95', 'p99']);
    expect(seen[0]).toContain('http://vm:8428/api/v1/query?query=');
    expect(seen[0]).toContain(encodeURIComponent('histogram_quantile(0.5'));

    const upset = makeStubIo({ fetch: async () => ({ ok: false, status: 503 }) });
    const degraded = await queryVmQuantiles(upset.io, 'http://vm', 'm');
    expect(degraded['p50']).toEqual({ error: 503 });

    const dead = makeStubIo({
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(await queryVmQuantiles(dead.io, 'http://vm', 'm')).toEqual({ error: 'ECONNREFUSED' });
  });

  test('collectCpuProfiles copies *.cpuprofile into the artifact dir', () => {
    const handle = makeStubIo({
      files: {
        'prof/a.cpuprofile': '{}',
        'prof/sub/b.cpuprofile': '{}',
        'prof/readme.txt': 'no',
      },
    });
    expect(collectCpuProfiles(handle.io, 'prof', 'out')).toEqual(['a.cpuprofile', 'b.cpuprofile']);
    expect(handle.writes['out/a.cpuprofile']).toBe('{}');
    expect(collectCpuProfiles(handle.io, 'missing', 'out')).toEqual([]);
  });
});

describe('profile api main', () => {
  test('prints usage and exits 64 without a url', async () => {
    const handle = makeStubIo();
    expect(await apiMain([], handle.io)).toBe(64);
    expect(handle.stderr.join('')).toContain('usage: profile api');
  });

  test('exits 2 when every request fails', async () => {
    const handle = makeStubIo({ fetch: async () => ({ ok: false, status: 500 }) });
    expect(
      await apiMain(['--url=http://h/', '--requests=3', '--warmup=0', ARTIFACT_FLAG], handle.io),
    ).toBe(2);
    expect(handle.stderr.join('')).toContain('all 3 request(s)');
  });

  test('happy path persists latency summary, trace correlation, and verdict', async () => {
    const handle = makeStubIo();
    const code = await apiMain(
      [
        '--url=http://h/api',
        '--requests=4',
        '--concurrency=1',
        '--warmup=0',
        '--baseline=base.json',
        ARTIFACT_FLAG,
      ],
      handle.io,
    );
    expect(code).toBe(0);
    const summary = JSON.parse(handle.writes[`${EXPECTED_DIR}/latency-summary.json`] ?? '');
    expect(summary).toMatchObject({ url: 'http://h/api', requests: 4, errors: 0 });
    expect(summary.stats.p50).toBeGreaterThan(0);
    const correlation = JSON.parse(handle.writes[`${EXPECTED_DIR}/trace-correlation.json`] ?? '');
    expect(correlation.traceId).toBe('01'.repeat(16));
    expect(correlation.spanIdSample.length).toBeGreaterThan(0);
    const verdict = JSON.parse(handle.writes[`${EXPECTED_DIR}/verdict.json`] ?? '');
    expect(verdict.mode).toBe('api');
    expect(Object.keys(verdict.signals)).toEqual([
      'api.latency.p50',
      'api.latency.p95',
      'api.latency.p99',
      'api.latency.mean',
      'api.throughput.rps',
      'api.errors.count',
    ]);
    expect(handle.stdout.join('')).toContain(`artifacts at ${EXPECTED_DIR}`);
  });

  test('positional url and default warmup are accepted', async () => {
    const handle = makeStubIo();
    expect(
      await apiMain(['http://h/', '--requests=2', '--concurrency=1', ARTIFACT_FLAG], handle.io),
    ).toBe(0);
    // default warmup 5 + 2 measured requests
    expect(handle.fetchCalls).toHaveLength(7);
  });

  test('vm-url snapshot and cpu-prof collection land in the artifact dir', async () => {
    const handle = makeStubIo({
      files: { 'prof/run.cpuprofile': '{"nodes":[]}' },
      fetch: async (url) =>
        url.includes('/api/v1/query')
          ? { ok: true, json: async () => ({ status: 'success' }) }
          : { ok: true },
    });
    const code = await apiMain(
      [
        '--url=http://h/',
        '--requests=2',
        '--concurrency=1',
        '--warmup=0',
        '--vm-url=http://vm:8428',
        '--cpu-prof-dir=prof',
        ARTIFACT_FLAG,
      ],
      handle.io,
    );
    expect(code).toBe(0);
    expect(handle.writes[`${EXPECTED_DIR}/vm-quantiles.json`]).toContain('http_server_duration');
    expect(handle.writes[`${EXPECTED_DIR}/run.cpuprofile`]).toBe('{"nodes":[]}');
    const verdict = JSON.parse(handle.writes[`${EXPECTED_DIR}/verdict.json`] ?? '');
    expect(verdict.artifacts).toContain('vm-quantiles.json');
    expect(verdict.artifacts).toContain('run.cpuprofile');
  });

  test('empty cpu-prof dir prints the node --cpu-prof hint', async () => {
    const handle = makeStubIo({ files: { 'prof/keep.txt': '' } });
    expect(
      await apiMain(
        [
          '--url=http://h/',
          '--requests=1',
          '--concurrency=1',
          '--warmup=0',
          '--cpu-prof-dir=prof',
          ARTIFACT_FLAG,
        ],
        handle.io,
      ),
    ).toBe(0);
    expect(handle.stdout.join('')).toContain('node --cpu-prof');
  });

  test('malformed budgets exit 2; gated budget breach exits 1', async () => {
    const broken = makeStubIo({ files: { 'g.toml': '!!!' } });
    expect(
      await apiMain(
        ['--url=http://h/', '--requests=1', '--warmup=0', '--budgets=g.toml', ARTIFACT_FLAG],
        broken.io,
      ),
    ).toBe(2);

    const gated = makeStubIo({
      files: { 'g.toml': '[signals."api.errors.count"]\nbudget = 0.5\n' },
      fetch: async (url) => ({ ok: !url.includes('fail') }),
    });
    // 2 requests, one to a failing path is not possible with one url; use
    // errors budget of 0.5 with zero errors -> passes; then latency budget.
    const latencyGated = makeStubIo({
      files: { 'lat.toml': '[signals."api.latency.p99"]\nbudget = 0.001\n' },
    });
    expect(
      await apiMain(
        [
          '--url=http://h/',
          '--requests=2',
          '--concurrency=1',
          '--warmup=0',
          '--budgets=lat.toml',
          ARTIFACT_FLAG,
        ],
        latencyGated.io,
      ),
    ).toBe(1);
    expect(
      await apiMain(
        ['--url=http://h/', '--requests=1', '--warmup=0', '--budgets=g.toml', ARTIFACT_FLAG],
        gated.io,
      ),
    ).toBe(0);
  });

  test('--update-baseline snapshots current readings', async () => {
    const handle = makeStubIo({
      files: {
        'base.json': JSON.stringify({
          signals: { 'api.latency.p50': { value: 0.001, unit: 'ms' } },
        }),
      },
    });
    expect(
      await apiMain(
        [
          '--url=http://h/',
          '--requests=1',
          '--warmup=0',
          '--baseline=base.json',
          '--update-baseline',
          ARTIFACT_FLAG,
        ],
        handle.io,
      ),
    ).toBe(0);
    const written = JSON.parse(handle.writes['base.json'] ?? '');
    expect(written.signals['api.latency.p50'].value).toBeGreaterThan(0.001);
  });
});
