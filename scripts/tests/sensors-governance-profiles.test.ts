// scripts/tests/sensors-governance-profiles.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  PERF_GATE_OWNED_ADAPTERS,
  parseProfiles,
  strictRequiredAdapters,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

describe('shipped governance profiles', () => {
  const toml = readFileSync('harness/.harness/governance.toml', 'utf8');
  const profiles = parseProfiles(toml);

  test('strict requires every known adapter except perf-gate-owned ones', () => {
    // ADR-0028 carve-out: hyperfine-perf is owned by the dedicated
    // harness/perf/gate.mjs, so strict does NOT require it even though it is
    // a known adapter. The declared strict list must match strictRequiredAdapters().
    expect(new Set(profiles.strict.required_adapters)).toEqual(strictRequiredAdapters());
    expect(profiles.strict.required_adapters).not.toContain('hyperfine-perf');
    expect([...PERF_GATE_OWNED_ADAPTERS]).toContain('hyperfine-perf');
  });

  test('local requires only the zero-dep adapters', () => {
    // `local` must keep working where APSS genuinely is not installed: a
    // fresh clone, and the CI jobs that run `pnpm qa` (workspace-qa,
    // fork-check, scaffolder-fork-check) without installing it. Requiring
    // apss-topology here failed exactly those three.
    expect(new Set(profiles.local.required_adapters)).toEqual(
      new Set(['deadcode', 'cruiser-coupling', 'complexity']),
    );
  });

  test('dev is local plus apss-topology, and is what the pre-push hook runs', () => {
    // apss-topology is the ONLY source of the MT01 max-cognitive /
    // max-cyclomatic readings. While the hook ran `local` those metrics went
    // unmeasured locally, so complexity regressions reached CI green.
    expect(new Set(profiles.dev.required_adapters)).toEqual(
      new Set([...profiles.local.required_adapters, 'apss-topology']),
    );
  });

  test('dev does not require the adapters with no zero-cost path', () => {
    // These each cost an install too, but none is the sole source of an
    // otherwise-unmeasured enforced metric, so none earns the onboarding cost.
    for (const adapter of ['sentrux', 'ubs-security', 'coverage', 'suite-duration', 'license']) {
      expect(profiles.dev.required_adapters).not.toContain(adapter);
    }
  });
});
