// scripts/tests/sensors-profile.test.ts
import { describe, expect, test } from 'vitest';
import {
  KNOWN_ADAPTERS,
  parseProfiles,
  resolveProfile,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

const TOML = `
[profiles.strict]
required_adapters = ["sentrux", "apss-topology", "ubs-security", "hyperfine-perf", "coverage", "deadcode", "cruiser-coupling", "complexity", "suite-duration", "license"]

[profiles.local]
required_adapters = ["deadcode", "cruiser-coupling", "complexity"]
`;

describe('profile resolution', () => {
  test('parses [profiles.*] tables', () => {
    const p = parseProfiles(TOML);
    expect(p.local.required_adapters).toContain('deadcode');
    expect(p.strict.required_adapters).toContain('sentrux');
  });

  test('resolves a named lean profile to its required set', () => {
    const r = resolveProfile({ profiles: parseProfiles(TOML), profileName: 'local' });
    expect(r.name).toBe('local');
    expect(r.requiredAdapters.has('deadcode')).toBe(true);
    expect(r.requiredAdapters.has('sentrux')).toBe(false);
  });

  test('strict with no table defaults to ALL known adapters (fail-safe)', () => {
    const r = resolveProfile({ profiles: {}, profileName: 'strict' });
    expect(r.requiredAdapters.size).toBe(KNOWN_ADAPTERS.size);
    for (const adapter of KNOWN_ADAPTERS) {
      expect(r.requiredAdapters.has(adapter), `strict default missing '${adapter}'`).toBe(true);
    }
  });

  test('unknown profile name throws', () => {
    expect(() => resolveProfile({ profiles: parseProfiles(TOML), profileName: 'bogus' })).toThrow(
      /unknown profile 'bogus'/,
    );
  });
});
