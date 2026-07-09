// scripts/tests/sensors-degraded-output.test.ts
import { describe, expect, test } from 'vitest';
import {
  renderReport,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

// biome-ignore lint/suspicious/noExplicitAny: test helper accepting arbitrary overrides for plain-ESM gate module with no type declarations
function baseComparison(overrides: any) {
  return {
    ok: true,
    regressions: [],
    advisoryRegressions: [],
    summary: { comparedFolders: 0, newFolders: [], removedFolders: [] },
    skipped: [],
    failedMissing: [],
    ...overrides,
  };
}

describe('degraded output contract', () => {
  test('prints a DEGRADED line listing skipped adapters', () => {
    const text = renderReport(
      baseComparison({
        skipped: [
          {
            dimension: 'MT01',
            metric: 'sentrux-god-file-count',
            adapter: 'sentrux',
            profile: 'local',
          },
          {
            dimension: 'MT01',
            metric: 'max-cognitive',
            adapter: 'apss-topology',
            profile: 'local',
          },
        ],
      }),
    );
    expect(text).toMatch(/DEGRADED: 2 adapter\(s\) skipped/);
    expect(text).toContain('sentrux');
    expect(text).toContain('apss-topology');
  });

  test('prints a MISSING REQUIRED line on hard-fail', () => {
    const text = renderReport(
      baseComparison({
        ok: false,
        failedMissing: [
          {
            dimension: 'MT01',
            metric: 'sentrux-god-file-count',
            adapter: 'sentrux',
            profile: 'strict',
          },
        ],
      }),
    );
    expect(text).toMatch(/MISSING REQUIRED: 1 adapter\(s\)/);
    expect(text).toContain('sentrux');
  });

  // MINOR: count unique adapters, not per-metric records. Multiple metrics from
  // the same adapter should count as 1 adapter in the output.
  test('DEGRADED count uses unique adapters (not per-metric records)', () => {
    const text = renderReport(
      baseComparison({
        // 3 skipped records but only 2 distinct adapters
        skipped: [
          {
            dimension: 'MT01',
            metric: 'sentrux-god-file-count',
            adapter: 'sentrux',
            profile: 'local',
          },
          {
            dimension: 'MT01',
            metric: 'sentrux-quality-signal',
            adapter: 'sentrux',
            profile: 'local',
          },
          {
            dimension: 'MT01',
            metric: 'max-cognitive',
            adapter: 'apss-topology',
            profile: 'local',
          },
        ],
      }),
    );
    // 2 unique adapters (sentrux + apss-topology), not 3 metrics
    expect(text).toMatch(/DEGRADED: 2 adapter\(s\) skipped/);
    expect(text).toContain('sentrux');
    expect(text).toContain('apss-topology');
  });

  test('MISSING REQUIRED count uses unique adapters (not per-metric records)', () => {
    const text = renderReport(
      baseComparison({
        ok: false,
        // 2 metrics from the same adapter
        failedMissing: [
          {
            dimension: 'MT01',
            metric: 'sentrux-god-file-count',
            adapter: 'sentrux',
            profile: 'strict',
          },
          {
            dimension: 'MT01',
            metric: 'sentrux-quality-signal',
            adapter: 'sentrux',
            profile: 'strict',
          },
        ],
      }),
    );
    // 1 unique adapter (sentrux), not 2 metrics
    expect(text).toMatch(/MISSING REQUIRED: 1 adapter\(s\)/);
    expect(text).toContain('sentrux');
  });
});
