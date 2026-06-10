import { describe, expect, test } from 'vitest';
import { main, renderTable, rowsFromManifest, type SlotsDeps } from '../slots';

// Local manifest-row shape mirrors the subset scripts/slots.ts reads
// (kept here so the test does not introduce an internal-module edge
// just to construct fixtures).
interface TestSlotRecord {
  plugin: string;
  version?: string;
  required: boolean;
  decisionAt?: string;
}

const baseSlot: TestSlotRecord = {
  plugin: 'reference-plugin',
  version: '1.2.3',
  required: true,
  decisionAt: 'docs/adrs/ADR-0001-stack-manager.md',
};

function slot(name: string, overrides: Partial<TestSlotRecord> = {}): [string, TestSlotRecord] {
  return [name, { ...baseSlot, ...overrides }];
}

function manifest(slots: Array<[string, TestSlotRecord]>): string {
  return JSON.stringify({
    name: 'test-project',
    version: '0.1.0',
    slots: Object.fromEntries(slots),
  });
}

interface Captured {
  out: string[];
  err: string[];
  exit?: number;
}

function runMain(argv: string[], manifestJson: string): Captured {
  const captured: Captured = { out: [], err: [] };
  const deps: SlotsDeps = {
    cwd: '/repo',
    readText: (path: string) => {
      if (path === '/repo/harness.manifest.json') return manifestJson;
      throw new Error(`unexpected read: ${path}`);
    },
    stdout: { log: (m: string) => captured.out.push(m) },
    stderr: { error: (m: string) => captured.err.push(m) },
    exit: (code: number): never => {
      captured.exit = code;
      throw new Error(`exit ${code}`);
    },
    argv,
  };
  try {
    main(deps);
  } catch {
    // exit() throws to short-circuit; ignore here.
  }
  return captured;
}

describe('slots CLI', () => {
  test('rowsFromManifest maps each slot to a table row', () => {
    const rows = rowsFromManifest(
      Object.fromEntries([
        slot('foo'),
        slot('bar', { required: false, decisionAt: 'docs/adrs/ADR-0002-inspector.md' }),
      ]),
    );
    expect(rows).toEqual([
      {
        slot: 'foo',
        plugin: 'reference-plugin',
        version: '1.2.3',
        required: 'yes',
        adr: 'ADR-0001',
      },
      {
        slot: 'bar',
        plugin: 'reference-plugin',
        version: '1.2.3',
        required: 'no',
        adr: 'ADR-0002',
      },
    ]);
  });

  test('rowsFromManifest handles missing version and ADR', () => {
    const rows = rowsFromManifest(
      Object.fromEntries([slot('untagged', { version: undefined, decisionAt: undefined })]),
    );
    expect(rows[0]?.version).toBe('');
    expect(rows[0]?.adr).toBe('');
  });

  test('rowsFromManifest falls back to the filename when ADR path does not match', () => {
    const rows = rowsFromManifest(
      Object.fromEntries([slot('quirk', { decisionAt: 'docs/standard/decisions/quirk.md' })]),
    );
    expect(rows[0]?.adr).toBe('quirk.md');
  });

  test('rowsFromManifest accepts a bare ADR id without a slash', () => {
    const rows = rowsFromManifest(
      Object.fromEntries([slot('bare', { decisionAt: 'ADR-0007-agent-plugins.md' })]),
    );
    expect(rows[0]?.adr).toBe('ADR-0007');
  });

  test('renderTable produces a stable header + ruler + body shape', () => {
    const lines = renderTable([
      { slot: 'a', plugin: 'p1', version: 'v1', required: 'yes', adr: 'ADR-0001' },
      { slot: 'bb', plugin: 'pp2', version: 'vv2', required: 'no', adr: 'ADR-0002' },
    ]);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/slot.*plugin.*version.*required.*ADR/);
    expect(lines[1]).toMatch(/----.*----.*----/);
    expect(lines[2]).toContain('a');
    expect(lines[3]).toContain('bb');
  });

  test('main renders a human-readable table with the project name in the headline', () => {
    const m = manifest([slot('one'), slot('two', { required: false, plugin: 'none' })]);
    const captured = runMain([], m);
    expect(captured.exit).toBeUndefined();
    expect(captured.out[0]).toContain('test-project v0.1.0');
    expect(captured.out.some((l) => l.includes('one') && l.includes('reference-plugin'))).toBe(
      true,
    );
    expect(captured.out.some((l) => l.includes('two') && l.includes('none'))).toBe(true);
    expect(captured.out.some((l) => l.includes('To swap a plugin'))).toBe(true);
    expect(captured.out.some((l) => l.includes('docs/slot-contracts.md'))).toBe(true);
  });

  test('main emits machine-readable JSON when --json is set', () => {
    const m = manifest([slot('alpha')]);
    const captured = runMain(['--json'], m);
    expect(captured.exit).toBeUndefined();
    const parsed = JSON.parse(captured.out.join('\n')) as { slots: unknown[] };
    expect(Array.isArray(parsed.slots)).toBe(true);
    expect(parsed.slots).toHaveLength(1);
  });

  test('main exits 1 when readText throws', () => {
    const captured: Captured = { out: [], err: [] };
    const deps: SlotsDeps = {
      cwd: '/repo',
      readText: () => {
        throw new Error('boom');
      },
      stdout: { log: (m: string) => captured.out.push(m) },
      stderr: { error: (m: string) => captured.err.push(m) },
      exit: (code: number): never => {
        captured.exit = code;
        throw new Error(`exit ${code}`);
      },
      argv: [],
    };
    expect(() => main(deps)).toThrow('exit 1');
    expect(captured.err[0]).toContain('boom');
  });

  test('main exits 1 when readText throws a non-Error value', () => {
    const captured: Captured = { out: [], err: [] };
    const deps: SlotsDeps = {
      cwd: '/repo',
      readText: () => {
        throw 'plain failure';
      },
      stdout: { log: (m: string) => captured.out.push(m) },
      stderr: { error: (m: string) => captured.err.push(m) },
      exit: (code: number): never => {
        captured.exit = code;
        throw new Error(`exit ${code}`);
      },
      argv: [],
    };
    expect(() => main(deps)).toThrow('exit 1');
    expect(captured.err[0]).toContain('plain failure');
  });

  test('main falls back to a generic headline when manifest omits name/version', () => {
    const captured = runMain([], JSON.stringify({ slots: { lone: { ...baseSlot } } }));
    expect(captured.out[0]).toBe('Harness composition (read from harness.manifest.json):');
  });

  test('main exits 1 on invalid JSON via the surfaced loader error', () => {
    const captured = runMain([], '{');
    expect(captured.exit).toBe(1);
    expect(captured.err[0]).toContain('harness.manifest.json is not valid JSON');
  });

  test('main tolerates a manifest with no slots property', () => {
    const captured = runMain([], JSON.stringify({ name: 'empty', version: '0.0.0' }));
    expect(captured.exit).toBeUndefined();
    expect(captured.out[0]).toContain('empty v0.0.0');
  });
});
