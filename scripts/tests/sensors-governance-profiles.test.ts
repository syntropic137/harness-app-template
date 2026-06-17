// scripts/tests/sensors-governance-profiles.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  KNOWN_ADAPTERS,
  parseProfiles,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

describe('shipped governance profiles', () => {
  const toml = readFileSync('harness/.harness/governance.toml', 'utf8');
  const profiles = parseProfiles(toml);

  test('strict requires every known adapter', () => {
    expect(new Set(profiles.strict.required_adapters)).toEqual(new Set(KNOWN_ADAPTERS));
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
