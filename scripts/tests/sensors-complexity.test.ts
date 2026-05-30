// Unit tests for harness/sensors/complexity.mjs (bead n48.5).  Uses
// ts-morph's in-memory file system so the tests run hermetically.
import { Project } from 'ts-morph';
import { describe, expect, test } from 'vitest';
import {
  analyzeFiles,
  classifyModule,
  cognitiveOf,
  cyclomaticOf,
  isWorkspaceSource,
  main,
  workspaceSourcesFromCruiser,
  // @ts-expect-error — plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/complexity.mjs';

function inMemoryProject(): InstanceType<typeof Project> {
  return new Project({ useInMemoryFileSystem: true });
}

describe('sensors complexity — pure helpers', () => {
  test('isWorkspaceSource filters as expected (mirrors abstractness)', () => {
    expect(isWorkspaceSource('ws_apps/a/x.ts')).toBe(true);
    expect(isWorkspaceSource('ws_packages/lib/index.ts')).toBe(true);
    expect(isWorkspaceSource('node_modules/foo/index.ts')).toBe(false);
    expect(isWorkspaceSource('@scope/pkg')).toBe(false);
    expect(isWorkspaceSource('')).toBe(false);
    // biome-ignore lint/suspicious/noExplicitAny: testing rejection of non-string
    expect(isWorkspaceSource(99 as any)).toBe(false);
  });

  test('cyclomaticOf returns 1 for a straight-line function', () => {
    const project = inMemoryProject();
    const sf = project.createSourceFile(
      'a.ts',
      'export function f() { const x = 1; const y = 2; return x + y; }',
    );
    const fn = sf.getFunctions()[0];
    expect(fn).toBeDefined();
    if (fn) {
      expect(cyclomaticOf(fn)).toBe(1);
    }
  });

  test('cyclomaticOf increments for if / for / while / case / catch / ternary / short-circuit ops', () => {
    const project = inMemoryProject();
    const sf = project.createSourceFile(
      'a.ts',
      `export function f(input: { x: number; y: number; arr: number[] }) {
        try {
          // if (+1)
          if (input.x > 0) {
            // for (+1)
            for (const item of input.arr) {
              // while (+1)
              while (item < 10) { break; }
              // && (+1) || (+1) ?? (+1)
              const z = input.x > 0 && input.y > 0 || input.x < 0;
              const w = input.x ?? 0;
              // ternary (+1)
              const v = w > 0 ? 1 : 2;
              return v + (z ? 1 : 0); // ternary (+1)
            }
            // switch + 2 case (+2)
            switch (input.y) {
              case 1: return 1;
              case 2: return 2;
            }
          }
        } catch (_e) {  // catch (+1)
          return 0;
        }
        return 0;
      }`,
    );
    const fn = sf.getFunctions()[0];
    expect(fn).toBeDefined();
    if (fn) {
      // base 1 + 1 if + 1 for + 1 while + 1 && + 1 || + 1 ?? + 2 ternary
      //      + 2 cases + 1 catch = 12.
      expect(cyclomaticOf(fn)).toBe(12);
    }
  });

  test('cognitiveOf is 0 on straight-line code', () => {
    const project = inMemoryProject();
    const sf = project.createSourceFile('a.ts', 'export function f() { const x = 1; return x; }');
    const fn = sf.getFunctions()[0];
    expect(fn).toBeDefined();
    if (fn) {
      expect(cognitiveOf(fn)).toBe(0);
    }
  });

  test('cognitiveOf adds nesting depth — a doubly-nested if costs more than two siblings', () => {
    const project = inMemoryProject();
    const sf = project.createSourceFile(
      'a.ts',
      `
      export function nested(x: number) {
        if (x > 0) {        // +1 (depth 0)
          if (x > 10) {     // +2 (depth 1)
            return 'big';
          }
        }
        return 'small';
      }
      export function siblings(x: number) {
        if (x > 0) { return 'pos'; }   // +1
        if (x === 0) { return 'zero'; } // +1
        return 'neg';
      }`,
    );
    const [nested, siblings] = sf.getFunctions();
    expect(nested).toBeDefined();
    expect(siblings).toBeDefined();
    if (nested && siblings) {
      // nested: 1 (outer) + 2 (inner, depth 1) = 3
      expect(cognitiveOf(nested)).toBe(3);
      // siblings: 1 + 1 = 2
      expect(cognitiveOf(siblings)).toBe(2);
      // Sanity: nested > siblings even though both have 2 branch points.
      expect(cognitiveOf(nested)).toBeGreaterThan(cognitiveOf(siblings));
    }
  });

  test('cognitiveOf counts short-circuit ops with +1 each (V1 simplification)', () => {
    const project = inMemoryProject();
    const sf = project.createSourceFile(
      'a.ts',
      'export function f(a: number, b: number) { return a > 0 && b > 0 || a < 0; }',
    );
    const fn = sf.getFunctions()[0];
    expect(fn).toBeDefined();
    if (fn) {
      // && (+1) + || (+1) = 2
      expect(cognitiveOf(fn)).toBe(2);
    }
  });
});

describe('sensors complexity — classifyModule', () => {
  test('aggregates per-function metrics into max/median + function_count', () => {
    const project = inMemoryProject();
    const sf = project.createSourceFile(
      'a.ts',
      `
      export function simple() { return 1; }
      export function medium(x: number) { if (x > 0) { return x; } return 0; }
      export function complex(x: number) {
        if (x > 0) { for (let i = 0; i < x; i++) { if (i % 2 === 0) { return i; } } }
        return -1;
      }`,
    );
    const m = classifyModule(sf);
    expect(m.function_count).toBe(3);
    // cyclomatic: simple=1, medium=2, complex=4 (if + for + inner if + base 1)
    expect(m.max_cyclomatic).toBe(4);
    expect(m.median_cyclomatic).toBe(2);
    expect(m.max_cognitive).toBeGreaterThanOrEqual(m.median_cognitive ?? 0);
    expect(m.functions).toHaveLength(3);
    expect(m.functions[0]?.name).toBe('simple');
  });

  test('returns nulls + zero count for a module with no functions', () => {
    const project = inMemoryProject();
    const sf = project.createSourceFile('a.ts', 'export const x = 1; export const y = 2;');
    const m = classifyModule(sf);
    expect(m.function_count).toBe(0);
    expect(m.max_cyclomatic).toBeNull();
    expect(m.median_cyclomatic).toBeNull();
    expect(m.max_cognitive).toBeNull();
    expect(m.median_cognitive).toBeNull();
    expect(m.functions).toEqual([]);
  });

  test('picks readable names for arrow / anonymous / method / constructor', () => {
    const project = inMemoryProject();
    const sf = project.createSourceFile(
      'a.ts',
      `
      export class C {
        constructor(public x: number) {}
        m() { return 1; }
      }
      export const arrow = (a: number) => a + 1;
      `,
    );
    const m = classifyModule(sf);
    const names = m.functions.map((f: { name: string }) => f.name);
    expect(names).toContain('constructor');
    expect(names).toContain('m');
    // Arrow may surface as <anonymous> (its label comes from the variable, not
    // the function-like node itself); accept either.
    expect(names.some((n: string) => n === 'arrow' || n === '<anonymous>')).toBe(true);
  });

  test('median is the average of the two middle values for an even count', () => {
    const project = inMemoryProject();
    const sf = project.createSourceFile(
      'a.ts',
      `
      export function f1() { return 1; }                            // cyc 1
      export function f2(x: number) { if (x) { return 1; } return 0; } // cyc 2
      export function f3(x: number) { if (x) for (let i=0;i<x;i++) { if (i) {} } return 0; } // cyc 4
      export function f4(x: number) { if (x) if (x>0) for (let i=0;i<x;i++) if (i) {} return 0; } // cyc 5
      `,
    );
    const m = classifyModule(sf);
    expect(m.function_count).toBe(4);
    // sorted: [1,2,4,5] → median = (2+4)/2 = 3
    expect(m.median_cyclomatic).toBe(3);
  });
});

describe('sensors complexity — analyzeFiles', () => {
  test('classifies each file and emits per-source readings', () => {
    const project = inMemoryProject();
    project.createSourceFile('ws_apps/a/simple.ts', 'export function f() { return 1; }');
    project.createSourceFile(
      'ws_apps/a/branchy.ts',
      'export function f(x: number) { if (x) for (let i=0;i<x;i++) if (i) {} return 0; }',
    );
    const readings = analyzeFiles(['ws_apps/a/simple.ts', 'ws_apps/a/branchy.ts'], { project });
    expect(readings).toHaveLength(2);
    expect(readings[0]).toMatchObject({ source: 'ws_apps/a/simple.ts', function_count: 1 });
    expect(readings[1].max_cyclomatic).toBeGreaterThan(readings[0].max_cyclomatic);
  });

  test('analyzeFiles skips non-string paths', () => {
    const project = inMemoryProject();
    project.createSourceFile('ws_apps/a/x.ts', 'export function f() { return 1; }');
    const readings = analyzeFiles(
      // biome-ignore lint/suspicious/noExplicitAny: testing input sanitization
      ['ws_apps/a/x.ts', '' as string, null as any, undefined as any],
      { project },
    );
    expect(readings).toHaveLength(1);
    expect(readings[0].source).toBe('ws_apps/a/x.ts');
  });

  test('analyzeFiles surfaces an error reading when ts-morph cannot open the file', () => {
    const project = inMemoryProject();
    const readings = analyzeFiles(['ws_apps/missing.ts'], { project });
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({
      source: 'ws_apps/missing.ts',
      function_count: 0,
      max_cyclomatic: null,
      max_cognitive: null,
    });
    expect(typeof readings[0].error).toBe('string');
  });
});

describe('sensors complexity — workspaceSourcesFromCruiser', () => {
  test('keeps only ws_apps/ws_packages .ts/.tsx sources, de-duped + sorted', () => {
    const out = workspaceSourcesFromCruiser({
      modules: [
        { source: 'ws_apps/a/main.ts' },
        { source: 'ws_apps/a/main.ts' },
        { source: 'ws_apps/a/lib.tsx' },
        { source: 'ws_apps/a/script.mjs' },
        { source: 'node_modules/vitest/index.js' },
        { source: null },
        {},
      ],
    });
    expect(out).toEqual(['ws_apps/a/lib.tsx', 'ws_apps/a/main.ts']);
  });

  test('tolerates a missing modules array', () => {
    expect(workspaceSourcesFromCruiser({})).toEqual([]);
    expect(workspaceSourcesFromCruiser(null)).toEqual([]);
  });
});

describe('sensors complexity — CLI main', () => {
  test('happy path: empty modules list → empty readings, exit 0', async () => {
    const writes: string[] = [];
    const code = await main([], {
      read: async () => '{"modules": []}',
      write: (s: string) => writes.push(s),
    });
    expect(code).toBe(0);
    let parsed: { tool?: string; readings?: unknown[] } = {};
    try {
      parsed = JSON.parse(writes[0] ?? '');
    } catch (err) {
      throw new Error(`expected JSON: ${(err as Error).message}`);
    }
    expect(parsed.tool).toBe('ts-morph-complexity');
    expect(parsed.readings).toEqual([]);
  });

  test('exit 2 on empty stdin', async () => {
    const code = await main([], { read: async () => '', write: () => {} });
    expect(code).toBe(2);
  });

  test('exit 2 on non-JSON stdin', async () => {
    const code = await main([], { read: async () => 'not json', write: () => {} });
    expect(code).toBe(2);
  });

  test('exit 2 when the stdin read itself throws', async () => {
    const code = await main([], {
      read: async () => {
        throw new Error('stdin closed');
      },
      write: () => {},
    });
    expect(code).toBe(2);
  });
});
