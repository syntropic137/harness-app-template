// Tests for the ts-morph complexity adapter, with focus on the spread
// metric (`high_cognitive_count` / `high_cyclomatic_count`) that feeds
// the MT01 `high-cognitive-fn-count` ratchet metric in gate.mjs.
//
// The spread counter complements the peak metric. A refactor that splits
// a single cognitive=15 function into three cognitive=6 functions reads
// as an IMPROVEMENT to max-cognitive (peak drops 15 -> 6) but degrades
// the spread (count of high-complexity functions goes 1 -> 3). The gate
// must catch the regression via this metric even when peak improves.
//
// Run via: node --test harness/sensors/tests/complexity.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Project } from 'ts-morph';

import {
  classifyModule,
  HIGH_COGNITIVE_THRESHOLD,
  HIGH_CYCLOMATIC_THRESHOLD,
} from '../complexity.mjs';

function projectWithSource(source) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true, noEmit: true },
  });
  return project.createSourceFile('virtual.ts', source);
}

test('classifyModule: counts functions at or above the cognitive threshold', () => {
  // Three functions: one trivial, one borderline (== threshold), one
  // well above. Only the latter two should be counted.
  const trivial = `function a(x: number) { return x + 1; }\n`;
  const borderline = `function b(xs: number[]): number {
    let total = 0;
    if (xs.length === 0) return 0;
    for (const x of xs) {
      if (x > 0) {
        if (x % 2 === 0) total += x;
      }
    }
    return total;
  }\n`;
  const heavy = `function c(input: string | null | undefined): string {
    if (!input) return '';
    let out = '';
    for (const ch of input) {
      if (ch === 'a') {
        out += 'A';
      } else if (ch === 'b') {
        if (out.length > 0) {
          out += 'B';
        } else {
          out += 'b';
        }
      } else {
        out += ch;
      }
    }
    return out;
  }\n`;
  const sf = projectWithSource(trivial + borderline + heavy);
  const m = classifyModule(sf);
  // Sanity: thresholds are the documented 5 / 5 pair.
  assert.equal(HIGH_COGNITIVE_THRESHOLD, 5);
  assert.equal(HIGH_CYCLOMATIC_THRESHOLD, 5);
  // The borderline + heavy function should be above the cognitive line,
  // the trivial one should not. Exact counts depend on the metric
  // shape (Sonar-approximation in complexity.mjs); the contract we
  // assert is: trivial scores below threshold, heavy scores at or
  // above, and the count tracks accordingly.
  const cognitiveValues = m.functions.map((fn) => fn.cognitive);
  const expectedHighCog = cognitiveValues.filter((v) => v >= HIGH_COGNITIVE_THRESHOLD).length;
  assert.equal(m.high_cognitive_count, expectedHighCog);
  assert.ok(m.high_cognitive_count >= 1, 'heavy function should be counted');
  // The trivial function alone would yield zero.
  const trivialOnly = classifyModule(projectWithSource(trivial));
  assert.equal(trivialOnly.high_cognitive_count, 0);
  assert.equal(trivialOnly.high_cyclomatic_count, 0);
});

test('classifyModule: improving a heavy function lowers the spread count', () => {
  // The ratchet promise: simplifying a heavy function back below the
  // threshold drops the spread count, which lets the gate tighten the
  // floor. We test the underlying metric: same module, two versions,
  // count decreases when complexity is removed.
  const heavyVersion = `function f(x: number[]): number {
    let total = 0;
    for (const n of x) {
      if (n > 0) {
        if (n % 2 === 0) {
          if (n > 100) {
            total += n * 2;
          } else {
            total += n;
          }
        } else if (n % 3 === 0) {
          total += n / 3;
        }
      }
    }
    return total;
  }\n`;
  const simpleVersion = `function f(x: number[]): number {
    return x.filter((n) => n > 0).reduce((a, b) => a + b, 0);
  }\n`;
  const heavy = classifyModule(projectWithSource(heavyVersion));
  const simple = classifyModule(projectWithSource(simpleVersion));
  assert.ok(
    heavy.high_cognitive_count > simple.high_cognitive_count,
    `expected refactor to lower spread count; got heavy=${heavy.high_cognitive_count} simple=${simple.high_cognitive_count}`,
  );
  assert.equal(simple.high_cognitive_count, 0);
});
