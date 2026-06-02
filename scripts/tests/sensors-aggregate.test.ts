// Unit tests for harness/sensors/aggregate.mjs.  The aggregator is plain
// Node ESM so it can ship inside the slot directory without pulling the
// scripts/ coverage gate over it.  These tests cover the pure functions
// (de-dup, scope-filter, aggregate, renderMarkdown) and the CLI entry
// (`main`) via in-process IO stubs — no child_process spawns.
import { describe, expect, test } from 'vitest';
import {
  aggregate,
  countCircularEdges,
  dedupeModules,
  distanceFromMainSequence,
  isWorkspaceName,
  main,
  mergeAbstractness,
  renderMarkdown,
  scopeFolders,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/aggregate.mjs';

describe('sensors aggregate — pure functions', () => {
  test('isWorkspaceName accepts only ws_apps / ws_packages paths', () => {
    expect(isWorkspaceName('ws_apps/foo/main.ts')).toBe(true);
    expect(isWorkspaceName('ws_packages/lib/index.ts')).toBe(true);
    expect(isWorkspaceName('node_modules/vitest/dist/index.js')).toBe(false);
    expect(isWorkspaceName('@opentelemetry/api')).toBe(false);
    expect(isWorkspaceName('child_process')).toBe(false);
    expect(isWorkspaceName('')).toBe(false);
    // biome-ignore lint/suspicious/noExplicitAny: testing non-string input rejection
    expect(isWorkspaceName(undefined as any)).toBe(false);
    // Nested vendor / generated segments are also excluded (a workspace
    // app's own node_modules / dist / build / out / .next / coverage).
    expect(isWorkspaceName('ws_apps/docs/node_modules/@types/node')).toBe(false);
    expect(isWorkspaceName('ws_apps/docs/dist/index.js')).toBe(false);
    expect(isWorkspaceName('ws_apps/docs/.next/static/chunks/main.js')).toBe(false);
    expect(isWorkspaceName('ws_apps/coverage')).toBe(false);
  });

  test('dedupeModules merges duplicate source entries and recomputes I', () => {
    // Mirrors the telemetry.ts quirk seen in the 2026-05-30 experiment:
    // the same source emitted twice with different graph views.
    const input = [
      { source: 'ws_apps/a/src/telemetry.ts', dependents: [{ name: 'ws_apps/a/src/main.ts' }], dependencies: [] },
      {
        source: 'ws_apps/a/src/telemetry.ts',
        dependents: [{ name: 'ws_apps/a/tests/main.test.ts' }],
        dependencies: [{ resolved: '@opentelemetry/sdk-node' }, { module: '@opentelemetry/api' }],
      },
      { source: 'ws_apps/a/src/main.ts', dependents: [], dependencies: [{ resolved: 'ws_apps/a/src/telemetry.ts' }] },
    ];
    const out = dedupeModules(input);
    expect(out).toHaveLength(2);
    const telem = out.find((m) => m.source === 'ws_apps/a/src/telemetry.ts');
    const main = out.find((m) => m.source === 'ws_apps/a/src/main.ts');
    expect(telem).toBeDefined();
    expect(telem?.Ca).toBe(2); // merged dependents
    expect(telem?.Ce).toBe(2); // merged dependencies
    expect(telem?.I).toBeCloseTo(0.5);
    expect(telem?.dependents).toEqual(['ws_apps/a/src/main.ts', 'ws_apps/a/tests/main.test.ts']);
    expect(main?.Ca).toBe(0);
    expect(main?.Ce).toBe(1);
    expect(main?.I).toBe(1);
  });

  test('dedupeModules skips entries without a string source and accepts string dependents', () => {
    const out = dedupeModules([
      { source: null, dependents: [], dependencies: [] },
      { source: 'ws_apps/x.ts', dependents: ['ws_apps/y.ts'], dependencies: [{}] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.source).toBe('ws_apps/x.ts');
    expect(out[0]?.Ca).toBe(1);
    // The empty-object dependency has no resolved/module/name, so it's dropped.
    expect(out[0]?.Ce).toBe(0);
    expect(out[0]?.I).toBe(0);
  });

  test('dedupeModules tolerates modules with no dependents/dependencies arrays at all', () => {
    const out = dedupeModules([{ source: 'ws_apps/empty.ts' }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.Ca).toBe(0);
    expect(out[0]?.Ce).toBe(0);
    expect(out[0]?.I).toBeNull();
  });

  test('scopeFolders filters non-workspace folders and normalizes metrics', () => {
    const folders = [
      { name: 'node_modules/vitest/dist', moduleCount: 49, afferentCouplings: 2, efferentCouplings: 15, instability: 0.88 },
      { name: 'ws_apps/example-typescript/src', moduleCount: 3, afferentCouplings: 3, efferentCouplings: 3, instability: 0.5 },
      { name: 'ws_apps/empty', moduleCount: 0, afferentCouplings: 0, efferentCouplings: 0 },
      { name: 'ws_packages/lib' /* missing counts */ },
    ];
    const out = scopeFolders(folders);
    expect(out.map((f) => f.name)).toEqual(['ws_apps/empty', 'ws_apps/example-typescript/src', 'ws_packages/lib']);
    expect(out[1]).toMatchObject({ moduleCount: 3, Ca: 3, Ce: 3, I: 0.5 });
    expect(out[0]?.I).toBeNull();
    // Missing-counts folder defaults to zeros.
    expect(out[2]).toMatchObject({ moduleCount: 0, Ca: 0, Ce: 0, I: null });
  });

  test('countCircularEdges sums every dependency edge flagged circular by dependency-cruiser, scoped to workspace sources', () => {
    // Two workspace modules in a cycle, one vendor module that should be ignored.
    const cycle = countCircularEdges([
      {
        source: 'ws_apps/a/x.ts',
        dependencies: [{ resolved: 'ws_apps/a/y.ts', circular: true }],
      },
      {
        source: 'ws_apps/a/y.ts',
        dependencies: [{ resolved: 'ws_apps/a/x.ts', circular: true }],
      },
      {
        source: 'node_modules/foo/index.js',
        dependencies: [{ resolved: 'node_modules/foo/util.js', circular: true }],
      },
    ]);
    expect(cycle).toBe(2);
  });

  test('countCircularEdges returns 0 when there are no cycles or no modules', () => {
    expect(countCircularEdges([])).toBe(0);
    // biome-ignore lint/suspicious/noExplicitAny: testing non-array input
    expect(countCircularEdges(null as any)).toBe(0);
    expect(
      countCircularEdges([
        {
          source: 'ws_apps/a/x.ts',
          dependencies: [{ resolved: 'ws_apps/a/y.ts', circular: false }],
        },
      ]),
    ).toBe(0);
  });

  test('countCircularEdges tolerates modules with missing dependencies array', () => {
    expect(countCircularEdges([{ source: 'ws_apps/a/x.ts' }])).toBe(0);
  });
});

describe('sensors aggregate — top-level aggregator', () => {
  test('aggregate produces a report with raw + workspace sections and distribution', () => {
    const cruiser = {
      summary: { totalCruised: 4, totalDependenciesCruised: 3 },
      modules: [
        { source: 'ws_apps/a/main.ts', dependents: [], dependencies: [{ resolved: 'ws_apps/a/lib.ts' }] },
        { source: 'ws_apps/a/lib.ts', dependents: [{ name: 'ws_apps/a/main.ts' }], dependencies: [] },
        { source: 'ws_apps/a/lib.ts', dependents: [{ name: 'ws_apps/a/main.ts' }], dependencies: [] },
        { source: 'node_modules/vitest/index.js', dependents: [], dependencies: [] },
      ],
      folders: [
        { name: 'ws_apps/a', moduleCount: 2, afferentCouplings: 0, efferentCouplings: 0 },
        { name: 'node_modules', moduleCount: 1, afferentCouplings: 0, efferentCouplings: 0 },
      ],
    };
    const report = aggregate(cruiser);
    expect(report.tool).toBe('dependency-cruiser');
    expect(report.raw.modulesBeforeDedupe).toBe(4);
    expect(report.raw.modulesAfterDedupe).toBe(3);
    expect(report.workspace.modules.map((m: { source: string }) => m.source)).toEqual([
      'ws_apps/a/lib.ts',
      'ws_apps/a/main.ts',
    ]);
    expect(report.workspace.folders.map((f: { name: string }) => f.name)).toEqual(['ws_apps/a']);
    expect(report.workspace.distribution.count).toBe(2);
    expect(report.workspace.distribution.definedI).toBe(2);
    expect(report.workspace.distribution.min).toBe(0);
    expect(report.workspace.distribution.max).toBe(1);
    expect(report.workspace.distribution.stable).toBe(1);
    expect(report.workspace.distribution.unstable).toBe(1);
  });

  test('aggregate handles a malformed cruiser object (no arrays, no summary)', () => {
    const report = aggregate({});
    expect(report.raw.totalCruised).toBe(0);
    expect(report.workspace.modules).toEqual([]);
    expect(report.workspace.folders).toEqual([]);
    expect(report.workspace.distribution.definedI).toBe(0);
    expect(report.workspace.distribution.min).toBeNull();
  });

  test('renderMarkdown returns a human-readable report, including empty-distribution path', () => {
    const populated = renderMarkdown(
      aggregate({
        summary: { totalCruised: 1, totalDependenciesCruised: 1 },
        modules: [
          { source: 'ws_apps/a/main.ts', dependents: [{ name: 'ws_apps/a/lib.ts' }], dependencies: [] },
        ],
        folders: [{ name: 'ws_apps/a', moduleCount: 1, afferentCouplings: 1, efferentCouplings: 1, instability: 0.5 }],
      }),
    );
    expect(populated).toContain('# Workspace architecture metrics');
    expect(populated).toContain('| `ws_apps/a` | 1 | 1 | 1 | 0.500 |');
    expect(populated).toContain('| `ws_apps/a/main.ts` |');
    expect(populated).toContain('stable (I ≤ 0.2)');
    const empty = renderMarkdown(aggregate({}));
    expect(empty).toContain('_No modules with a defined I value._');
  });
});

describe('sensors aggregate — CLI main', () => {
  test('main parses JSON from stdin and writes JSON to stdout when no --format=md', async () => {
    const writes: string[] = [];
    const code = await main([], {
      read: async () => JSON.stringify({ modules: [], folders: [] }),
      write: (s: string) => writes.push(s),
    });
    expect(code).toBe(0);
    expect(writes).toHaveLength(1);
    // Parse defensively so a regression in the JSON shape surfaces as a
    // clear assertion failure instead of a SyntaxError.
    let parsed: { tool?: string } = {};
    try {
      parsed = JSON.parse(writes[0] ?? '');
    } catch (err) {
      throw new Error(`main did not write valid JSON: ${(err as Error).message}`);
    }
    expect(parsed.tool).toBe('dependency-cruiser');
  });

  test('main writes markdown when --format=md is passed', async () => {
    const writes: string[] = [];
    const code = await main(['--format=md'], {
      read: async () => '{"modules": [], "folders": []}',
      write: (s: string) => writes.push(s),
    });
    expect(code).toBe(0);
    expect(writes[0]).toContain('# Workspace architecture metrics');
  });

  test('main also accepts the --md shorthand', async () => {
    const writes: string[] = [];
    const code = await main(['--md'], {
      read: async () => '{"modules": [], "folders": []}',
      write: (s: string) => writes.push(s),
    });
    expect(code).toBe(0);
    expect(writes[0]).toContain('# Workspace architecture metrics');
  });

  test('main returns exit code 2 on empty stdin', async () => {
    const writes: string[] = [];
    const code = await main([], {
      read: async () => '   ',
      write: (s: string) => writes.push(s),
    });
    expect(code).toBe(2);
    expect(writes).toEqual([]);
  });

  test('main returns exit code 2 when stdin is not valid JSON', async () => {
    const writes: string[] = [];
    const code = await main([], {
      read: async () => 'this is not json',
      write: (s: string) => writes.push(s),
    });
    expect(code).toBe(2);
    expect(writes).toEqual([]);
  });

  test('main returns exit code 2 when stdin read itself throws', async () => {
    const writes: string[] = [];
    const code = await main([], {
      read: async () => {
        throw new Error('stdin closed');
      },
      write: (s: string) => writes.push(s),
    });
    expect(code).toBe(2);
    expect(writes).toEqual([]);
  });
});

describe('sensors aggregate — abstractness merge (Martin A/I/D)', () => {
  test('distanceFromMainSequence implements |A + I − 1| and returns null on missing inputs', () => {
    expect(distanceFromMainSequence(1, 0)).toBeCloseTo(0);
    expect(distanceFromMainSequence(0, 1)).toBeCloseTo(0);
    expect(distanceFromMainSequence(0.5, 0.5)).toBeCloseTo(0);
    expect(distanceFromMainSequence(0, 0)).toBeCloseTo(1);
    expect(distanceFromMainSequence(1, 1)).toBeCloseTo(1);
    expect(distanceFromMainSequence(null, 0.5)).toBeNull();
    expect(distanceFromMainSequence(0.5, null)).toBeNull();
    expect(distanceFromMainSequence(undefined, undefined)).toBeNull();
  });

  test('mergeAbstractness joins per-module A and computes folder-level A as a mean over defined modules', () => {
    const baseReport = aggregate({
      summary: { totalCruised: 2, totalDependenciesCruised: 1 },
      modules: [
        { source: 'ws_apps/a/lib/abs.ts', dependents: [{ name: 'ws_apps/a/main.ts' }], dependencies: [] },
        { source: 'ws_apps/a/main.ts', dependents: [], dependencies: [{ resolved: 'ws_apps/a/lib/abs.ts' }] },
      ],
      folders: [
        { name: 'ws_apps/a', moduleCount: 2, afferentCouplings: 0, efferentCouplings: 0 },
        { name: 'ws_apps/a/lib', moduleCount: 1, afferentCouplings: 1, efferentCouplings: 0 },
      ],
    });
    const merged = mergeAbstractness(baseReport, {
      tool: 'ts-morph',
      readings: [
        { source: 'ws_apps/a/lib/abs.ts', abstract: 2, concrete: 0, A: 1 },
        { source: 'ws_apps/a/main.ts', abstract: 0, concrete: 1, A: 0 },
        // A reading for a module cruiser didn't surface — must NOT appear in the merged output.
        { source: 'ws_apps/a/dead.ts', abstract: 1, concrete: 0, A: 1 },
        // Malformed entries are tolerated.
        null,
        { abstract: 5 },
      ],
    });
    expect(merged.abstractnessTool).toBe('ts-morph');
    expect(merged.workspace.modules).toHaveLength(2);
    const abs = merged.workspace.modules.find((m: { source: string }) => m.source === 'ws_apps/a/lib/abs.ts');
    const main = merged.workspace.modules.find((m: { source: string }) => m.source === 'ws_apps/a/main.ts');
    expect(abs).toMatchObject({ A: 1, abstract: 2, concrete: 0 });
    // lib/abs.ts has I = 0 (Ca=1, Ce=0) and A = 1 → D = 0 (on the main sequence).
    expect(abs?.D).toBeCloseTo(0);
    expect(main).toMatchObject({ A: 0, abstract: 0, concrete: 1 });
    // main.ts has I = 1 (Ca=0, Ce=1) and A = 0 → D = 0 too.
    expect(main?.D).toBeCloseTo(0);

    const aFolder = merged.workspace.folders.find((f: { name: string }) => f.name === 'ws_apps/a');
    const libFolder = merged.workspace.folders.find((f: { name: string }) => f.name === 'ws_apps/a/lib');
    // ws_apps/a contains both modules → mean A = 0.5.
    expect(aFolder?.A).toBeCloseTo(0.5);
    // ws_apps/a/lib contains only abs.ts → A = 1; folder Ca=1/Ce=0 → I = 0 → D = 0.
    expect(libFolder?.A).toBeCloseTo(1);
    expect(libFolder?.D).toBeCloseTo(0);

    const dist = merged.workspace.abstractnessDistribution;
    expect(dist).toMatchObject({ count: 2, definedA: 2, definedD: 2, nearMainSequence: 2 });
  });

  test('mergeAbstractness handles modules with no matching A reading (A and D null) and an empty distribution', () => {
    const baseReport = aggregate({
      modules: [{ source: 'ws_apps/a/x.ts', dependents: [], dependencies: [] }],
      folders: [{ name: 'ws_apps/a', moduleCount: 1, afferentCouplings: 0, efferentCouplings: 0 }],
    });
    const merged = mergeAbstractness(baseReport, { tool: 'ts-morph', readings: [] });
    const mod = merged.workspace.modules[0];
    expect(mod.A).toBeNull();
    expect(mod.D).toBeNull();
    expect(merged.workspace.folders[0].A).toBeNull();
    expect(merged.workspace.folders[0].D).toBeNull();
    expect(merged.workspace.abstractnessDistribution).toMatchObject({ definedA: 0, definedD: 0 });
  });

  test('mergeAbstractness tolerates a null/empty abstractness payload', () => {
    const baseReport = aggregate({
      modules: [{ source: 'ws_apps/a/x.ts', dependents: [], dependencies: [] }],
      folders: [],
    });
    const mergedNull = mergeAbstractness(baseReport, null);
    expect(mergedNull.abstractnessTool).toBeNull();
    expect(mergedNull.workspace.modules[0].A).toBeNull();
    const mergedEmpty = mergeAbstractness(baseReport, {});
    expect(mergedEmpty.abstractnessTool).toBeNull();
  });

  test('renderMarkdown shows A and D columns when the report has an abstractnessTool', () => {
    const baseReport = aggregate({
      summary: { totalCruised: 1, totalDependenciesCruised: 0 },
      modules: [{ source: 'ws_apps/a/main.ts', dependents: [], dependencies: [] }],
      folders: [{ name: 'ws_apps/a', moduleCount: 1, afferentCouplings: 0, efferentCouplings: 1, instability: 1 }],
    });
    const merged = mergeAbstractness(baseReport, {
      tool: 'ts-morph',
      readings: [{ source: 'ws_apps/a/main.ts', abstract: 0, concrete: 1, A: 0 }],
    });
    const md = renderMarkdown(merged);
    expect(md).toContain('dependency-cruiser + ts-morph');
    expect(md).toContain('| folder | mods | Ca | Ce | I | A | D |');
    expect(md).toContain('| module | Ca | Ce | I | A | D |');
    expect(md).toContain('modules with defined A:');
  });

  test('renderMarkdown shows the "no defined A" line when ts-morph saw no class/interface declarations', () => {
    const baseReport = aggregate({
      modules: [{ source: 'ws_apps/a/main.ts', dependents: [], dependencies: [] }],
      folders: [],
    });
    const merged = mergeAbstractness(baseReport, {
      tool: 'ts-morph',
      readings: [{ source: 'ws_apps/a/main.ts', abstract: 0, concrete: 0, A: null }],
    });
    const md = renderMarkdown(merged);
    expect(md).toContain('No modules with a defined A value');
  });
});

describe('sensors aggregate — main() with --abstractness flag', () => {
  test('main reads the abstractness file via the injected readFile and merges A/D into the JSON output', async () => {
    const cruiser = JSON.stringify({
      summary: { totalCruised: 1, totalDependenciesCruised: 0 },
      modules: [{ source: 'ws_apps/a/main.ts', dependents: [], dependencies: [] }],
      folders: [{ name: 'ws_apps/a', moduleCount: 1, afferentCouplings: 0, efferentCouplings: 1, instability: 1 }],
    });
    const abstractness = JSON.stringify({
      tool: 'ts-morph',
      readings: [{ source: 'ws_apps/a/main.ts', abstract: 0, concrete: 1, A: 0 }],
    });
    const writes: string[] = [];
    const code = await main(['--abstractness=/fake/path/abs.json'], {
      read: async () => cruiser,
      write: (s: string) => writes.push(s),
      readFile: (path: string) => {
        expect(path).toBe('/fake/path/abs.json');
        return abstractness;
      },
    });
    expect(code).toBe(0);
    let parsed: { abstractnessTool?: string; workspace?: { modules: Array<{ A: number; D: number }> } } = {};
    try {
      parsed = JSON.parse(writes[0] ?? '');
    } catch (err) {
      throw new Error(`expected JSON output, got: ${(err as Error).message}`);
    }
    expect(parsed.abstractnessTool).toBe('ts-morph');
    expect(parsed.workspace?.modules[0]?.A).toBe(0);
    expect(parsed.workspace?.modules[0]?.D).toBeCloseTo(0);
  });

  test('main returns exit code 2 when the abstractness file can not be read', async () => {
    const writes: string[] = [];
    const code = await main(['--abstractness=/nope/missing.json'], {
      read: async () => '{"modules": [], "folders": []}',
      write: (s: string) => writes.push(s),
      readFile: () => {
        throw new Error('ENOENT: file not found');
      },
    });
    expect(code).toBe(2);
    expect(writes).toEqual([]);
  });
});
