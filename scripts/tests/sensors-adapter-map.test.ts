// scripts/tests/sensors-adapter-map.test.ts
import { describe, expect, test } from 'vitest';
import {
  FITNESS_METRICS,
  KNOWN_ADAPTERS,
  metricAdapter,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

describe('metric → adapter map', () => {
  test('every metric declares a known adapter', () => {
    for (const [code, metrics] of Object.entries(
      FITNESS_METRICS as Record<string, Record<string, unknown>[]>,
    )) {
      for (const m of metrics) {
        expect(typeof m['adapter'], `${code}.${String(m['id'])} missing adapter`).toBe('string');
        expect(
          KNOWN_ADAPTERS.has(m['adapter']),
          `${code}.${String(m['id'])} adapter '${String(m['adapter'])}' not in KNOWN_ADAPTERS`,
        ).toBe(true);
      }
    }
  });

  test('metricAdapter resolves a known metric and returns null for unknown', () => {
    expect(metricAdapter('MT01', 'sentrux-god-file-count')).toBe('sentrux');
    expect(metricAdapter('MT01', 'nope')).toBeNull();
  });

  test('metricAdapter spot-checks: complexity, cruiser-coupling, coverage adapters', () => {
    // complexity adapter
    expect(metricAdapter('MT01', 'max-cognitive')).toBe('complexity');
    // cruiser-coupling adapter
    expect(metricAdapter('MD01', 'max-main-sequence-distance')).toBe('cruiser-coupling');
    // coverage adapter
    expect(metricAdapter('CV01', 'rust-line-coverage-pct')).toBe('coverage');
  });
});
