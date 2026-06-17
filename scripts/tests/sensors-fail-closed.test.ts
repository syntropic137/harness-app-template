// scripts/tests/sensors-fail-closed.test.ts
import { describe, expect, test } from 'vitest';
import {
  compareFitnessBaseline,
  gate,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

// Minimal report: a god-file metric (adapter 'sentrux', enforced MT01) with
// NO current reading, against a baseline that has a number. Returns whatever
// extractApssFitnessBaseline produces; we drive the null by omitting sentrux data.
function reportWithNoSentrux() {
  return {}; // no .sentrux envelope → sentrux metrics read null
}
function baselineWithGodFileFloor() {
  return {
    dimensions: {
      MT01: { metrics: { 'sentrux-god-file-count': { baseline: 0 } } },
    },
  };
}

const strict = { name: 'strict', requiredAdapters: new Set(['sentrux']) };
// lean: no adapters required — verifies that an absent non-required adapter goes to skipped,
// not failedMissing, and ok stays true.
const lean = { name: 'local', requiredAdapters: new Set<string>() };

function baselineWithNullSentrux() {
  return {
    dimensions: {
      MT01: { metrics: { 'sentrux-god-file-count': { baseline: null } } },
    },
  };
}

describe('fail-closed four-state', () => {
  test('strict + required adapter missing → FAIL + failedMissing populated', () => {
    const r = compareFitnessBaseline(baselineWithGodFileFloor(), reportWithNoSentrux(), {
      profile: strict,
    });
    expect(r.ok).toBe(false);
    // biome-ignore lint/suspicious/noExplicitAny: plain ESM gate; no .d.ts
    expect(r.failedMissing.some((f: any) => f.adapter === 'sentrux')).toBe(true);
  });

  test('lean + same adapter NOT required → PASS + skipped populated', () => {
    const r = compareFitnessBaseline(baselineWithGodFileFloor(), reportWithNoSentrux(), {
      profile: lean,
    });
    expect(r.ok).toBe(true);
    // biome-ignore lint/suspicious/noExplicitAny: plain ESM gate; no .d.ts
    expect(r.skipped.some((s: any) => s.adapter === 'sentrux')).toBe(true);
    expect(r.failedMissing.length).toBe(0);
  });

  // Regression guard for ADR-0028 hollow-pass fix: a required adapter with BOTH
  // baseline=null AND current=null (fresh-clone scenario, tool never ran) must
  // still produce ok===false. The defect in e318d88 gated requiredMissing on
  // hasBaseline, letting the both-null case fall through to a silent pass.
  test('strict + required adapter missing with null baseline → FAIL (both-null hollow-pass guard)', () => {
    const r = compareFitnessBaseline(baselineWithNullSentrux(), reportWithNoSentrux(), {
      profile: strict,
    });
    expect(r.ok).toBe(false);
    // biome-ignore lint/suspicious/noExplicitAny: plain ESM gate; no .d.ts
    expect(r.failedMissing.some((f: any) => f.adapter === 'sentrux')).toBe(true);
  });
});

// CRITICAL regression: --policy=none --profile=strict must NOT be fail-open.
// Previously, --policy=none skipped resolveProfile entirely, making strict a no-op.
describe('--policy=none --profile=strict fail-closed regression', () => {
  function ioStub(files: Record<string, string>) {
    const out: string[] = [];
    const err: string[] = [];
    return {
      io: {
        read: async () => '{}',
        write: (s: string) => out.push(s),
        writeErr: (s: string) => err.push(s),
        readFile: (p: string) => files[p] ?? '',
        writeFile: () => {},
        fileExists: (p: string) => p in files,
        env: {},
      },
      out,
      err,
    };
  }

  test('--policy=none --profile=strict with missing required adapter → exit 1 (hole closed)', async () => {
    // Use a baseline with dimensions so we reach the comparison path.
    // Strict enforcement must fire even when policy=none.
    const baselineJson = JSON.stringify({
      folders: {},
      dimensions: {
        MT01: { metrics: { 'sentrux-god-file-count': { baseline: 0 } } },
      },
    });
    const { io, out, err } = ioStub({
      'harness/sensors/baseline.json': baselineJson,
    });
    const code = await gate({
      argv: ['--policy=none', '--profile=strict', '--baseline-reference=none'],
      io,
    });
    // Must FAIL: strict profile requires sentrux but it produced no reading
    expect(code).toBe(1);
    const combined = out.join('') + err.join('');
    // Either VERDICT: FAIL (in comparison path) or MISSING REQUIRED
    expect(combined).toMatch(/VERDICT: FAIL|MISSING REQUIRED|refusing to write/);
  });

  // IMPORTANT 3: baseline-write guard test
  test('--update-baseline + strict profile refuses to write when required adapter missing', async () => {
    const baselineJson = JSON.stringify({
      folders: {},
      dimensions: {
        MT01: { metrics: { 'sentrux-god-file-count': { baseline: 0 } } },
      },
    });
    const writes: string[] = [];
    const err: string[] = [];
    const ioWithWrites = {
      read: async () => '{}',
      write: () => {},
      writeErr: (s: string) => err.push(s),
      readFile: (p: string) => ({ 'harness/sensors/baseline.json': baselineJson })[p] ?? '',
      writeFile: (p: string, _s: string) => writes.push(p),
      fileExists: (p: string) => p === 'harness/sensors/baseline.json',
      env: {},
    };
    const code = await gate({
      argv: ['--policy=none', '--profile=strict', '--update-baseline', '--baseline-reference=none'],
      io: ioWithWrites,
    });
    // Must refuse to write (exit 1) with a clear error
    expect(code).toBe(1);
    expect(writes.length).toBe(0); // baseline must NOT be written
    expect(err.join('')).toMatch(/refusing to write baseline/);
  });
});
