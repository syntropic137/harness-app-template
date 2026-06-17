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
});
