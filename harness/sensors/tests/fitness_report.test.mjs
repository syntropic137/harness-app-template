// Tests for harness/sensors/fitness_report.mjs - the agent-facing
// READ-ONLY architectural-health surface.
//
// The report composes three pieces from gate.mjs (extractApssFitnessBaseline,
// FITNESS_METRICS metric defs, direction-aware comparison) into a flat
// per-dimension table with status tags PASS / AT-RISK / FAIL / SKIP. The
// tests below pin the composition contract:
//
//   1. classifyMetric: status taxonomy (FAIL = below floor; AT-RISK = at
//      or near floor; PASS = comfortable; SKIP = no reading).
//   2. headroom: direction-aware sign convention so an agent always
//      reads "+N" as "this much room before the gate fails".
//   3. buildReport: an empty-current-readings + populated baseline
//      pair yields a SKIP-heavy summary that nonetheless surfaces the
//      floors (the floors-only "quick" surface the pre-commit hook
//      uses).
//   4. buildReport: a synthetic readings shape that drives the MT01
//      cognitive metric below, at, and above the floor flips the
//      overall_status through PASS -> AT-RISK -> FAIL.
//   5. renderSummary: one line, always; surfaces the AT-RISK / FAIL
//      offenders by code/metric for grep-friendly hook output.
//
// Run via:
//   node --test harness/sensors/tests/fitness_report.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildReport,
  classifyMetric,
  headroom,
  renderJson,
  renderSummary,
  renderText,
} from '../fitness_report.mjs';

const MT01_METRIC_COUNT = 8;

function baselineWithMt01Cognitive(value) {
  // Minimal baseline shape - only what the comparator needs. The real
  // file is much larger but extractApssFitnessBaseline / buildReport
  // tolerate missing dimensions cleanly (they fall through to SKIP).
  return {
    dimensions: {
      MT01: {
        name: 'Maintainability',
        enforcement: 'enforced',
        metrics: {
          'max-cognitive': { baseline: value, direction: 'max' },
        },
      },
    },
  };
}

function reportWithCognitive(max) {
  // Shape that extractApssFitnessBaseline reads. The cognitive value
  // can flow in via apssFunctionValues (apss.functions[*].cognitive)
  // OR moduleValues (module.max_cognitive) - we use the module path
  // because it survives an empty topology snapshot.
  return {
    workspace: {
      folders: [],
      modules: [{ name: 'ws_apps/example/src', max_cognitive: max }],
    },
  };
}

test('headroom: direction-aware sign convention', () => {
  // max-direction (smaller is better): floor 8, current 5 -> +3 headroom.
  assert.equal(headroom('max', 5, 8), 3);
  // max-direction at floor exactly: 0 headroom.
  assert.equal(headroom('max', 8, 8), 0);
  // max-direction above floor: negative headroom (gate would fail).
  assert.equal(headroom('max', 9, 8), -1);
  // min-direction (larger is better): floor 0.5, current 0.8 -> +0.3.
  assert.equal(headroom('min', 0.8, 0.5).toFixed(2), '0.30');
  // Missing inputs -> null.
  assert.equal(headroom('max', null, 8), null);
  assert.equal(headroom('max', 8, undefined), null);
});

test('classifyMetric: SKIP when either floor or current is missing', () => {
  assert.equal(classifyMetric({ direction: 'max', current: null, floor: 8 }).status, 'SKIP');
  assert.equal(classifyMetric({ direction: 'max', current: 8, floor: null }).status, 'SKIP');
});

test('classifyMetric: FAIL when current is strictly worse than floor', () => {
  const r = classifyMetric({ direction: 'max', current: 9, floor: 8 });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.headroom, -1);
});

test('classifyMetric: PASS when comfortably better than floor', () => {
  const r = classifyMetric({ direction: 'max', current: 4, floor: 8 });
  assert.equal(r.status, 'PASS');
  assert.equal(r.headroom, 4);
});

test('classifyMetric: AT-RISK when at the floor on a non-zero floor', () => {
  const r = classifyMetric({ direction: 'max', current: 8, floor: 8 });
  assert.equal(r.status, 'AT-RISK');
  assert.equal(r.headroom, 0);
});

test('classifyMetric: floor==0 + current==0 is PASS, not AT-RISK', () => {
  // The metric is already at the theoretical minimum (count); calling
  // it AT-RISK on every commit would be noise. Both directions.
  assert.equal(classifyMetric({ direction: 'max', current: 0, floor: 0 }).status, 'PASS');
  assert.equal(classifyMetric({ direction: 'min', current: 0, floor: 0 }).status, 'PASS');
});

test('classifyMetric: AT-RISK band kicks in within ~10% of a non-zero floor', () => {
  // Floor 10, current 9.5: headroom 0.5 < band max(1, 1.0) = 1 -> AT-RISK.
  assert.equal(classifyMetric({ direction: 'max', current: 9.5, floor: 10 }).status, 'AT-RISK');
  // Floor 10, current 8.5: headroom 1.5 > band 1 -> PASS.
  assert.equal(classifyMetric({ direction: 'max', current: 8.5, floor: 10 }).status, 'PASS');
});

test('buildReport: empty current readings + populated baseline yields skip-heavy floors view', () => {
  const baseline = baselineWithMt01Cognitive(8);
  const report = buildReport({ baseline, currentReport: undefined });
  assert.equal(report.overall_status, 'PASS'); // No FAIL, no AT-RISK -> PASS.
  // MT01 has 8 metrics; only max-cognitive has a floor here, the rest
  // are SKIP both ways. Everything else in the dim-order list also
  // emits SKIP rows because there is no floor for them.
  const mt01 = report.dimensions.find((d) => d.code === 'MT01');
  assert.equal(mt01.metrics.length, MT01_METRIC_COUNT);
  // Skip-heavy summary tells the operator most adapters were not run.
  assert.ok(report.summary.skip > 0);
});

test('buildReport: synthetic readings drive MT01 PASS -> AT-RISK -> FAIL as current crosses the floor', () => {
  const baseline = baselineWithMt01Cognitive(8);

  const passReport = buildReport({
    baseline,
    currentReport: reportWithCognitive(4), // comfortably below floor
  });
  const mt01Pass = passReport.dimensions.find((d) => d.code === 'MT01');
  const cognitivePass = mt01Pass.metrics.find((m) => m.id === 'max-cognitive');
  assert.equal(cognitivePass.status, 'PASS');
  assert.equal(passReport.overall_status, 'PASS');

  const atRiskReport = buildReport({
    baseline,
    currentReport: reportWithCognitive(8), // exactly at the floor
  });
  const mt01Risk = atRiskReport.dimensions.find((d) => d.code === 'MT01');
  const cognitiveRisk = mt01Risk.metrics.find((m) => m.id === 'max-cognitive');
  assert.equal(cognitiveRisk.status, 'AT-RISK');
  assert.equal(atRiskReport.overall_status, 'AT-RISK');

  const failReport = buildReport({
    baseline,
    currentReport: reportWithCognitive(9), // one step above the floor
  });
  const mt01Fail = failReport.dimensions.find((d) => d.code === 'MT01');
  const cognitiveFail = mt01Fail.metrics.find((m) => m.id === 'max-cognitive');
  assert.equal(cognitiveFail.status, 'FAIL');
  assert.equal(failReport.overall_status, 'FAIL');
});

test('buildReport: advisory dimensions never raise overall_status', () => {
  // AC01 is advisory + opt-in. Even if it FAILed, the overall status
  // should not flip to FAIL on its account - enforced dims own the
  // ratchet authority.
  const baseline = {
    dimensions: {
      AC01: {
        name: 'Accessibility',
        enforcement: 'advisory',
        promotion_status: 'incubating',
        metrics: {
          'accessibility-violation-count': { baseline: 0, direction: 'max' },
        },
      },
    },
  };
  // Build a contrived report - AC01 has no real adapter in the
  // template, so the value extractor returns null. That keeps the
  // metric in SKIP and the overall stays PASS regardless.
  const report = buildReport({
    baseline,
    currentReport: { workspace: { folders: [], modules: [] } },
  });
  assert.equal(report.overall_status, 'PASS');
});

test('renderSummary: one line that surfaces the offending metric names for grep', () => {
  const baseline = baselineWithMt01Cognitive(8);
  const report = buildReport({
    baseline,
    currentReport: reportWithCognitive(9), // FAIL
  });
  const line = renderSummary(report);
  // No newlines: hook output is one line per renderSummary call.
  assert.equal(line.includes('\n'), false);
  // Tagged FAIL.
  assert.ok(line.includes('[FAIL]'));
  assert.ok(line.includes('FAIL'));
  // Names the offender by code/metric so an agent can grep it.
  assert.ok(line.includes('MT01/max-cognitive'));
  // Always points at the canonical full-report command.
  assert.ok(line.includes('just fitness'));
});

test('renderText: contains every dimension code and is non-empty for the floors-only view', () => {
  const baseline = baselineWithMt01Cognitive(8);
  const text = renderText(buildReport({ baseline, currentReport: undefined }));
  assert.ok(text.length > 0);
  for (const code of ['MT01', 'MD01', 'ST01', 'SC01', 'LG01', 'AC01', 'PF01', 'AV01']) {
    assert.ok(text.includes(code), `expected ${code} in text output`);
  }
  // Header lists the four status buckets.
  assert.ok(text.includes('overall:'));
  assert.ok(text.includes('pass'));
  assert.ok(text.includes('at-risk'));
  assert.ok(text.includes('fail'));
  assert.ok(text.includes('skip'));
});

test('renderJson: stable schema_version and shape for agent consumers', () => {
  const baseline = baselineWithMt01Cognitive(8);
  const json = renderJson(buildReport({ baseline, currentReport: reportWithCognitive(4) }));
  const parsed = JSON.parse(json);
  assert.equal(parsed.schema_version, '1.0.0');
  assert.equal(parsed.overall_status, 'PASS');
  assert.ok(Array.isArray(parsed.dimensions));
  assert.ok(parsed.summary && typeof parsed.summary.pass === 'number');
});
