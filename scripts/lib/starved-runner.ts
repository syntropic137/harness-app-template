// Detect the "starved runner" false-red on the cov-ts pre-push gate.
//
// The defect: vitest's worker-to-main RPC (birpc) has a hardcoded 60 second
// timeout with no config knob. lefthook's pre-push phase runs `parallel:
// true`, so cov-ts's vitest workers compete with cargo builds and other
// jobs for the same box. When the main thread is starved past a minute
// while servicing worker RPC calls (plus doing coverage instrumentation),
// the run dies with:
//
//   Test Files  69 passed (69)
//   Tests       1250 passed (1250)
//   Duration    405.72s
//   Error: [vitest-worker]: Timeout calling "onTaskUpdate"
//
// and exits 1 -- with every test green and full coverage. Measured on the
// same commit, twice: at load average 78 the run took 405s and exited 1;
// at load average <8 the identical run took 141s and exited 0. A gate whose
// verdict flips on ambient machine load is measuring the machine, not the
// code, so it is a false red worth one bounded, serialized retry.
//
// The predicate below is deliberately narrow. It must never fire on a REAL
// red: a failed assertion, a missed coverage threshold, or a crash before
// vitest ever reports a tally all fail one of its checks and are reported
// as-is, unretried.

/** The birpc timeout signature, e.g. `Timeout calling "onTaskUpdate"`. */
const TIMEOUT_SIGNATURE_RE = /Timeout calling "[^"]+"/;

/** Vitest's own "N failed" summary line, e.g. `Tests  1 failed | 5 passed (6)`. */
const FAILED_TESTS_RE = /Tests\s+\d+\s+failed/;

/**
 * Vitest coverage-v8's threshold-miss message, e.g.:
 *   ERROR: Coverage for statements (50%) does not meet global threshold (85%)
 *   ERROR: Coverage for statements (33.33%) does not meet threshold (85%) for src/math.ts
 */
const THRESHOLD_MISS_RE = /does not meet[^\n]*threshold/i;

/** A clean passing tally, e.g. `Tests  1250 passed (1250)`. */
const PASSING_TALLY_RE = /Tests\s+\d+\s+passed\s*\(\d+\)/;

/**
 * True only when ALL of the following hold:
 *  1. the birpc timeout signature is present, AND
 *  2. no test is reported failed, AND
 *  3. no coverage threshold was missed, AND
 *  4. vitest actually reported a passing tally.
 *
 * Any real red fails one of these checks and returns false, so the caller
 * reports the failure as-is instead of masking it with a retry.
 */
export function isStarvedRunnerFailure(output: string): boolean {
  if (!TIMEOUT_SIGNATURE_RE.test(output)) {
    return false;
  }
  if (FAILED_TESTS_RE.test(output)) {
    return false;
  }
  if (THRESHOLD_MISS_RE.test(output)) {
    return false;
  }
  return PASSING_TALLY_RE.test(output);
}
