// Unit tests for the profiling ui runner + summary view
// (bead create-harness-app-z41). Playwright is replaced by a fake CDP
// object so no browser is launched.
import { describe, expect, test } from 'vitest';
import {
  latestRunDir,
  main as summaryMain,
  // @ts-expect-error - plain ESM, no .d.ts ships with the slot.
} from '../../harness/profiling/src/summary.mjs';
import {
  captureUiMetrics,
  measureBundle,
  readCdpStream,
  main as uiMain,
  // @ts-expect-error - plain ESM, no .d.ts ships with the slot.
} from '../../harness/profiling/src/ui.mjs';
import { makeStubIo } from './helpers/profiling-io';

const ARTIFACT_FLAG = '--artifact-root=artifacts';
const EXPECTED_DIR = 'artifacts/20260611T010203Z--01010101010101010101010101010101';

interface FakePwOptions {
  gotoError?: string;
  navigation?: Record<string, number> | null;
  vitals?: Record<string, number | null>;
  traceChunks?: Array<{ data: string; base64Encoded?: boolean; eof: boolean }>;
}

function makeFakePw(options: FakePwOptions = {}) {
  const sent: Array<{ method: string; params?: unknown }> = [];
  const handlers: Record<string, (event: unknown) => void> = {};
  const navigation =
    options.navigation === undefined
      ? { responseStart: 12, domContentLoadedEventEnd: 80, loadEventEnd: 150 }
      : options.navigation;
  const vitals = options.vitals ?? { lcp: 120, cls: 0.02, inp: null };
  const chunks = options.traceChunks ?? [{ data: '{"traceEvents":[]}', eof: true }];
  let chunkIndex = 0;
  const cdp = {
    on: (event: string, cb: (e: unknown) => void) => {
      handlers[event] = cb;
    },
    send: async (method: string, params?: unknown) => {
      sent.push({ method, params });
      if (method === 'Tracing.end') {
        handlers['Tracing.tracingComplete']?.({ stream: 'stream-1' });
        return {};
      }
      if (method === 'IO.read') {
        const chunk = chunks[chunkIndex];
        chunkIndex += 1;
        return chunk;
      }
      return {};
    },
  };
  const page = {
    goto: async (url: string) => {
      sent.push({ method: `goto:${url}` });
      if (options.gotoError) {
        throw new Error(options.gotoError);
      }
    },
    evaluate: async () => ({ navigation, vitals }),
  };
  let closed = false;
  const pw = {
    chromium: {
      launch: async () => ({
        newContext: async () => ({
          newPage: async () => page,
          newCDPSession: async () => cdp,
        }),
        close: async () => {
          closed = true;
        },
      }),
    },
  };
  return { pw, sent, wasClosed: () => closed };
}

describe('profile ui helpers', () => {
  test('readCdpStream drains chunks, decodes base64, and closes the handle', async () => {
    const calls: Array<{ method: string; params?: unknown }> = [];
    const chunks = [
      { data: Buffer.from('{"a":').toString('base64'), base64Encoded: true, eof: false },
      { data: '1}', base64Encoded: false, eof: true },
    ];
    let i = 0;
    const cdp = {
      send: async (method: string, params?: unknown) => {
        calls.push({ method, params });
        if (method === 'IO.read') {
          const chunk = chunks[i];
          i += 1;
          return chunk;
        }
        return {};
      },
    };
    expect(await readCdpStream(cdp, 'h1')).toBe('{"a":1}');
    expect(calls.at(-1)).toEqual({ method: 'IO.close', params: { handle: 'h1' } });
  });

  test('measureBundle sums raw and gzip bytes for js/css assets only', () => {
    const handle = makeStubIo({
      files: {
        'dist/app.js': '12345678',
        'dist/styles/site.css': '1234',
        'dist/chunk.mjs': '12',
        'dist/notes.md': 'ignored',
      },
    });
    expect(measureBundle(handle.io, 'dist')).toEqual({ files: 3, rawBytes: 14, gzipBytes: 7 });
  });

  test('captureUiMetrics starts and drains a CDP trace around the navigation', async () => {
    const { pw, sent, wasClosed } = makeFakePw();
    const result = await captureUiMetrics(pw, 'http://h/page', { trace: true });
    expect(result.metrics.vitals.lcp).toBe(120);
    expect(result.traceJson).toBe('{"traceEvents":[]}');
    const methods = sent.map((s) => s.method);
    expect(methods).toContain('Tracing.start');
    expect(methods).toContain('goto:http://h/page');
    expect(methods.indexOf('Tracing.start')).toBeLessThan(methods.indexOf('goto:http://h/page'));
    expect(wasClosed()).toBe(true);
  });

  test('captureUiMetrics skips tracing when disabled and closes on goto failure', async () => {
    const quiet = makeFakePw();
    const result = await captureUiMetrics(quiet.pw, 'http://h/', { trace: false });
    expect(result.traceJson).toBeNull();
    expect(quiet.sent.map((s) => s.method)).not.toContain('Tracing.start');

    const failing = makeFakePw({ gotoError: 'net::ERR_CONNECTION_REFUSED' });
    await expect(captureUiMetrics(failing.pw, 'http://h/', { trace: false })).rejects.toThrow(
      'ERR_CONNECTION_REFUSED',
    );
    expect(failing.wasClosed()).toBe(true);
  });
});

describe('profile ui main', () => {
  test('prints usage and exits 64 without a url', async () => {
    const handle = makeStubIo();
    expect(await uiMain([], handle.io)).toBe(64);
    expect(handle.stderr.join('')).toContain('usage: profile ui');
  });

  test('skips cleanly when playwright is not installed', async () => {
    const handle = makeStubIo();
    (handle.io as Record<string, unknown>)['loadPlaywright'] = async () => null;
    expect(await uiMain(['--url=http://h/'], handle.io)).toBe(0);
    expect(handle.stdout.join('')).toContain('playwright-not-installed');
    expect(Object.keys(handle.writes)).toEqual([]);
  });

  test('exits 2 when the page cannot be profiled', async () => {
    const handle = makeStubIo();
    const { pw } = makeFakePw({ gotoError: 'boom' });
    (handle.io as Record<string, unknown>)['loadPlaywright'] = async () => pw;
    expect(await uiMain(['--url=http://h/', ARTIFACT_FLAG], handle.io)).toBe(2);
    expect(handle.stderr.join('')).toContain('failed to profile');
  });

  test('happy path persists navigation timing, vitals, trace, and verdict', async () => {
    const handle = makeStubIo();
    const { pw } = makeFakePw();
    (handle.io as Record<string, unknown>)['loadPlaywright'] = async () => pw;
    const code = await uiMain(
      ['--url=http://h/page', '--baseline=base.json', ARTIFACT_FLAG],
      handle.io,
    );
    expect(code).toBe(0);
    const verdict = JSON.parse(handle.writes[`${EXPECTED_DIR}/verdict.json`] ?? '');
    expect(verdict.mode).toBe('ui');
    expect(Object.keys(verdict.signals)).toEqual([
      'ui.navigation.ttfb',
      'ui.navigation.domContentLoaded',
      'ui.navigation.loadEventEnd',
      'ui.vitals.lcp',
      'ui.vitals.cls',
    ]);
    expect(handle.writes[`${EXPECTED_DIR}/trace.json`]).toBe('{"traceEvents":[]}');
    expect(handle.writes[`${EXPECTED_DIR}/navigation-timing.json`]).toContain('responseStart');
    expect(handle.writes[`${EXPECTED_DIR}/web-vitals.json`]).toContain('lcp');
    expect(verdict.artifacts).toContain('trace.json');
  });

  test('inp is included when the page produced events; nav absent drops nav signals', async () => {
    const handle = makeStubIo();
    const { pw } = makeFakePw({ navigation: null, vitals: { lcp: 90, cls: 0, inp: 48 } });
    (handle.io as Record<string, unknown>)['loadPlaywright'] = async () => pw;
    expect(await uiMain(['--url=http://h/', '--no-trace', ARTIFACT_FLAG], handle.io)).toBe(0);
    const verdict = JSON.parse(handle.writes[`${EXPECTED_DIR}/verdict.json`] ?? '');
    expect(Object.keys(verdict.signals)).toEqual([
      'ui.vitals.lcp',
      'ui.vitals.cls',
      'ui.vitals.inp',
    ]);
    expect(verdict.artifacts).not.toContain('trace.json');
  });

  test('bundle-dir adds the gzip signal; a missing dir only warns', async () => {
    const withBundle = makeStubIo({ files: { 'dist/app.js': '12345678' } });
    const fake = makeFakePw();
    (withBundle.io as Record<string, unknown>)['loadPlaywright'] = async () => fake.pw;
    expect(
      await uiMain(
        ['--url=http://h/', '--no-trace', '--bundle-dir=dist', ARTIFACT_FLAG],
        withBundle.io,
      ),
    ).toBe(0);
    const verdict = JSON.parse(withBundle.writes[`${EXPECTED_DIR}/verdict.json`] ?? '');
    expect(verdict.signals['ui.bundle.gzipBytes']).toEqual({ value: 4, unit: 'B' });
    expect(withBundle.writes[`${EXPECTED_DIR}/bundle-size.json`]).toContain('"gzipBytes": 4');

    const missing = makeStubIo();
    const fake2 = makeFakePw();
    (missing.io as Record<string, unknown>)['loadPlaywright'] = async () => fake2.pw;
    expect(
      await uiMain(
        ['--url=http://h/', '--no-trace', '--bundle-dir=nope', ARTIFACT_FLAG],
        missing.io,
      ),
    ).toBe(0);
    expect(missing.stdout.join('')).toContain('bundle dir nope not found');
  });

  test('malformed budgets exit 2; gated LCP budget breach exits 1', async () => {
    const broken = makeStubIo({ files: { 'g.toml': '!!!' } });
    const fake = makeFakePw();
    (broken.io as Record<string, unknown>)['loadPlaywright'] = async () => fake.pw;
    expect(
      await uiMain(['--url=http://h/', '--no-trace', '--budgets=g.toml', ARTIFACT_FLAG], broken.io),
    ).toBe(2);

    const gated = makeStubIo({
      files: { 'g.toml': '[signals."ui.vitals.lcp"]\nbudget = 50.0\ngate = true\n' },
    });
    const fake2 = makeFakePw();
    (gated.io as Record<string, unknown>)['loadPlaywright'] = async () => fake2.pw;
    expect(
      await uiMain(['--url=http://h/', '--no-trace', '--budgets=g.toml', ARTIFACT_FLAG], gated.io),
    ).toBe(1);
  });

  test('--update-baseline snapshots the UI floor', async () => {
    const handle = makeStubIo({
      files: {
        'base.json': JSON.stringify({ signals: { 'ui.vitals.lcp': { value: 1, unit: 'ms' } } }),
      },
    });
    const { pw } = makeFakePw();
    (handle.io as Record<string, unknown>)['loadPlaywright'] = async () => pw;
    expect(
      await uiMain(
        [
          '--url=http://h/',
          '--no-trace',
          '--baseline=base.json',
          '--update-baseline',
          ARTIFACT_FLAG,
        ],
        handle.io,
      ),
    ).toBe(0);
    expect(JSON.parse(handle.writes['base.json'] ?? '').signals['ui.vitals.lcp'].value).toBe(120);
  });
});

describe('profile summary', () => {
  const verdict = JSON.stringify({
    mode: 'api',
    capturedAt: '2026-06-11T01:02:03.456Z',
    traceId: 'abc',
    gate: {
      ok: true,
      results: [],
      summary: { evaluated: 0, failures: 0, advisories: 0, newSignals: [] },
    },
    artifacts: ['verdict.json', 'latency-summary.json'],
  });

  test('latestRunDir picks the lexicographically newest run', () => {
    const handle = makeStubIo({
      files: {
        'artifacts/20260610T000000Z--aa/verdict.json': verdict,
        'artifacts/20260611T000000Z--bb/verdict.json': verdict,
      },
    });
    expect(latestRunDir(handle.io, 'artifacts')).toBe('artifacts/20260611T000000Z--bb');
    expect(latestRunDir(makeStubIo().io, 'artifacts')).toBeNull();
  });

  test('exits 2 with no runs, a missing verdict, or malformed JSON', async () => {
    const none = makeStubIo();
    expect(await summaryMain([ARTIFACT_FLAG], none.io)).toBe(2);
    expect(none.stderr.join('')).toContain('no profile runs');

    const missing = makeStubIo({ files: { 'artifacts/run--x/other.json': '{}' } });
    expect(await summaryMain([ARTIFACT_FLAG], missing.io)).toBe(2);
    expect(missing.stderr.join('')).toContain('verdict.json not found');

    const malformed = makeStubIo({ files: { 'artifacts/run--x/verdict.json': '???' } });
    expect(await summaryMain([ARTIFACT_FLAG], malformed.io)).toBe(2);
    expect(malformed.stderr.join('')).toContain('not valid JSON');
  });

  test('prints the verdict table for the newest or an explicit run', async () => {
    const handle = makeStubIo({
      files: {
        'artifacts/20260610T000000Z--aa/verdict.json': verdict.replace('"abc"', 'null'),
        'artifacts/20260611T000000Z--bb/verdict.json': verdict,
      },
    });
    expect(await summaryMain([ARTIFACT_FLAG], handle.io)).toBe(0);
    const out = handle.stdout.join('');
    expect(out).toContain('artifacts/20260611T000000Z--bb');
    expect(out).toContain('trace: abc');
    expect(out).toContain('profiling gate: PASS');
    expect(out).toContain('artifacts: verdict.json, latency-summary.json');

    const explicit = makeStubIo({
      files: { 'artifacts/20260610T000000Z--aa/verdict.json': verdict.replace('"abc"', 'null') },
    });
    expect(await summaryMain(['artifacts/20260610T000000Z--aa', ARTIFACT_FLAG], explicit.io)).toBe(
      0,
    );
    expect(explicit.stdout.join('')).toContain('trace: n/a');
  });
});
