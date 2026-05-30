import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.js';

describe('@harness/stack public API surface', () => {
  it('re-exports runtime, topology namespaces + defineHarnessConfig', () => {
    expect(pkg.runtime).toBeDefined();
    expect(typeof pkg.runtime).toBe('object');
    expect(pkg.topology).toBeDefined();
    expect(typeof pkg.topology).toBe('object');
    expect(typeof pkg.defineHarnessConfig).toBe('function');
  });

  it('defineHarnessConfig parses + returns the config (smoke)', () => {
    const cfg = pkg.defineHarnessConfig({ services: {}, bugToggles: [] });
    expect(cfg.services).toEqual({});
    expect(cfg.bugToggles).toEqual([]);
  });
});
