// Tests for the size-invariance principle recorded in
// ADR-0029-fitness-metric-size-invariance.md.
//
// The invariant, restated as a test (ADR-0029 § 3.6): every ENFORCING
// MD01 coupling metric must satisfy "adding a well-designed module does
// not change the verdict." A module with fan-out below the designed
// threshold, sitting on the Martin main sequence, must not trip the gate.
//
// Two mechanisms make this hold:
//   1. `ratchet_floor` clamps a per-module maximum's floor at its designed
//      threshold, so the floor never captures incidental headroom (a
//      fan-out floor of 2 against a designed 20 would fail the first real
//      feature module).
//   2. The growth-sensitive `sentrux-coupling-score` (a global composite
//      ratio) is removed from the enforced set entirely, so a clean
//      multi-module feature can never trip it.
//
// Run via: node --test harness/sensors/tests/size_invariance.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateBaselineRelaxationGuard } from '../baseline_guard.mjs';
import {
  compareBaseline,
  extractApssFitnessBaseline,
  FITNESS_METRICS,
  ratchetBaseline,
} from '../gate.mjs';

// A workspace report carrying explicit per-module Martin readings, the
// shape max-fan-out / max-main-sequence-distance / instability read.
function reportWithModules(modules) {
  return {
    workspace: {
      folders: [],
      modules: modules.map((m) => ({
        source: m.source,
        Ce: m.Ce ?? 0,
        I: m.I ?? null,
        D: m.D ?? null,
      })),
      circular_edges: 0,
    },
  };
}

// A single well-designed module: fan-out below the designed threshold,
// I=1.0 (a leaf/entrypoint) but sitting ON the main sequence (D=0).
function wellDesignedModule(source, fanOut) {
  return { source, Ce: fanOut, I: 1.0, D: 0.0 };
}

test('MD01 no longer enforces sentrux-coupling-score (growth-sensitive ratio removed)', () => {
  const ids = FITNESS_METRICS.MD01.map((m) => m.id);
  assert.ok(
    !ids.includes('sentrux-coupling-score'),
    'sentrux-coupling-score must not appear in the enforced MD01 metric set (ADR-0029 § 3)',
  );
  // The size-invariant coupling authority stays enforcing.
  assert.ok(ids.includes('max-fan-out'), 'max-fan-out remains the canonical coupling metric');
});

test('max-fan-out declares a ratchet_floor at its designed threshold', () => {
  const fanOut = FITNESS_METRICS.MD01.find((m) => m.id === 'max-fan-out');
  assert.equal(fanOut.ratchet_floor, fanOut.default_threshold);
  assert.equal(typeof fanOut.ratchet_floor, 'number');
  assert.ok(
    fanOut.ratchet_floor > 2,
    'ratchet_floor must be the designed threshold, not the incidental floor of 2',
  );
});

test('ratchetBaseline: a metric with ratchet_floor does NOT tighten below it (seed path)', () => {
  // A fresh baseline (no MD01 entry) seeded from a tiny workspace must NOT
  // pin the floor at the measured max of 2; it clamps at the designed
  // threshold so the first real feature module has headroom.
  const baseline = { schema_version: '1.0.0', folders: {}, dimensions: {} };
  const tiny = reportWithModules([wellDesignedModule('ws_apps/a/src', 2)]);
  const { next } = ratchetBaseline(baseline, tiny);
  const seeded = next.dimensions.MD01.metrics['max-fan-out'].baseline;
  const threshold = FITNESS_METRICS.MD01.find((m) => m.id === 'max-fan-out').ratchet_floor;
  assert.equal(seeded, threshold, `expected seeded floor to clamp at ${threshold}, got ${seeded}`);
});

test('ratchetBaseline: a metric with ratchet_floor does NOT tighten below it (tighten path)', () => {
  const baseline = {
    schema_version: '1.0.0',
    folders: {},
    dimensions: {
      MD01: {
        metrics: {
          'max-fan-out': {
            name: 'Maximum Efferent Coupling',
            direction: 'max',
            default_threshold: 20,
            ratchet_floor: 20,
            baseline: 20,
            fail_on_regression: true,
          },
        },
      },
    },
  };
  // Current measurement is a tiny peak of 2 — an "improvement" the ratchet
  // must clamp, not capture.
  const tiny = reportWithModules([wellDesignedModule('ws_apps/a/src', 2)]);
  const { next, tightenings } = ratchetBaseline(baseline, tiny);
  assert.equal(next.dimensions.MD01.metrics['max-fan-out'].baseline, 20);
  assert.ok(
    !tightenings.some((t) => t.metric === 'max-fan-out'),
    'a measured value below the clamped floor must not tighten max-fan-out',
  );
});

test('ratchetBaseline: below-threshold metrics without ratchet_floor still tighten (no regression)', () => {
  // Guard: the clamp is OPT-IN. max-cognitive (threshold 15, no ratchet_floor)
  // must still ratchet to its measured peak.
  const baseline = {
    schema_version: '1.0.0',
    folders: {},
    dimensions: {
      MT01: {
        metrics: {
          'max-cognitive': {
            name: 'Maximum Cognitive Complexity',
            direction: 'max',
            default_threshold: 15,
            baseline: 12,
            fail_on_regression: true,
          },
        },
      },
    },
  };
  // max-cognitive sources from complexity.mjs (module max_cognitive); APSS
  // function cognitive is interim-excluded pending the apss 0.3.0 fix.
  const better = {
    workspace: {
      folders: [],
      modules: [{ source: 'ws_apps/x/src/a.ts', max_cognitive: 5, max_cyclomatic: 2 }],
      circular_edges: 0,
    },
  };
  const { next } = ratchetBaseline(baseline, better);
  assert.equal(
    next.dimensions.MT01.metrics['max-cognitive'].baseline,
    5,
    'max-cognitive has no ratchet_floor, so it must still tighten to the measured peak of 5',
  );
});

// STAGED FOR PHASE B (issue #58): same no-ratchet_floor invariant, but the peak
// is surfaced through the APSS-function-value path (apss.functions[*].cognitive)
// restored for code-topology 0.3.0. Complements the complexity.mjs module-value
// coverage above; both sources are active once 0.3.0 is pinned.
test('ratchetBaseline: below-threshold max-cognitive still tightens via the APSS function path (0.3.0 source)', () => {
  const baseline = {
    schema_version: '1.0.0',
    folders: {},
    dimensions: {
      MT01: {
        metrics: {
          'max-cognitive': {
            name: 'Maximum Cognitive Complexity',
            direction: 'max',
            default_threshold: 15,
            baseline: 12,
            fail_on_regression: true,
          },
        },
      },
    },
  };
  // Peak surfaced ONLY through the APSS per-function array — no module max_*.
  const better = {
    workspace: {
      folders: [],
      modules: [{ source: 'ws_apps/x/src/lib.rs', apss: { functions: [{ cognitive: 5 }] } }],
      circular_edges: 0,
    },
  };
  const { next } = ratchetBaseline(baseline, better);
  assert.equal(
    next.dimensions.MT01.metrics['max-cognitive'].baseline,
    5,
    'max-cognitive must still tighten to the APSS function peak (5) with no ratchet_floor',
  );
});

test('the new-well-designed-module test: adding a clean module keeps the gate green', () => {
  // ADR-0029 § 3.6. Seed a baseline at the designed thresholds, then add a
  // well-designed module (fan-out = threshold - 1, on the main sequence).
  // The gate MUST stay green.
  const fanOutThreshold = FITNESS_METRICS.MD01.find((m) => m.id === 'max-fan-out').ratchet_floor;

  // Seed the baseline the way a fresh scaffold actually does: run the ratchet
  // over an empty baseline, so max-fan-out clamps at its designed threshold
  // (not the incidental measured peak of 1).
  const seedReport = reportWithModules([wellDesignedModule('ws_apps/existing/src', 1)]);
  const { next: baseline } = ratchetBaseline(
    { schema_version: '1.0.0', folders: {}, dimensions: {} },
    seedReport,
  );
  assert.equal(
    baseline.dimensions.MD01.metrics['max-fan-out'].baseline,
    fanOutThreshold,
    'sanity: fresh scaffold seeds the fan-out floor at the designed threshold',
  );

  // Now the "next commit": the existing module plus one impeccably-designed
  // new module importing (threshold - 1) packages.
  const grownReport = reportWithModules([
    wellDesignedModule('ws_apps/existing/src', 1),
    wellDesignedModule('ws_apps/feature/src', fanOutThreshold - 1),
  ]);

  const cmp = compareBaseline(baseline, grownReport);
  assert.equal(
    cmp.ok,
    true,
    `adding a well-designed module (fan-out ${fanOutThreshold - 1}) must not trip the gate; ` +
      `regressions: ${JSON.stringify(cmp.regressions)}`,
  );
});

test('the gate still catches genuine over-coupling above the threshold', () => {
  // The inverse guard: a module that actually exceeds the designed fan-out
  // policy MUST fail. Size-invariance is not "never fail".
  const fanOutThreshold = FITNESS_METRICS.MD01.find((m) => m.id === 'max-fan-out').ratchet_floor;
  const seedReport = reportWithModules([wellDesignedModule('ws_apps/existing/src', 1)]);
  const baseline = extractApssFitnessBaseline(seedReport);

  const overCoupled = reportWithModules([
    wellDesignedModule('ws_apps/existing/src', 1),
    wellDesignedModule('ws_apps/godmodule/src', fanOutThreshold + 5),
  ]);
  const cmp = compareBaseline(baseline, overCoupled);
  assert.equal(
    cmp.ok,
    false,
    'a module exceeding the designed fan-out threshold must fail the gate',
  );
  assert.ok(
    cmp.regressions.some((r) => r.metric === 'max-fan-out'),
    'expected a max-fan-out regression for the over-coupled module',
  );
});

// --- Baseline relaxation guard understands the two ADR-0029 operations ---

const MARKER = 'BASELINE-RELAX-OK';

function dimBaseline(metricId, metric, approvals = {}) {
  return {
    dimensions: { MD01: { metrics: { [metricId]: metric } } },
    _baseline_relaxation_approvals: approvals,
  };
}

test('guard: relaxing a floor UP to its ratchet_floor is allowed with a marker', () => {
  // origin/main floor was 2; the working baseline relaxes it to the designed
  // ratchet_floor of 20 — a value the current measurement (2) never reaches.
  const path = 'dimensions|MD01|max-fan-out';
  const working = dimBaseline(
    'max-fan-out',
    { direction: 'max', ratchet_floor: 20, baseline: 20 },
    { [path]: `${MARKER}: ADR-0029 clamp to designed threshold` },
  );
  const reference = dimBaseline('max-fan-out', { direction: 'max', baseline: 2 });
  // The generated (code-derived) baseline carries the trusted ratchet_floor.
  const generated = dimBaseline('max-fan-out', {
    direction: 'max',
    ratchet_floor: 20,
    baseline: 2,
  });
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(
    guard.ok,
    true,
    `expected guard PASS; violations: ${JSON.stringify(guard.violations)}`,
  );
});

test('guard: relaxing ABOVE the ratchet_floor without matching current is still blocked', () => {
  // Guard rail: the ratchet_floor is the only sanctioned relax target beyond
  // the current measurement. A floor of 50 (neither current=2 nor floor=20)
  // must still be rejected.
  const path = 'dimensions|MD01|max-fan-out';
  const working = dimBaseline(
    'max-fan-out',
    { direction: 'max', ratchet_floor: 20, baseline: 50 },
    { [path]: `${MARKER}: over-relaxed` },
  );
  const reference = dimBaseline('max-fan-out', { direction: 'max', baseline: 2 });
  // Even with the trusted ratchet_floor=20 declared in the generated baseline,
  // a working floor of 50 matches neither the floor nor the current (2).
  const generated = dimBaseline('max-fan-out', {
    direction: 'max',
    ratchet_floor: 20,
    baseline: 2,
  });
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(guard.ok, false, 'an arbitrary relax beyond the ratchet_floor must be blocked');
});

test('guard: a SPOOFED ratchet_floor in the working baseline cannot authorize a relax', () => {
  // Adversarial (Codex review): ratchet_floor must be read from the trusted
  // code-derived generated baseline, NOT the editable working file. Here the
  // working baseline invents ratchet_floor:15 for max-cognitive (which the
  // code does NOT declare) and relaxes the floor 5 -> 15 with a marker. The
  // guard must still block it because the generated baseline has no
  // ratchet_floor for the metric.
  const path = 'dimensions|MT01|max-cognitive';
  const working = {
    dimensions: {
      MT01: { metrics: { 'max-cognitive': { direction: 'max', ratchet_floor: 15, baseline: 15 } } },
    },
    _baseline_relaxation_approvals: { [path]: `${MARKER}: spoofed` },
  };
  const reference = {
    dimensions: { MT01: { metrics: { 'max-cognitive': { direction: 'max', baseline: 5 } } } },
  };
  // Generated (code-derived) has NO ratchet_floor for max-cognitive, and the
  // current measurement is 5 — not 15.
  const generated = {
    dimensions: { MT01: { metrics: { 'max-cognitive': { direction: 'max', baseline: 5 } } } },
  };
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(
    guard.ok,
    false,
    'a spoofed working-baseline ratchet_floor must not authorize a relax',
  );
});

test('guard: a direction=min floor cannot be relaxed via ratchet_floor', () => {
  // Even if the code declared a ratchet_floor on a min metric, the guard only
  // honors the clamp for direction:max (a higher coverage floor is a genuine
  // gain, never incidental headroom). Relaxing a coverage floor 100 -> 0 must
  // be blocked.
  const path = 'dimensions|CV01|rust-line-coverage-pct';
  const metric = { direction: 'min', ratchet_floor: 0, baseline: 0 };
  const working = {
    dimensions: { CV01: { metrics: { 'rust-line-coverage-pct': metric } } },
    _baseline_relaxation_approvals: { [path]: `${MARKER}: min-relax attempt` },
  };
  const reference = {
    dimensions: {
      CV01: { metrics: { 'rust-line-coverage-pct': { direction: 'min', baseline: 100 } } },
    },
  };
  const generated = {
    dimensions: {
      CV01: {
        metrics: {
          'rust-line-coverage-pct': { direction: 'min', ratchet_floor: 0, baseline: 100 },
        },
      },
    },
  };
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(guard.ok, false, 'a direction=min floor must never be relaxable via ratchet_floor');
});

test('guard: deliberately removing a metric is allowed with a marker', () => {
  // sentrux-coupling-score existed on origin/main; the working baseline and
  // the code (generated) both drop it. With a marker this is a sanctioned
  // ADR-0029 removal, not an accidental direction deletion.
  const path = 'dimensions|MD01|sentrux-coupling-score';
  const working = {
    dimensions: { MD01: { metrics: {} } },
    _baseline_relaxation_approvals: { [path]: `${MARKER}: ADR-0029 removal` },
  };
  const reference = dimBaseline('sentrux-coupling-score', { direction: 'max', baseline: 0.17 });
  const generated = { dimensions: { MD01: { metrics: {} } } };
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(
    guard.ok,
    true,
    `expected guard PASS; violations: ${JSON.stringify(guard.violations)}`,
  );
});

test('guard: removing a metric WITHOUT a marker is still blocked', () => {
  const path = 'dimensions|MD01|sentrux-coupling-score';
  const working = { dimensions: { MD01: { metrics: {} } }, _baseline_relaxation_approvals: {} };
  const reference = dimBaseline('sentrux-coupling-score', { direction: 'max', baseline: 0.17 });
  const generated = { dimensions: { MD01: { metrics: {} } } };
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(guard.ok, false, 'an unmarked metric removal must be blocked');
  assert.ok(guard.violations.some((v) => v.path === path));
});

test('guard: removing a metric from CODE while leaving baseline.json unchanged is blocked (Codex review)', () => {
  // The subtle bypass: delete the metric from FITNESS_METRICS (so the generated
  // baseline lacks it and it stops gating) but leave the working baseline.json
  // entry UNCHANGED (== origin/main). The value-based checks never fire because
  // working equals reference; the guard must still catch the code-side removal.
  const path = 'dimensions|MD01|max-fan-out';
  const reference = dimBaseline('max-fan-out', { direction: 'max', baseline: 20 });
  const working = {
    dimensions: { MD01: { metrics: { 'max-fan-out': { direction: 'max', baseline: 20 } } } },
    _baseline_relaxation_approvals: {},
  };
  const generated = { dimensions: { MD01: { metrics: {} } } }; // removed from code
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(
    guard.ok,
    false,
    'a code-side metric removal must be blocked even with an unchanged working floor',
  );
  assert.ok(
    guard.violations.some(
      (v) => v.path === path && v.reason === 'enforced-floor-removed-from-code',
    ),
    `expected enforced-floor-removed-from-code; got ${JSON.stringify(guard.violations)}`,
  );
});

test('guard: code-side metric removal is allowed WITH a marker (unchanged working floor)', () => {
  const path = 'dimensions|MD01|max-fan-out';
  const reference = dimBaseline('max-fan-out', { direction: 'max', baseline: 20 });
  const working = {
    dimensions: { MD01: { metrics: { 'max-fan-out': { direction: 'max', baseline: 20 } } } },
    _baseline_relaxation_approvals: { [path]: `${MARKER}: deliberate metric removal` },
  };
  const generated = { dimensions: { MD01: { metrics: {} } } };
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(
    guard.ok,
    true,
    `an audited code-side removal must pass; violations: ${JSON.stringify(guard.violations)}`,
  );
});

test('guard: a metric present in generated with a null value is NOT flagged as removed (sentrux-not-installed boundary)', () => {
  // Boundary (Codex re-verify): a metric whose KEY is still in the generated
  // baseline but reads null this run (e.g. sentrux not installed) must NOT be
  // treated as a code-side removal — only a truly absent key is a removal.
  const reference = {
    dimensions: {
      MT01: { metrics: { 'sentrux-quality-signal': { direction: 'min', baseline: 0.7 } } },
    },
  };
  const working = {
    dimensions: {
      MT01: { metrics: { 'sentrux-quality-signal': { direction: 'min', baseline: 0.7 } } },
    },
    _baseline_relaxation_approvals: {},
  };
  // Key present, value null (adapter produced no reading) — NOT a removal.
  const generated = {
    dimensions: {
      MT01: { metrics: { 'sentrux-quality-signal': { direction: 'min', baseline: null } } },
    },
  };
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(
    guard.ok,
    true,
    `a null-reading (present-key) metric must not be flagged as removed; violations: ${JSON.stringify(guard.violations)}`,
  );
  assert.ok(!guard.violations.some((v) => v.reason === 'enforced-floor-removed-from-code'));
});

test('guard: a FOLDER floor removed from the generated report while working is unchanged is blocked (Codex review)', () => {
  const path = 'folders|ws_apps/x/src|I';
  const reference = { folders: { 'ws_apps/x/src': { I: 0.2, D: null } }, dimensions: {} };
  const working = {
    folders: { 'ws_apps/x/src': { I: 0.2, D: null } }, // unchanged vs reference
    dimensions: {},
    _baseline_relaxation_approvals: {},
  };
  const generated = { folders: {}, dimensions: {} }; // folder gone from the scan
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(
    guard.ok,
    false,
    'a folder floor gone from the code-derived report must be blocked (unmarked)',
  );
  assert.ok(
    guard.violations.some(
      (v) => v.path === path && v.reason === 'enforced-floor-removed-from-code',
    ),
  );
});

test('guard: dropping a STILL-ENFORCED metric floor is blocked even WITH a marker', () => {
  // Adversarial (independent review): a marker must not disable a live gate by
  // deleting the metric's floor entry. The metric is gone from the working
  // baseline but STILL present in the code (generated). This must be blocked —
  // otherwise the comparator treats the metric as "missing baseline" (not a
  // regression) and enforcement silently stops. Guards the NaN fallthrough
  // (Math.abs(current - undefined)) that the ratchet_floor hardening did not
  // cover (it protected a floor's value, not the dropping of its entry).
  const path = 'dimensions|MD01|max-fan-out';
  const reference = dimBaseline('max-fan-out', { direction: 'max', baseline: 20 });
  const working = {
    dimensions: { MD01: { metrics: {} } },
    _baseline_relaxation_approvals: { [path]: `${MARKER}: sneaky delete of a live gate` },
  };
  // Still in the code with a real current measurement — NOT a deliberate removal.
  const generated = dimBaseline('max-fan-out', {
    direction: 'max',
    ratchet_floor: 20,
    baseline: 3,
  });
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(guard.ok, false, 'deleting a still-enforced metric floor must be blocked');
  assert.ok(
    guard.violations.some((v) => v.path === path && /floor-dropped-while-enforced/.test(v.reason)),
    `expected a floor-dropped violation; got ${JSON.stringify(guard.violations)}`,
  );
});

test('guard: dropping a FOLDER I/D floor is blocked even WITH a marker (Gemini review)', () => {
  // Folder metrics never reach applyDirectionDeviation (no direction field);
  // they go straight to evaluateCandidate. Deleting a folder's I floor while
  // the folder is still measured must be blocked even with a marker.
  const path = 'folders|ws_apps/a/src|I';
  const reference = { folders: { 'ws_apps/a/src': { I: 0.2, D: 0.2 } }, dimensions: {} };
  const working = {
    folders: { 'ws_apps/a/src': { D: 0.2 } },
    dimensions: {},
    _baseline_relaxation_approvals: { [path]: `${MARKER}: sneaky folder-I drop` },
  };
  const generated = { folders: { 'ws_apps/a/src': { I: 0.9, D: 0.2 } }, dimensions: {} };
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(guard.ok, false, 'dropping a still-measured folder floor must be blocked');
  assert.ok(
    guard.violations.some((v) => v.path === path && /floor-dropped-while-enforced/.test(v.reason)),
  );
});

test('guard: dropping only a dimension metric BASELINE key (direction retained) is blocked WITH a marker (Gemini review)', () => {
  // Deleting just the baseline key while keeping direction produces no
  // direction issue, so applyDirectionDeviation is skipped and evaluation
  // falls through to evaluateCandidate. Must still be blocked.
  const path = 'dimensions|MD01|max-fan-out';
  const reference = dimBaseline('max-fan-out', { direction: 'max', baseline: 20 });
  const working = {
    dimensions: { MD01: { metrics: { 'max-fan-out': { direction: 'max' } } } },
    _baseline_relaxation_approvals: { [path]: `${MARKER}: sneaky baseline-key drop` },
  };
  const generated = dimBaseline('max-fan-out', {
    direction: 'max',
    ratchet_floor: 20,
    baseline: 3,
  });
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(guard.ok, false, 'dropping a still-enforced baseline key must be blocked');
  assert.ok(
    guard.violations.some((v) => v.path === path && /floor-dropped-while-enforced/.test(v.reason)),
  );
});

test('guard: a refactored-away folder (absent from generated) may drop its floor with a marker', () => {
  // The legitimate counterpart: a folder that no longer exists in the current
  // report (absent from generated) is not "still enforced", so dropping its
  // floor with a marker is allowed — the generated reading is null.
  const path = 'folders|ws_apps/gone/src|I';
  const reference = { folders: { 'ws_apps/gone/src': { I: 0.2, D: null } }, dimensions: {} };
  const working = {
    folders: {},
    dimensions: {},
    _baseline_relaxation_approvals: { [path]: `${MARKER}: folder refactored away` },
  };
  const generated = { folders: {}, dimensions: {} };
  const guard = evaluateBaselineRelaxationGuard({
    workingBaseline: working,
    referenceBaseline: reference,
    generatedBaseline: generated,
  });
  assert.equal(
    guard.ok,
    true,
    `a refactored-away folder may drop its floor; violations: ${JSON.stringify(guard.violations)}`,
  );
});

test('instability-out-of-range-count: a module with unknown D is NOT counted (documented degradation)', () => {
  // ADR-0029 reshape: the count needs a KNOWN distance to prove a module is off
  // the main sequence. A module at an instability extreme whose abstractness
  // (and thus D) is unreadable is deliberately NOT counted — counting it would
  // re-introduce the false-trip on every leaf when abstractness is absent. This
  // pins that behavior explicitly; see the note in the metric objective about
  // relying on the abstractness adapter being present for full coverage.
  const metric = FITNESS_METRICS.MD01.find((m) => m.id === 'instability-out-of-range-count');
  const report = {
    workspace: {
      folders: [],
      modules: [{ source: 'ws_apps/a/x.ts', I: 0.95, D: null }],
      circular_edges: 0,
    },
  };
  assert.equal(metric.value(report), 0, 'an extreme-I module with unknown D is not counted');
});

test('ratchetBaseline: a null measurement seeds a null floor (clamp passes through non-numbers)', () => {
  // clampRatchetFloor must not coerce a null measurement to the ratchet_floor;
  // an empty workspace yields max-fan-out = null, which seeds a null floor and
  // only clamps once a real measurement arrives (null-to-real path).
  const empty = { workspace: { folders: [], modules: [], circular_edges: 0 } };
  const { next } = ratchetBaseline({ schema_version: '1.0.0', folders: {}, dimensions: {} }, empty);
  assert.equal(next.dimensions.MD01.metrics['max-fan-out'].baseline, null);
});
