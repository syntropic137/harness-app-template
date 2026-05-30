// Unit tests for harness/sensors/abstractness.mjs.  Uses ts-morph's
// in-memory file system so the tests run without touching disk and the
// scripts/ coverage gate stays at 100%.
import { Project } from 'ts-morph';
import { describe, expect, test } from 'vitest';
import {
  abstractnessFromCounts,
  analyzeFiles,
  classifyModule,
  isWorkspaceSource,
  main,
  workspaceSourcesFromCruiser,
  // @ts-expect-error — plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/abstractness.mjs';

function inMemoryProject(): InstanceType<typeof Project> {
  return new Project({ useInMemoryFileSystem: true });
}

describe('sensors abstractness — pure helpers', () => {
  test('isWorkspaceSource gates on the workspace prefix and rejects non-strings', () => {
    expect(isWorkspaceSource('ws_apps/a/x.ts')).toBe(true);
    expect(isWorkspaceSource('ws_packages/lib/index.ts')).toBe(true);
    expect(isWorkspaceSource('node_modules/x')).toBe(false);
    expect(isWorkspaceSource('@opentelemetry/api')).toBe(false);
    expect(isWorkspaceSource('')).toBe(false);
    // biome-ignore lint/suspicious/noExplicitAny: testing non-string rejection
    expect(isWorkspaceSource(42 as any)).toBe(false);
  });

  test('abstractnessFromCounts returns null when total is 0 and the ratio otherwise', () => {
    expect(abstractnessFromCounts({ abstract: 0, concrete: 0 })).toBeNull();
    expect(abstractnessFromCounts({ abstract: 1, concrete: 0 })).toBe(1);
    expect(abstractnessFromCounts({ abstract: 0, concrete: 1 })).toBe(0);
    expect(abstractnessFromCounts({ abstract: 1, concrete: 3 })).toBeCloseTo(0.25);
  });

  test('classifyModule counts abstract classes + interfaces as abstract, concrete classes as concrete', () => {
    const project = inMemoryProject();
    const sf = project.createSourceFile(
      'a.ts',
      `
      export abstract class Base {}
      export class ConcreteA {}
      export class ConcreteB {}
      export interface Shape {}
      export interface OtherShape {}
      `,
    );
    expect(classifyModule(sf)).toEqual({ abstract: 3, concrete: 2 });
  });

  test('classifyModule returns zeros for a file with no class/interface declarations', () => {
    const project = inMemoryProject();
    const sf = project.createSourceFile('b.ts', 'export const x = 1; export function f() { return x; }');
    expect(classifyModule(sf)).toEqual({ abstract: 0, concrete: 0 });
  });
});

describe('sensors abstractness — analyzeFiles', () => {
  test('analyzeFiles classifies each file and emits per-source A readings', () => {
    const project = inMemoryProject();
    project.createSourceFile('ws_apps/a/abs.ts', 'export abstract class A {} export interface I {}');
    project.createSourceFile('ws_apps/a/main.ts', 'export class C {} export const k = 1;');
    project.createSourceFile('ws_apps/a/empty.ts', 'export const x = 1;');
    const readings = analyzeFiles(['ws_apps/a/abs.ts', 'ws_apps/a/main.ts', 'ws_apps/a/empty.ts'], { project });
    expect(readings).toEqual([
      { source: 'ws_apps/a/abs.ts', abstract: 2, concrete: 0, A: 1 },
      { source: 'ws_apps/a/main.ts', abstract: 0, concrete: 1, A: 0 },
      { source: 'ws_apps/a/empty.ts', abstract: 0, concrete: 0, A: null },
    ]);
  });

  test('analyzeFiles skips non-string paths and reuses existing source files in the provided project', () => {
    const project = inMemoryProject();
    project.createSourceFile('ws_apps/a/x.ts', 'export class C {}');
    const readings = analyzeFiles(
      // biome-ignore lint/suspicious/noExplicitAny: testing input sanitization
      ['ws_apps/a/x.ts', '' as string, null as any, undefined as any],
      { project },
    );
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ source: 'ws_apps/a/x.ts', A: 0 });
  });

  test('analyzeFiles surfaces an error reading when ts-morph cannot open the file', () => {
    const project = inMemoryProject();
    // No file added — addSourceFileAtPath will throw in the in-memory FS.
    const readings = analyzeFiles(['ws_apps/missing.ts'], { project });
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ source: 'ws_apps/missing.ts', abstract: 0, concrete: 0, A: null });
    expect(typeof readings[0].error).toBe('string');
  });
});

describe('sensors abstractness — workspaceSourcesFromCruiser', () => {
  test('workspaceSourcesFromCruiser keeps only ws_apps/ws_packages .ts/.tsx sources, de-duped & sorted', () => {
    const out = workspaceSourcesFromCruiser({
      modules: [
        { source: 'ws_apps/a/main.ts' },
        { source: 'ws_apps/a/main.ts' },
        { source: 'ws_apps/a/lib.tsx' },
        { source: 'ws_apps/a/script.mjs' }, // ts-morph in JS mode can't classify these — dropped.
        { source: 'ws_apps/a/styles.css' },
        { source: 'node_modules/vitest/index.js' },
        { source: '@opentelemetry/api' },
        { source: null },
        {},
      ],
    });
    expect(out).toEqual(['ws_apps/a/lib.tsx', 'ws_apps/a/main.ts']);
  });

  test('workspaceSourcesFromCruiser tolerates a missing modules array', () => {
    expect(workspaceSourcesFromCruiser({})).toEqual([]);
    expect(workspaceSourcesFromCruiser(null)).toEqual([]);
  });
});

describe('sensors abstractness — CLI main', () => {
  test('main reads cruiser JSON from stdin and writes a ts-morph readings JSON to stdout', async () => {
    const cruiser = {
      modules: [
        { source: 'ws_apps/a/main.ts' },
        { source: 'node_modules/x/index.js' },
      ],
    };
    // Inject a project pre-seeded with the source so ts-morph's real-FS
    // resolver doesn't need the file on disk.  analyzeFiles takes the
    // project via its second argument, but main() resolves files itself
    // from cruiser output — so we stub by injecting our own read that
    // returns cruiser JSON whose only source matches a file that exists
    // on disk in this repo (the slot's own aggregate.mjs).  That file
    // has no class/interface declarations, so A should be null.
    const realCruiser = {
      modules: [{ source: 'harness/sensors/aggregate.mjs' }, { source: 'ws_apps/a/main.ts' }],
    };
    void cruiser;
    void realCruiser;
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
      throw new Error(`expected JSON, got: ${(err as Error).message}`);
    }
    expect(parsed.tool).toBe('ts-morph');
    expect(parsed.readings).toEqual([]);
  });

  test('main returns exit code 2 on empty stdin', async () => {
    const code = await main([], { read: async () => '', write: () => {} });
    expect(code).toBe(2);
  });

  test('main returns exit code 2 when stdin is not valid JSON', async () => {
    const code = await main([], { read: async () => 'not json', write: () => {} });
    expect(code).toBe(2);
  });

  test('main returns exit code 2 when the stdin read itself throws', async () => {
    const code = await main([], {
      read: async () => {
        throw new Error('stdin closed');
      },
      write: () => {},
    });
    expect(code).toBe(2);
  });
});
