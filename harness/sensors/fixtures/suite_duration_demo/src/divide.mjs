// Tiny target module for the suite-duration sensor's coverage-coupling
// demo. Used by harness/sensors/fixtures/suite_duration_demo/tests/divide.test.mjs.
// The `if (b === 0)` branch is what the deleted-assertion demo regresses.

export function divide(a, b) {
  if (b === 0) {
    return 'undefined';
  }
  return a / b;
}
