// scripts/tests/sensors-profile.test.ts
import { describe, expect, test } from 'vitest';
import {
  KNOWN_ADAPTERS,
  PERF_GATE_OWNED_ADAPTERS,
  parseProfiles,
  resolveProfile,
  strictRequiredAdapters,
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

  test('strict with no table defaults to every known adapter except perf-gate-owned (fail-safe)', () => {
    const r = resolveProfile({ profiles: {}, profileName: 'strict' });
    expect(r.requiredAdapters).toEqual(strictRequiredAdapters());
    // Every non-perf-owned known adapter is required; the perf-owned ones are not.
    for (const adapter of KNOWN_ADAPTERS) {
      const expected = !PERF_GATE_OWNED_ADAPTERS.has(adapter);
      expect(r.requiredAdapters.has(adapter), `strict default '${adapter}'`).toBe(expected);
    }
    expect(r.requiredAdapters.has('hyperfine-perf')).toBe(false);
  });

  test('unknown profile name throws', () => {
    expect(() => resolveProfile({ profiles: parseProfiles(TOML), profileName: 'bogus' })).toThrow(
      /unknown profile 'bogus'/,
    );
  });

  test('explicit strict table is used (not fail-safe default)', () => {
    const r = resolveProfile({ profiles: parseProfiles(TOML), profileName: 'strict' });
    expect(r.name).toBe('strict');
    expect(r.requiredAdapters.has('sentrux')).toBe(true);
    expect(r.requiredAdapters.has('deadcode')).toBe(true);
    expect(r.requiredAdapters.size).toBe(10);
  });

  // IMPORTANT 2: fail-closed on typos in profile config
  test('parseProfiles throws on unknown adapter name (fail-closed typo guard)', () => {
    const badToml = '[profiles.custom]\nrequired_adapters = ["sentrx"]\n'; // "sentrx" is a typo
    expect(() => parseProfiles(badToml)).toThrow(/profile 'custom' lists unknown adapter 'sentrx'/);
  });

  test('parseProfiles throws on malformed TOML (fail-closed)', () => {
    expect(() => parseProfiles('[broken TOML{')).toThrow(/malformed TOML/);
  });

  // CRITICAL fix: --profile=none is the explicit opt-out sentinel, returns null
  test('resolveProfile returns null for profileName=none (explicit opt-out)', () => {
    const r = resolveProfile({ profiles: parseProfiles(TOML), profileName: 'none' });
    expect(r).toBeNull();
  });
});
