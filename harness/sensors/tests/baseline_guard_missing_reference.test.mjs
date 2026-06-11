// baseline_guard_missing_reference.test.mjs - the guard must SKIP/PASS
// (not error) when the reference baseline cannot be resolved. Triggers
// in three real environments: a fresh clone with no `origin` remote, a
// shallow checkout where `origin/main` was never fetched, and operators
// who opt out via `--baseline-reference=none`. When the reference IS
// available the guard MUST still enforce - this file pins both halves
// so a future refactor cannot silently weaken the guard.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateBaselineRelaxationGuard,
  formatBaselineRelaxationGuard,
} from '../baseline_guard.mjs';

function referenceBaselineFixture() {
  return {
    schema_version: '1.0.0',
    folders: { 'ws_apps/fixture/src': { I: 0.4, D: 0.4 } },
    dimensions: {
      MT01: {
        metrics: {
          'max-cyclomatic': { direction: 'max', baseline: 6 },
        },
      },
    },
  };
}

test('guard abstains when reference baseline is null/undefined/non-object', () => {
  const working = referenceBaselineFixture();
  for (const missing of [null, undefined, 'not-an-object', 42]) {
    const result = evaluateBaselineRelaxationGuard({
      workingBaseline: working,
      referenceBaseline: missing,
      generatedBaseline: working,
    });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'no-reference-baseline-available');
    assert.equal(result.violations.length, 0);
  }
});

test('formatter emits SKIPPED note (not FAIL banner) for a skipped guard', () => {
  const skipped = evaluateBaselineRelaxationGuard({
    workingBaseline: referenceBaselineFixture(),
    referenceBaseline: null,
    generatedBaseline: referenceBaselineFixture(),
  });
  const rendered = formatBaselineRelaxationGuard(skipped);
  assert.match(rendered, /BASELINE RELAXATION GUARD: SKIPPED/);
  assert.match(rendered, /no-reference-baseline-available/);
  assert.doesNotMatch(rendered, /BASELINE RELAXATION GUARD: FAIL/);
});

test('formatter is a no-op for null/undefined/ok-not-skipped', () => {
  assert.equal(formatBaselineRelaxationGuard(null), '');
  assert.equal(formatBaselineRelaxationGuard(undefined), '');
  assert.equal(formatBaselineRelaxationGuard({ ok: true, violations: [] }), '');
});

test('guard still ENFORCES when reference IS available (no silent weakening)', () => {
  const reference = referenceBaselineFixture();
  const regressed = JSON.parse(JSON.stringify(reference));
  regressed.dimensions.MT01.metrics['max-cyclomatic'].direction = 'min';
  const result = evaluateBaselineRelaxationGuard({
    workingBaseline: regressed,
    referenceBaseline: reference,
    generatedBaseline: regressed,
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, undefined);
  assert.ok(result.violations.length > 0);
});
