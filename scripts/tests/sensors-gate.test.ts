// Unit tests for harness/sensors/gate.mjs - the baseline-snapshot fitness
// gate (bead create-harness-app-n48.4).  Covers pure functions and the CLI
// main() via in-process IO stubs (no child_process spawns, no disk writes
// outside the captured-IO mocks).
import { describe, expect, test } from 'vitest';
import {
  compareBaseline,
  extractBaselineMetrics,
  main,
  renderReport,
  // @ts-expect-error - plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

function reportWith(folders: Array<{ name: string; I?: number | null; D?: number | null }>): {
  workspace: { folders: Array<{ name: string; I: number | null; D: number | null }> };
} {
  return {
    workspace: {
      folders: folders.map((f) => ({
        name: f.name,
        I: f.I === undefined ? null : f.I,
        D: f.D === undefined ? null : f.D,
      })),
    },
  };
}

describe('sensors gate - pure functions', () => {
  test('extractBaselineMetrics keeps only per-folder I/D and tolerates missing/non-numeric values', () => {
    const out = extractBaselineMetrics(
      reportWith([
        { name: 'ws_apps/a', I: 0.5, D: 0.2 },
        { name: 'ws_apps/b', I: null, D: null },
        // biome-ignore lint/suspicious/noExplicitAny: testing non-string name rejection
        { name: 42 as any, I: 0.1, D: 0.1 },
      ]),
    );
    expect(out).toEqual({
      folders: {
        'ws_apps/a': { I: 0.5, D: 0.2 },
        'ws_apps/b': { I: null, D: null },
      },
    });
  });

  test('extractBaselineMetrics tolerates a malformed report (no workspace, no folders array)', () => {
    expect(extractBaselineMetrics(null)).toEqual({ folders: {} });
    expect(extractBaselineMetrics({})).toEqual({ folders: {} });
    expect(extractBaselineMetrics({ workspace: {} })).toEqual({ folders: {} });
  });

  test('compareBaseline reports a clean PASS when no folder worsens', () => {
    const baseline = { folders: { 'ws_apps/a': { I: 0.5, D: 0.2 } } };
    const result = compareBaseline(baseline, reportWith([{ name: 'ws_apps/a', I: 0.5, D: 0.2 }]));
    expect(result.ok).toBe(true);
    expect(result.regressions).toEqual([]);
    expect(result.summary).toEqual({ comparedFolders: 1, newFolders: [], removedFolders: [] });
  });

  test('compareBaseline flags I and D regressions but tolerates EPSILON-level noise', () => {
    const baseline = {
      folders: {
        'ws_apps/a': { I: 0.5, D: 0.2 },
        'ws_apps/b': { I: 0.3, D: 0.4 },
      },
    };
    const current = reportWith([
      // a: I worsens; D unchanged
      { name: 'ws_apps/a', I: 0.7, D: 0.2 },
      // b: D worsens past EPSILON; I improves (must NOT regress)
      { name: 'ws_apps/b', I: 0.25, D: 0.6 },
    ]);
    const result = compareBaseline(baseline, current);
    expect(result.ok).toBe(false);
    expect(result.regressions).toHaveLength(2);
    const aReg = result.regressions.find((r: { folder: string }) => r.folder === 'ws_apps/a');
    const bReg = result.regressions.find((r: { folder: string }) => r.folder === 'ws_apps/b');
    expect(aReg).toMatchObject({ metric: 'I', baseline: 0.5, current: 0.7 });
    expect(aReg?.delta).toBeCloseTo(0.2);
    expect(bReg).toMatchObject({ metric: 'D', baseline: 0.4, current: 0.6 });
  });

  test('compareBaseline does not flag floating-point noise at EPSILON scale', () => {
    const baseline = { folders: { 'ws_apps/a': { I: 0.5, D: 0.5 } } };
    const current = reportWith([{ name: 'ws_apps/a', I: 0.5 + 1e-9, D: 0.5 + 1e-9 }]);
    const result = compareBaseline(baseline, current);
    expect(result.ok).toBe(true);
  });

  test('compareBaseline counts new folders without flagging them as regressions, and counts removed folders', () => {
    const baseline = { folders: { 'ws_apps/a': { I: 0.5, D: 0.2 } } };
    const current = reportWith([
      { name: 'ws_apps/a', I: 0.5, D: 0.2 },
      { name: 'ws_apps/c', I: 0.9, D: 0.9 },
    ]);
    const result = compareBaseline(baseline, current);
    expect(result.ok).toBe(true);
    expect(result.summary.newFolders).toEqual(['ws_apps/c']);
    expect(result.summary.removedFolders).toEqual([]);
  });

  test('compareBaseline skips folders missing from the current report (refactored away)', () => {
    const baseline = {
      folders: {
        'ws_apps/a': { I: 0.5, D: 0.2 },
        'ws_apps/b': { I: 0.5, D: 0.5 },
      },
    };
    const current = reportWith([{ name: 'ws_apps/a', I: 0.5, D: 0.2 }]);
    const result = compareBaseline(baseline, current);
    expect(result.ok).toBe(true);
    expect(result.summary.removedFolders).toEqual(['ws_apps/b']);
  });

  test('compareBaseline tolerates null metrics on either side (concept-undefined modules)', () => {
    const baseline = { folders: { 'ws_apps/a': { I: null, D: null } } };
    const current = reportWith([{ name: 'ws_apps/a', I: 0.5, D: 0.5 }]);
    const result = compareBaseline(baseline, current);
    expect(result.ok).toBe(true);
    const reverse = compareBaseline(
      { folders: { 'ws_apps/a': { I: 0.5, D: 0.5 } } },
      reportWith([{ name: 'ws_apps/a', I: null, D: null }]),
    );
    expect(reverse.ok).toBe(true);
  });

  test('renderReport shows PASS / FAIL + regression lines + remediation hint', () => {
    const pass = renderReport({
      ok: true,
      regressions: [],
      summary: { comparedFolders: 3, newFolders: ['ws_apps/new'], removedFolders: ['ws_apps/old'] },
    });
    expect(pass.startsWith('VERDICT: PASS sensors gate\n')).toBe(true);
    expect(pass).toContain('compared 3 folder(s); 1 new, 1 removed');
    expect(pass).toContain('new (no baseline floor yet): ws_apps/new');
    expect(pass).toContain('new-module flow:');
    expect(pass).toContain('just sensors gate --update-baseline');
    expect(pass).toContain('removed (refactored or filtered): ws_apps/old');
    expect(pass).not.toContain('regressions:');

    const fail = renderReport({
      ok: false,
      regressions: [{ folder: 'ws_apps/a', metric: 'D', baseline: 0.2, current: 0.5, delta: 0.3 }],
      summary: { comparedFolders: 1, newFolders: [], removedFolders: [] },
    });
    expect(fail.startsWith('VERDICT: FAIL sensors gate\n')).toBe(true);
    expect(fail).toContain('ws_apps/a  D: 0.200 -> 0.500');
    expect(fail).toContain('--update-baseline');
  });

  test('renderReport formats null baseline/current as em-dashes', () => {
    const text = renderReport({
      ok: false,
      regressions: [
        { folder: 'ws_apps/a', metric: 'I', baseline: null, current: null, delta: null },
      ],
      summary: { comparedFolders: 1, newFolders: [], removedFolders: [] },
    });
    expect(text).toContain('n/a -> n/a');
  });
});

describe('sensors gate - CLI main', () => {
  // Helper: build an in-memory io stub that captures stdout/stderr writes
  // and exposes a fake filesystem for the baseline file.
  function makeIo(opts: {
    stdin: string;
    files?: Record<string, string>;
    readFileThrows?: boolean;
  }) {
    const files: Record<string, string> = { ...(opts.files ?? {}) };
    const stdout: string[] = [];
    const stderr: string[] = [];
    const writes: Record<string, string> = {};
    return {
      stdout,
      stderr,
      writes,
      files,
      io: {
        read: async () => opts.stdin,
        write: (s: string) => stdout.push(s),
        writeErr: (s: string) => stderr.push(s),
        readFile: (p: string) => {
          if (opts.readFileThrows) {
            throw new Error('ENOENT');
          }
          if (!(p in files)) {
            throw new Error(`ENOENT: ${p}`);
          }
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

  test('first run with no baseline writes a snapshot and exits 0', async () => {
    const report = JSON.stringify(reportWith([{ name: 'ws_apps/a', I: 0.5, D: 0.2 }]));
    const { io, writes, stdout } = makeIo({ stdin: report });
    const code = await main([], io);
    expect(code).toBe(0);
    expect(writes['harness/sensors/baseline.json']).toBeTruthy();
    expect(stdout.join('')).toContain('baseline created');
    let written: { folders?: Record<string, { I: number; D: number }> } = {};
    try {
      written = JSON.parse(writes['harness/sensors/baseline.json'] ?? '');
    } catch (err) {
      throw new Error(`expected baseline JSON: ${(err as Error).message}`);
    }
    expect(written.folders?.['ws_apps/a']).toEqual({ I: 0.5, D: 0.2 });
  });

  test('--first-run-mode=strict fails when no baseline exists', async () => {
    const report = JSON.stringify(reportWith([{ name: 'ws_apps/a', I: 0.5, D: 0.2 }]));
    const { io, stderr } = makeIo({ stdin: report });
    const code = await main(['--first-run-mode=strict'], io);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('strict');
  });

  test('subsequent run with no regression exits 0 (PASS)', async () => {
    const baseline = JSON.stringify({ folders: { 'ws_apps/a': { I: 0.5, D: 0.2 } } });
    const report = JSON.stringify(reportWith([{ name: 'ws_apps/a', I: 0.5, D: 0.2 }]));
    const { io, stdout } = makeIo({
      stdin: report,
      files: { 'harness/sensors/baseline.json': baseline },
    });
    const code = await main([], io);
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('VERDICT: PASS sensors gate');
  });

  test('subsequent run with a regression exits 1 (FAIL) and prints the diff', async () => {
    const baseline = JSON.stringify({ folders: { 'ws_apps/a': { I: 0.2, D: 0.2 } } });
    const report = JSON.stringify(reportWith([{ name: 'ws_apps/a', I: 0.8, D: 0.2 }]));
    const { io, stdout } = makeIo({
      stdin: report,
      files: { 'harness/sensors/baseline.json': baseline },
    });
    const code = await main([], io);
    expect(code).toBe(1);
    const out = stdout.join('');
    expect(out).toContain('VERDICT: FAIL sensors gate');
    expect(out).toContain('ws_apps/a  I: 0.200 -> 0.800');
  });

  test('--update-baseline writes the current report as the new baseline and exits 0', async () => {
    const baseline = JSON.stringify({ folders: { 'ws_apps/a': { I: 0.2, D: 0.2 } } });
    const report = JSON.stringify(reportWith([{ name: 'ws_apps/a', I: 0.8, D: 0.2 }]));
    const { io, writes, stdout } = makeIo({
      stdin: report,
      files: { 'harness/sensors/baseline.json': baseline },
    });
    const code = await main(['--update-baseline'], io);
    expect(code).toBe(0);
    expect(stdout.join('')).toContain('baseline updated');
    let written: { folders?: Record<string, { I: number; D: number }> } = {};
    try {
      written = JSON.parse(writes['harness/sensors/baseline.json'] ?? '');
    } catch (err) {
      throw new Error(`expected updated JSON: ${(err as Error).message}`);
    }
    expect(written.folders?.['ws_apps/a']).toEqual({ I: 0.8, D: 0.2 });
  });

  test('--baseline=<path> overrides the default baseline path', async () => {
    const report = JSON.stringify(reportWith([{ name: 'ws_apps/a', I: 0.5, D: 0.2 }]));
    const { io, writes } = makeIo({ stdin: report });
    const code = await main(['--baseline=/tmp/custom-baseline.json'], io);
    expect(code).toBe(0);
    expect(writes['/tmp/custom-baseline.json']).toBeTruthy();
    expect(writes['harness/sensors/baseline.json']).toBeUndefined();
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
    const throwingIo = {
      ...io,
      read: async () => {
        throw new Error('stdin closed');
      },
    };
    const code = await main([], throwingIo);
    expect(code).toBe(2);
  });

  test('returns 2 when the existing baseline file is malformed JSON', async () => {
    const report = JSON.stringify(reportWith([{ name: 'ws_apps/a', I: 0.5, D: 0.2 }]));
    const { io, stderr } = makeIo({
      stdin: report,
      files: { 'harness/sensors/baseline.json': 'not-json' },
    });
    const code = await main([], io);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('failed to read baseline');
  });
});
