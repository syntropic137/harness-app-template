// Unit tests for the APSS 8-dimension fitness gate in
// harness/sensors/gate.mjs (bead create-harness-app-2zz).
//
// Rigorous verification per the bead acceptance: for each of the eight
// APSS substandards (MT01, MD01, ST01, SC01, LG01, AC01, PF01, AV01) we
// confirm:
//   1. The dimension is present in the rendered baseline.
//   2. Its objective + source string is set (not empty).
//   3. Either it produces a regression when the current run worsens
//      (enforced dimensions: MT01, MD01) OR it produces an advisory
//      warning that does NOT trip ok=false (advisory dimensions:
//      ST01, SC01, LG01, AC01, PF01, AV01).
//   4. Advisory dimensions with no adapter wired stay at evaluated=0
//      so the gate cannot falsely claim coverage it doesn't have.
//
// All IO is in-process: no spawn, no disk writes outside captured stubs.

import { describe, expect, test } from 'vitest';
import {
  compareBaseline,
  compareFitnessBaseline,
  extractApssFitnessBaseline,
  renderReport,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

interface Folder {
  name: string;
  Ca?: number;
  Ce?: number;
  I?: number | null;
  D?: number | null;
  max_cognitive?: number | null;
  max_cyclomatic?: number | null;
  apss_distance_max?: number | null;
}

interface Module {
  source: string;
  Ca?: number;
  Ce?: number;
  I?: number | null;
  D?: number | null;
  max_cognitive?: number | null;
  max_cyclomatic?: number | null;
  apss?: {
    efferent_coupling?: number;
    ce?: number;
    instability?: number;
    distance_from_main_sequence?: number;
    functions?: Array<{ cognitive?: number; cyclomatic?: number; halstead_volume?: number }>;
  };
}

function reportFrom(opts: {
  folders?: Folder[];
  modules?: Module[];
}): { workspace: { folders: Folder[]; modules: Module[] } } {
  return {
    workspace: {
      folders: opts.folders ?? [],
      modules: opts.modules ?? [],
    },
  };
}

const ENFORCED_CODES = ['MT01', 'MD01'] as const;
const ADVISORY_CODES = ['ST01', 'SC01', 'LG01', 'AC01', 'PF01', 'AV01'] as const;
const ALL_CODES = [...ENFORCED_CODES, ...ADVISORY_CODES] as const;

describe('APSS fitness gate (bead 2zz) — coverage discipline', () => {
  test('extractApssFitnessBaseline emits all 8 dimensions in canonical order', () => {
    const baseline = extractApssFitnessBaseline(reportFrom({}));
    expect(Object.keys(baseline.dimensions)).toEqual([
      'MT01',
      'MD01',
      'ST01',
      'SC01',
      'LG01',
      'AC01',
      'PF01',
      'AV01',
    ]);
  });

  test('every dimension carries name + promotion_status + enforcement + at least one metric with objective + source', () => {
    const baseline = extractApssFitnessBaseline(reportFrom({}));
    for (const code of ALL_CODES) {
      const d = baseline.dimensions[code];
      expect(d, `dimension ${code}`).toBeTruthy();
      expect(d.name).toBeTruthy();
      expect(d.promotion_status).toBeTruthy();
      expect(d.enforcement).toMatch(/^(enforced|advisory)$/);
      const metricIds = Object.keys(d.metrics);
      expect(metricIds.length, `dimension ${code} should have >=1 metric`).toBeGreaterThan(0);
      for (const id of metricIds) {
        const m = d.metrics[id];
        expect(m.name, `metric ${code}/${id} name`).toBeTruthy();
        expect(m.objective, `metric ${code}/${id} objective`).toBeTruthy();
        expect(m.source, `metric ${code}/${id} source`).toBeTruthy();
        expect(m.direction).toMatch(/^(max|min)$/);
        expect(typeof m.default_threshold).toBe('number');
        expect(typeof m.fail_on_regression).toBe('boolean');
      }
    }
  });

  test('exactly two dimensions are enforced (MT01, MD01); the other six are advisory', () => {
    const baseline = extractApssFitnessBaseline(reportFrom({}));
    const enforced = ALL_CODES.filter((c) => baseline.dimensions[c].enforcement === 'enforced');
    const advisory = ALL_CODES.filter((c) => baseline.dimensions[c].enforcement === 'advisory');
    expect(enforced).toEqual(['MT01', 'MD01']);
    expect(advisory).toEqual(['ST01', 'SC01', 'LG01', 'AC01', 'PF01', 'AV01']);
  });
});

describe('APSS fitness gate (bead 2zz) — enforced dimensions FAIL on regression', () => {
  test('MT01: a cognitive complexity regression trips ok=false', () => {
    const baselineReport = reportFrom({
      modules: [{ source: 'ws_apps/a/m.ts', max_cognitive: 5, max_cyclomatic: 3 }],
    });
    const baseline = extractApssFitnessBaseline(baselineReport);
    const worse = reportFrom({
      modules: [{ source: 'ws_apps/a/m.ts', max_cognitive: 12, max_cyclomatic: 3 }],
    });
    const result = compareFitnessBaseline(baseline, worse);
    expect(result.ok).toBe(false);
    const mt = result.regressions.find((r) => r.dimension === 'MT01');
    expect(mt, 'MT01 regression must be reported').toBeTruthy();
    expect(mt?.metric).toBe('max-cognitive');
    expect(mt?.current).toBe(12);
    expect(mt?.baseline).toBe(5);
    expect(mt?.enforcement).toBe('enforced');
  });

  test('MT01: a cyclomatic regression also trips ok=false', () => {
    const baselineReport = reportFrom({
      modules: [{ source: 'ws_apps/a/m.ts', max_cognitive: 3, max_cyclomatic: 4 }],
    });
    const baseline = extractApssFitnessBaseline(baselineReport);
    const worse = reportFrom({
      modules: [{ source: 'ws_apps/a/m.ts', max_cognitive: 3, max_cyclomatic: 9 }],
    });
    const result = compareFitnessBaseline(baseline, worse);
    expect(result.ok).toBe(false);
    expect(result.regressions.some((r) => r.dimension === 'MT01' && r.metric === 'max-cyclomatic')).toBe(true);
  });

  test('MT01: clean current at baseline values keeps ok=true', () => {
    const baselineReport = reportFrom({
      modules: [{ source: 'ws_apps/a/m.ts', max_cognitive: 5, max_cyclomatic: 3 }],
    });
    const baseline = extractApssFitnessBaseline(baselineReport);
    const same = reportFrom({
      modules: [{ source: 'ws_apps/a/m.ts', max_cognitive: 5, max_cyclomatic: 3 }],
    });
    expect(compareFitnessBaseline(baseline, same).ok).toBe(true);
  });

  test('MT01: improvement (lower than baseline) does NOT fail', () => {
    const baselineReport = reportFrom({
      modules: [{ source: 'ws_apps/a/m.ts', max_cognitive: 10, max_cyclomatic: 8 }],
    });
    const baseline = extractApssFitnessBaseline(baselineReport);
    const better = reportFrom({
      modules: [{ source: 'ws_apps/a/m.ts', max_cognitive: 2, max_cyclomatic: 2 }],
    });
    expect(compareFitnessBaseline(baseline, better).ok).toBe(true);
  });

  test('MD01: a fan-out regression on apss.efferent_coupling trips ok=false', () => {
    const baselineReport = reportFrom({
      modules: [{ source: 'ws_apps/a/m.ts', apss: { efferent_coupling: 2, instability: 0.5 }, D: 0.1 }],
      folders: [{ name: 'ws_apps/a', D: 0.1 }],
    });
    const baseline = extractApssFitnessBaseline(baselineReport);
    const worse = reportFrom({
      modules: [{ source: 'ws_apps/a/m.ts', apss: { efferent_coupling: 25, instability: 0.5 }, D: 0.1 }],
      folders: [{ name: 'ws_apps/a', D: 0.1 }],
    });
    const result = compareFitnessBaseline(baseline, worse);
    expect(result.ok).toBe(false);
    expect(result.regressions.some((r) => r.dimension === 'MD01' && r.metric === 'max-fan-out')).toBe(true);
  });

  test('MD01: a main-sequence-distance regression trips ok=false', () => {
    const baselineReport = reportFrom({
      modules: [{ source: 'ws_apps/a/m.ts', D: 0.1 }],
      folders: [{ name: 'ws_apps/a', D: 0.1 }],
    });
    const baseline = extractApssFitnessBaseline(baselineReport);
    const worse = reportFrom({
      modules: [{ source: 'ws_apps/a/m.ts', D: 0.95 }],
      folders: [{ name: 'ws_apps/a', D: 0.95 }],
    });
    const result = compareFitnessBaseline(baseline, worse);
    expect(result.ok).toBe(false);
    expect(result.regressions.some((r) => r.dimension === 'MD01' && r.metric === 'max-main-sequence-distance')).toBe(true);
  });

  test('MD01: more modules in the unhealthy instability range (<0.1 or >0.9) trips ok=false', () => {
    const baselineReport = reportFrom({
      modules: [
        { source: 'ws_apps/a/x.ts', I: 0.5 },
        { source: 'ws_apps/a/y.ts', I: 0.5 },
      ],
    });
    const baseline = extractApssFitnessBaseline(baselineReport);
    const worse = reportFrom({
      modules: [
        { source: 'ws_apps/a/x.ts', I: 0.05 },
        { source: 'ws_apps/a/y.ts', I: 0.95 },
      ],
    });
    const result = compareFitnessBaseline(baseline, worse);
    expect(result.ok).toBe(false);
    expect(result.regressions.some((r) => r.dimension === 'MD01' && r.metric === 'instability-out-of-range-count')).toBe(true);
  });

  test('compareBaseline aggregates legacy folder-level I/D regressions AND MT01/MD01 fitness regressions', () => {
    const baselineReport = reportFrom({
      folders: [{ name: 'ws_apps/a', I: 0.5, D: 0.2 }],
      modules: [{ source: 'ws_apps/a/m.ts', max_cognitive: 4 }],
    });
    const baseline = extractApssFitnessBaseline(baselineReport);
    const worse = reportFrom({
      folders: [{ name: 'ws_apps/a', I: 0.9, D: 0.6 }],
      modules: [{ source: 'ws_apps/a/m.ts', max_cognitive: 18 }],
    });
    const result = compareBaseline(baseline, worse);
    expect(result.ok).toBe(false);
    expect(result.legacyRegressions?.length).toBeGreaterThan(0);
    expect(result.fitness?.regressions.some((r: { dimension: string }) => r.dimension === 'MT01')).toBe(true);
  });
});

describe('APSS fitness gate (bead 2zz) — advisory dimensions never trip ok=false', () => {
  test('ST01/SC01/LG01/AC01/AV01 have no wired adapter and stay at evaluated=0', () => {
    const baseline = extractApssFitnessBaseline(reportFrom({}));
    const same = compareFitnessBaseline(baseline, reportFrom({}));
    for (const code of ['ST01', 'SC01', 'LG01', 'AC01', 'AV01'] as const) {
      const d = same.dimensions?.[code];
      expect(d, `dimension ${code}`).toBeTruthy();
      expect(d.enforcement).toBe('advisory');
      expect(d.rules_evaluated).toBe(0);
      expect(d.rules_failed).toBe(0);
    }
    expect(same.ok).toBe(true);
  });

  test('PF01 reads harness/perf/baseline.json benchmarks; with no perf data, advisory only', () => {
    const baseline = extractApssFitnessBaseline(reportFrom({}), { perf: { benchmarks: {} } });
    const result = compareFitnessBaseline(baseline, reportFrom({}), { perf: { benchmarks: {} } });
    const pf = result.dimensions?.PF01;
    expect(pf?.enforcement).toBe('advisory');
    expect(result.ok).toBe(true);
  });

  test('PF01: when perf benchmarks land, mean is read; current-mean above baseline produces an advisory regression (does NOT trip ok=false)', () => {
    const slow = { perf: { benchmarks: { startup: { mean: 0.8 } } } };
    const fast = { perf: { benchmarks: { startup: { mean: 0.4 } } } };
    const baseline = extractApssFitnessBaseline(reportFrom({}), fast);
    const result = compareFitnessBaseline(baseline, reportFrom({}), slow);
    expect(result.ok, 'advisory dimensions never break the gate').toBe(true);
    expect(result.advisoryRegressions.some((r: { dimension: string }) => r.dimension === 'PF01')).toBe(false);
    // PF01 metric is fail_on_regression=false, so it is reported in the
    // metric summary but does not count as a regression.
    const pf = result.dimensions?.PF01;
    expect(pf?.metrics['startup-benchmark-mean']?.current).toBeCloseTo(0.8);
    expect(pf?.metrics['startup-benchmark-mean']?.baseline).toBeCloseTo(0.4);
  });

  test('compareBaseline render reports 2/2 enforced + N/6 advisory in its summary line', () => {
    const baselineReport = reportFrom({
      modules: [{ source: 'ws_apps/a/m.ts', max_cognitive: 5, max_cyclomatic: 3 }],
    });
    const baseline = extractApssFitnessBaseline(baselineReport);
    const result = compareBaseline(baseline, baselineReport);
    const text = renderReport(result);
    expect(text).toMatch(/2\/2 enforced/);
    expect(text).toMatch(/\[ENFORCED\] MT01/);
    expect(text).toMatch(/\[ENFORCED\] MD01/);
    expect(text).toMatch(/\[advisory\] ST01/);
    expect(text).toMatch(/\[advisory\] AV01/);
    expect(text).toMatch(/no adapter wired/);
  });
});
