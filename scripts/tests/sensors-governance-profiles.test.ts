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
    expect(profiles.local.required_adapters).toHaveLength(3);
    expect(new Set(profiles.local.required_adapters)).toEqual(
      new Set(['deadcode', 'cruiser-coupling', 'complexity']),
    );
    expect(profiles.local.required_adapters).not.toContain('sentrux');
    expect(profiles.local.required_adapters).not.toContain('apss-topology');
  });
});
