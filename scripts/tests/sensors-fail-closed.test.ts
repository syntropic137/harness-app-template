// scripts/tests/sensors-fail-closed.test.ts
import { describe, expect, test } from 'vitest';
import {
  compareFitnessBaseline,
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

  // Regression guard for ADR-0027 hollow-pass fix: a required adapter with BOTH
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
