// Unit tests for harness/sensors/aggregate.mjs.  The aggregator is plain
// Node ESM so it can ship inside the slot directory without pulling the
// scripts/ coverage gate over it.  These tests cover the pure functions
// (de-dup, scope-filter, aggregate, renderMarkdown) and the CLI entry
// (`main`) via in-process IO stubs — no child_process spawns.
import { describe, expect, test } from 'vitest';
// @ts-expect-error — plain ESM, no .d.ts ships with the slot.
import { aggregate, dedupeModules, isWorkspaceName, main, renderMarkdown, scopeFolders } from '../../harness/sensors/aggregate.mjs';

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
