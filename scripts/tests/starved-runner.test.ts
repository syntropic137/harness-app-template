// Unit tests for scripts/lib/starved-runner.ts.
//
// The predicate must fire ONLY on the exact false-red signature: vitest's
// birpc worker-to-main RPC timing out after every test and every coverage
// threshold already passed. Every negative case below is a REAL red that
// must never be masked by a retry.
import { describe, expect, test } from 'vitest';
import { isStarvedRunnerFailure } from '../lib/starved-runner';

const CLEAN_PASS_TAIL = `
 Test Files  69 passed (69)
      Tests  1250 passed (1250)
   Duration  405.72s
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
`;

describe('isStarvedRunnerFailure', () => {
  test('the measured false-red signature: all green, then a birpc timeout', () => {
    expect(isStarvedRunnerFailure(CLEAN_PASS_TAIL)).toBe(true);
  });

  test('a clean pass with no timeout at all is not a starved-runner failure (there is no failure)', () => {
    expect(
      isStarvedRunnerFailure(`
 Test Files  69 passed (69)
      Tests  1250 passed (1250)
   Duration  141.02s
`),
    ).toBe(false);
  });

  test('no timeout signature present at all', () => {
    expect(isStarvedRunnerFailure('some unrelated crash output')).toBe(false);
  });

  test('a REAL test failure plus the timeout string must NOT retry', () => {
    expect(
      isStarvedRunnerFailure(`
 FAIL  scripts/tests/zzz.test.ts > boom
AssertionError: expected 1 to be 2

 Test Files  1 failed | 68 passed (69)
      Tests  1 failed | 1249 passed (1250)
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
`),
    ).toBe(false);
  });

  test('a coverage threshold miss plus the timeout string must NOT retry', () => {
    expect(
      isStarvedRunnerFailure(`
 Test Files  69 passed (69)
      Tests  1250 passed (1250)
ERROR: Coverage for statements (99.87%) does not meet global threshold (100%)
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
`),
    ).toBe(false);
  });

  test('a per-file threshold miss (named target form) plus the timeout string must NOT retry', () => {
    expect(
      isStarvedRunnerFailure(`
 Test Files  69 passed (69)
      Tests  1250 passed (1250)
ERROR: Coverage for statements (33.33%) does not meet threshold (85%) for src/math.ts
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
`),
    ).toBe(false);
  });

  test('a crash before vitest ever reports a passing tally must NOT retry, even with the timeout string', () => {
    expect(
      isStarvedRunnerFailure(`
Error: Cannot find module 'nonexistent-thing'
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
`),
    ).toBe(false);
  });

  test('a different RPC method name in the timeout is still recognised', () => {
    expect(
      isStarvedRunnerFailure(`
      Tests  4 passed (4)
Error: [vitest-worker]: Timeout calling "onCollected"
`),
    ).toBe(true);
  });
});
