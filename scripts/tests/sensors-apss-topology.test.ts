// Unit tests for harness/sensors/apss_topology.mjs (bead n48.3) — the
// APSS topology adapter that consumes APSS's `.topology/metrics/{modules,
// functions}.json` and emits per-source readings alongside the existing
// dep-cruiser / ts-morph / complexity adapters (ADR-0017: APSS canonical,
// existing adapters preserved).  Uses in-memory fs stubs throughout.
import { describe, expect, test } from 'vitest';
import {
  mergeApssTopology,
  // @ts-expect-error — plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/aggregate.mjs';
import {
  APSS_FUNCTION_METRICS,
  APSS_MODULE_METRICS,
  analyzeFromTopology,
  extractMetrics,
  findApssBinary,
  findTopologyFiles,
  joinModulesAndFunctions,
  main,
  normalizePath,
  parseFunctionsJson,
  parseModulesJson,
  produceTopology,
  // @ts-expect-error — plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/apss_topology.mjs';

interface FsStub {
  files: Record<string, string>;
  existsSync: (p: string) => boolean;
  readFileSync: (p: string) => string;
}

function makeFs(files: Record<string, string>): FsStub {
  return {
    files,
    existsSync: (p: string) => p in files,
    readFileSync: (p: string) => {
      if (!(p in files)) {
        throw new Error(`ENOENT: ${p}`);
      }
      return files[p] as string;
    },
  };
}

describe('apss_topology — path normalization', () => {
  test('slash paths pass through unchanged', () => {
    expect(normalizePath('ws_apps/a/main.ts')).toBe('ws_apps/a/main.ts');
    expect(normalizePath('ws_packages/lib/index.ts')).toBe('ws_packages/lib/index.ts');
  });

  test('Rust :: separator becomes /', () => {
    expect(normalizePath('crate::module::nested')).toBe('crate/module/nested');
  });

  test('Python dot-paths (no slash, no file extension) become /', () => {
    expect(normalizePath('my_app.subpkg.module')).toBe('my_app/subpkg/module');
  });

  test('slash paths with dots in segments (file extensions) are not split', () => {
    expect(normalizePath('ws_apps/a/main.ts')).toBe('ws_apps/a/main.ts');
    expect(normalizePath('ws_apps/a/lib.helpers.ts')).toBe('ws_apps/a/lib.helpers.ts');
  });

  test('returns null on non-string input', () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing rejection of non-string
    expect(normalizePath(42 as any)).toBeNull();
    // biome-ignore lint/suspicious/noExplicitAny: testing rejection of non-string
    expect(normalizePath(undefined as any)).toBeNull();
  });
});

describe('apss_topology — extractMetrics', () => {
  test('keeps numeric fields and nulls the rest', () => {
    const m = extractMetrics(
      { ca: 1, ce: 2, instability: 0.5, abstractness: 0, junk: 'ignore' },
      APSS_MODULE_METRICS,
    );
    expect(m.ca).toBe(1);
    expect(m.ce).toBe(2);
    expect(m.instability).toBe(0.5);
    expect(m.abstractness).toBe(0);
    expect(m.distance_from_main_sequence).toBeNull();
    expect(m.file_count).toBeNull();
    // junk field is not in the schema → not included
    expect('junk' in m).toBe(false);
  });

  test('treats non-number metric values as null (forward-compat)', () => {
    const m = extractMetrics(
      { ca: 'string', ce: null, instability: undefined },
      APSS_MODULE_METRICS,
    );
    expect(m.ca).toBeNull();
    expect(m.ce).toBeNull();
    expect(m.instability).toBeNull();
  });

  test('canonical metric lists are non-empty (forward-compat sentinel)', () => {
    expect(APSS_MODULE_METRICS.length).toBeGreaterThanOrEqual(12);
    expect(APSS_FUNCTION_METRICS.length).toBe(3);
  });
});

describe('apss_topology — parseModulesJson', () => {
  test('accepts top-level {modules: [...]} shape', () => {
    const out = parseModulesJson({
      modules: [{ source: 'ws_apps/a/main.ts', ca: 0, ce: 2, instability: 1 }],
    });
    expect(out).toEqual([
      {
        source: 'ws_apps/a/main.ts',
        ...extractMetrics({ ca: 0, ce: 2, instability: 1 }, APSS_MODULE_METRICS),
      },
    ]);
  });

  test('accepts bare-array shape too', () => {
    const out = parseModulesJson([{ source: 'ws_apps/a/main.ts', ca: 0 }]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('ws_apps/a/main.ts');
  });

  test('accepts source via path/name aliases', () => {
    const a = parseModulesJson([{ path: 'ws_apps/a/main.ts' }]);
    const b = parseModulesJson([{ name: 'ws_apps/a/main.ts' }]);
    expect(a[0].source).toBe('ws_apps/a/main.ts');
    expect(b[0].source).toBe('ws_apps/a/main.ts');
  });

  test('skips entries with no usable source identifier', () => {
    const out = parseModulesJson([{ ca: 1 }, { source: 42 }, { source: 'ws_apps/a/m.ts' }]);
    expect(out).toHaveLength(1);
  });

  test('returns empty array for malformed input', () => {
    expect(parseModulesJson(null)).toEqual([]);
    expect(parseModulesJson({})).toEqual([]);
    expect(parseModulesJson({ modules: 'not-an-array' })).toEqual([]);
  });

  test('reads the real APSS code-topology shape: metrics.* + metrics.martin.*', () => {
    // This is the exact envelope `apss run code-topology analyze .`
    // emits in .topology/metrics/modules.json — module-level aggregates
    // live under `metrics`, and Martin coupling lives under `metrics.martin`.
    // Before the n48 closed-loop wiring these fields all came back null
    // because the parser only read flat top-level keys.
    const out = parseModulesJson({
      modules: [
        {
          id: 'scripts/inspector',
          path: 'scripts/inspector/',
          name: 'scripts/inspector',
          metrics: {
            avg_cognitive: 0.5,
            avg_cyclomatic: 1.25,
            file_count: 1,
            function_count: 4,
            lines_of_code: 52,
            total_cognitive: 2,
            total_cyclomatic: 5,
            martin: {
              abstractness: 0.0,
              ca: 0,
              ce: 1,
              distance_from_main_sequence: 0.5,
              instability: 0.5,
            },
          },
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('scripts/inspector/');
    expect(out[0].ca).toBe(0);
    expect(out[0].ce).toBe(1);
    expect(out[0].instability).toBe(0.5);
    expect(out[0].abstractness).toBe(0);
    expect(out[0].distance_from_main_sequence).toBe(0.5);
    expect(out[0].file_count).toBe(1);
    expect(out[0].function_count).toBe(4);
    expect(out[0].lines_of_code).toBe(52);
    expect(out[0].total_cognitive).toBe(2);
    expect(out[0].total_cyclomatic).toBe(5);
    expect(out[0].avg_cognitive).toBe(0.5);
    expect(out[0].avg_cyclomatic).toBe(1.25);
  });
});

describe('apss_topology — producer wiring (n48.X closed loop)', () => {
  test('findApssBinary prefers the project-composed .apss/bin/apss', () => {
    const fs = {
      existsSync: (p: string) => p === '/repo/.apss/bin/apss',
    };
    expect(findApssBinary('/repo', { fs })).toBe('/repo/.apss/bin/apss');
  });

  test('findApssBinary falls back to PATH when .apss/bin/apss is missing', () => {
    const fs = { existsSync: () => false };
    const spawn = () => ({ status: 0 });
    expect(findApssBinary('/repo', { fs, spawn })).toBe('apss');
  });

  test('findApssBinary returns null when nothing is reachable', () => {
    const fs = { existsSync: () => false };
    const spawn = () => ({ status: 127 });
    expect(findApssBinary('/repo', { fs, spawn })).toBeNull();
  });

  test('produceTopology returns ran:false when no apss is installed', () => {
    const out = produceTopology({
      cwd: '/repo',
      bin: null,
      fs: { existsSync: () => false },
      spawn: () => ({ status: 127 }),
    });
    expect(out.ran).toBe(false);
    expect(out.reason).toBe('apss-binary-not-found');
  });

  test('produceTopology invokes apss with the canonical analyze argv on success', () => {
    const calls: { bin: string; argv: readonly string[] }[] = [];
    const out = produceTopology({
      cwd: '/repo',
      bin: '/repo/.apss/bin/apss',
      spawn: (bin: string, argv: readonly string[]) => {
        calls.push({ bin, argv });
        return { status: 0, stdout: 'ok', stderr: '' };
      },
    });
    expect(out.ran).toBe(true);
    expect(out.bin).toBe('/repo/.apss/bin/apss');
    expect(calls).toHaveLength(1);
    expect(calls[0].argv).toEqual(['run', 'code-topology', 'analyze', '.']);
  });

  test('produceTopology surfaces a non-zero exit as ran:false with the apss exit code', () => {
    const out = produceTopology({
      cwd: '/repo',
      bin: '/repo/.apss/bin/apss',
      spawn: () => ({ status: 2, stdout: '', stderr: 'boom' }),
    });
    expect(out.ran).toBe(false);
    expect(out.reason).toBe('apss-exit-2');
    expect(out.stderr).toContain('boom');
  });
});

describe('apss_topology — parseFunctionsJson', () => {
  test('groups by module and extracts cognitive/cyclomatic/loc per function', () => {
    const out = parseFunctionsJson({
      functions: [
        { module: 'ws_apps/a/main.ts', name: 'fn1', line: 10, cognitive: 3, cyclomatic: 2, loc: 8 },
        { module: 'ws_apps/a/main.ts', name: 'fn2', line: 20, cognitive: 1, cyclomatic: 1, loc: 4 },
        { module: 'ws_apps/b/lib.ts', name: 'fn3', line: 5, cognitive: 0, cyclomatic: 1, loc: 2 },
      ],
    });
    expect(out.get('ws_apps/a/main.ts')).toHaveLength(2);
    expect(out.get('ws_apps/b/lib.ts')).toHaveLength(1);
    const a = out.get('ws_apps/a/main.ts');
    expect(a?.[0]).toMatchObject({ name: 'fn1', line: 10, cognitive: 3, cyclomatic: 2, loc: 8 });
  });

  test('skips functions missing a module/source identifier', () => {
    const out = parseFunctionsJson({ functions: [{ name: 'orphan' }] });
    expect(out.size).toBe(0);
  });

  test('returns empty Map for malformed input', () => {
    expect(parseFunctionsJson(null).size).toBe(0);
    expect(parseFunctionsJson({ functions: 'not-array' }).size).toBe(0);
  });
});

describe('apss_topology — joinModulesAndFunctions', () => {
  test('fills missing module aggregates from per-function readings', () => {
    const modules = parseModulesJson([{ source: 'ws_apps/a/m.ts', ca: 1, ce: 2 }]);
    const functions = parseFunctionsJson({
      functions: [
        { module: 'ws_apps/a/m.ts', name: 'f1', cognitive: 3, cyclomatic: 2, loc: 10 },
        { module: 'ws_apps/a/m.ts', name: 'f2', cognitive: 5, cyclomatic: 4, loc: 20 },
      ],
    });
    const joined = joinModulesAndFunctions(modules, functions);
    expect(joined).toHaveLength(1);
    const r = joined[0];
    expect(r.functions).toHaveLength(2);
    expect(r.function_count).toBe(2);
    expect(r.total_cognitive).toBe(8);
    expect(r.total_cyclomatic).toBe(6);
    expect(r.lines_of_code).toBe(30);
    expect(r.avg_cognitive).toBeCloseTo(4);
    expect(r.avg_cyclomatic).toBeCloseTo(3);
  });

  test('respects module-level aggregates when APSS already supplied them', () => {
    const modules = parseModulesJson([
      {
        source: 'ws_apps/a/m.ts',
        ca: 1,
        ce: 2,
        function_count: 99,
        total_cognitive: 999,
        lines_of_code: 1234,
      },
    ]);
    const functions = parseFunctionsJson({
      functions: [{ module: 'ws_apps/a/m.ts', name: 'f1', cognitive: 1, loc: 1 }],
    });
    const joined = joinModulesAndFunctions(modules, functions);
    expect(joined[0].function_count).toBe(99);
    expect(joined[0].total_cognitive).toBe(999);
    expect(joined[0].lines_of_code).toBe(1234);
  });

  test('emits empty functions array when no functions match', () => {
    const modules = parseModulesJson([{ source: 'ws_apps/a/m.ts', ca: 0 }]);
    const joined = joinModulesAndFunctions(modules, new Map());
    expect(joined[0].functions).toEqual([]);
    expect(joined[0].function_count).toBeNull();
  });
});

describe('apss_topology — findTopologyFiles & analyzeFromTopology', () => {
  test('reports unavailable when modules.json is absent', () => {
    const fs = makeFs({});
    const found = findTopologyFiles('/repo', { fs });
    expect(found.available).toBe(false);
    expect(found.modulesPath).toBe('/repo/.topology/metrics/modules.json');
  });

  test('reports available when modules.json exists, custom topologyDir respected', () => {
    const fs = makeFs({
      '/custom/modules.json': JSON.stringify({ modules: [{ source: 'ws_apps/a.ts', ca: 0 }] }),
    });
    const found = findTopologyFiles('/repo', { fs, topologyDir: '/custom' });
    expect(found.available).toBe(true);
    expect(found.modulesPath).toBe('/custom/modules.json');
  });

  test('analyzeFromTopology returns no-op shape when not available', () => {
    const fs = makeFs({});
    expect(analyzeFromTopology('/repo', { fs })).toEqual({
      tool: 'apss-topology',
      available: false,
      readings: [],
    });
  });

  test('analyzeFromTopology produces readings from modules.json + functions.json', () => {
    const fs = makeFs({
      '/repo/.topology/metrics/modules.json': JSON.stringify({
        modules: [{ source: 'ws_apps/a/m.ts', ca: 1, ce: 2, instability: 0.67 }],
      }),
      '/repo/.topology/metrics/functions.json': JSON.stringify({
        functions: [
          { module: 'ws_apps/a/m.ts', name: 'f1', cognitive: 2, cyclomatic: 2, loc: 5 },
          { module: 'ws_apps/a/m.ts', name: 'f2', cognitive: 4, cyclomatic: 3, loc: 8 },
        ],
      }),
    });
    const out = analyzeFromTopology('/repo', { fs });
    expect(out.available).toBe(true);
    expect(out.readings).toHaveLength(1);
    const r = out.readings[0];
    expect(r.source).toBe('ws_apps/a/m.ts');
    expect(r.ca).toBe(1);
    expect(r.function_count).toBe(2);
    expect(r.functions).toHaveLength(2);
    expect(r.total_cognitive).toBe(6);
  });

  test('analyzeFromTopology tolerates malformed modules.json (returns error key, no readings)', () => {
    const fs = makeFs({ '/repo/.topology/metrics/modules.json': '{not json' });
    const out = analyzeFromTopology('/repo', { fs });
    expect(out.available).toBe(false);
    expect(out.readings).toEqual([]);
    expect(typeof out.error).toBe('string');
  });

  test('analyzeFromTopology keeps modules when functions.json is malformed', () => {
    const fs = makeFs({
      '/repo/.topology/metrics/modules.json': JSON.stringify({
        modules: [{ source: 'ws_apps/a.ts', ca: 0 }],
      }),
      '/repo/.topology/metrics/functions.json': 'not-json',
    });
    const out = analyzeFromTopology('/repo', { fs });
    expect(out.available).toBe(true);
    expect(out.readings).toHaveLength(1);
    expect(out.functions_error).toContain('failed to read');
  });

  test('analyzeFromTopology works without functions.json (modules-only)', () => {
    const fs = makeFs({
      '/repo/.topology/metrics/modules.json': JSON.stringify({
        modules: [{ source: 'ws_apps/a.ts', ca: 0, ce: 1 }],
      }),
    });
    const out = analyzeFromTopology('/repo', { fs });
    expect(out.available).toBe(true);
    expect(out.readings[0].functions).toEqual([]);
  });
});

describe('apss_topology — CLI main', () => {
  test('writes JSON to stdout (no-op shape when no .topology/ exists)', async () => {
    // Use a guaranteed-missing path so the adapter reports unavailable.
    const writes: string[] = [];
    const code = await main(['--root=/nonexistent-path-for-test'], {
      write: (s: string) => writes.push(s),
    });
    expect(code).toBe(0);
    let parsed: { tool?: string; available?: boolean; readings?: unknown[] } = {};
    try {
      parsed = JSON.parse(writes[0] ?? '');
    } catch (err) {
      throw new Error(`expected JSON: ${(err as Error).message}`);
    }
    expect(parsed.tool).toBe('apss-topology');
    expect(parsed.available).toBe(false);
    expect(parsed.readings).toEqual([]);
  });
});

describe('aggregate.mjs — mergeApssTopology (n48.3 + ADR-0017)', () => {
  function baseReport() {
    return {
      tool: 'dependency-cruiser',
      raw: {},
      workspace: {
        folders: [{ name: 'ws_apps/a', moduleCount: 2 }],
        modules: [
          { source: 'ws_apps/a/main.ts', Ca: 1, Ce: 2, I: 0.5 },
          { source: 'ws_apps/a/lib.ts', Ca: 2, Ce: 0, I: 0 },
        ],
      },
    };
  }

  test('available:false leaves modules + folders unchanged, signals apssAvailable=false', () => {
    const out = mergeApssTopology(baseReport(), {
      tool: 'apss-topology',
      available: false,
      readings: [],
    });
    expect(out.apssAvailable).toBe(false);
    expect(out.apssTopologyTool).toBeNull();
    expect(out.workspace.modules).toEqual(baseReport().workspace.modules);
  });

  test('null payload also yields available=false (defensive)', () => {
    const out = mergeApssTopology(baseReport(), null);
    expect(out.apssAvailable).toBe(false);
    expect(out.workspace.modules).toEqual(baseReport().workspace.modules);
  });

  test('preservation rule: APSS metrics land in a sub-object, existing Ca/Ce/I are NOT overwritten', () => {
    const out = mergeApssTopology(baseReport(), {
      tool: 'apss-topology',
      available: true,
      readings: [
        {
          source: 'ws_apps/a/main.ts',
          ca: 99,
          ce: 99,
          instability: 0.99,
          distance_from_main_sequence: 0.4,
          functions: [{ name: 'f1', cognitive: 3, cyclomatic: 2, loc: 5 }],
        },
      ],
    });
    expect(out.apssAvailable).toBe(true);
    expect(out.apssTopologyTool).toBe('apss-topology');
    const main = out.workspace.modules.find(
      (m: { source: string }) => m.source === 'ws_apps/a/main.ts',
    );
    // Existing dep-cruiser fields preserved.
    expect(main?.Ca).toBe(1);
    expect(main?.Ce).toBe(2);
    expect(main?.I).toBe(0.5);
    // APSS fields land under .apss
    expect(main?.apss?.ca).toBe(99);
    expect(main?.apss?.ce).toBe(99);
    expect(main?.apss?.distance_from_main_sequence).toBeCloseTo(0.4);
    expect(main?.apss?.function_count).toBe(1);
    // Module with no APSS reading is untouched (no .apss key).
    const lib = out.workspace.modules.find(
      (m: { source: string }) => m.source === 'ws_apps/a/lib.ts',
    );
    expect(lib?.apss).toBeUndefined();
  });

  test('per-folder apss_modules and apss_distance_max rollup', () => {
    const out = mergeApssTopology(baseReport(), {
      tool: 'apss-topology',
      available: true,
      readings: [
        { source: 'ws_apps/a/main.ts', distance_from_main_sequence: 0.4 },
        { source: 'ws_apps/a/lib.ts', distance_from_main_sequence: 0.8 },
      ],
    });
    const folder = out.workspace.folders.find((f: { name: string }) => f.name === 'ws_apps/a');
    expect(folder?.apss_modules).toBe(2);
    expect(folder?.apss_distance_max).toBeCloseTo(0.8);
  });
});
