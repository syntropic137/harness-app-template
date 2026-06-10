// Fixture test suite for the suite-duration sensor's coverage-coupling
// demo. Covers every branch of fixtures/suite_duration_demo/src/divide.mjs.
// The "handles zero" test is the one the operator-mandated real-regression
// demo deletes to drop branch coverage below 100%.

import assert from 'node:assert';
import { test } from 'node:test';
import { divide } from '../src/divide.mjs';

test('divides normally', () => {
  assert.strictEqual(divide(10, 2), 5);
});

test('handles zero divisor', () => {
  assert.strictEqual(divide(10, 0), 'undefined');
});
