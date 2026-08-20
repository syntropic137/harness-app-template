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

  test('local requires the zero-dep adapters plus apss-topology', () => {
    expect(new Set(profiles.local.required_adapters)).toEqual(
      new Set(['deadcode', 'cruiser-coupling', 'complexity', 'apss-topology']),
    );
  });

  test('local requires apss-topology, the only source of the MT01 readings', () => {
    // Regression guard for the reason this was changed: while apss-topology
    // was optional locally, max-cognitive / max-cyclomatic were simply not
    // measured on a developer machine, so complexity regressions pushed green
    // and were caught only by CI's --profile=strict run.
    expect(profiles.local.required_adapters).toContain('apss-topology');
  });

  test('local still does not require the adapters with no zero-cost path', () => {
    // These need a separate install and have no MT01-style enforcement gap
    // justifying the onboarding cost; they stay skipped-loud when absent.
    for (const adapter of ['sentrux', 'ubs-security', 'coverage', 'suite-duration', 'license']) {
      expect(profiles.local.required_adapters).not.toContain(adapter);
    }
  });
});
