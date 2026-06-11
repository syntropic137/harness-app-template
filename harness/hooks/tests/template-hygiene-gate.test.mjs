// Unit tests for template-hygiene-gate.mjs pure-function predicates.
//
// Run via: node --test 'harness/hooks/tests/*.test.mjs'
// (also wired into lefthook.yml `pre-commit > hook-tests`, glob-gated to
// harness/hooks changes).
//
// Adapted from the lab's harness/hooks/tests/template-hygiene-gate.test.mjs;
// the path fixtures changed because this repo gates its own hygiene-critical
// surfaces instead of the lab's templates/ + harness/create-harness-app/.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  listHookScripts,
  parseChangedPaths,
  stagedTouchesHygieneSurface,
} from '../template-hygiene-gate.mjs';

test('stagedTouchesHygieneSurface matches hygiene-critical exact files', () => {
  assert.equal(stagedTouchesHygieneSurface(['lefthook.yml']), true);
  assert.equal(stagedTouchesHygieneSurface(['justfile']), true);
  assert.equal(stagedTouchesHygieneSurface(['scripts/init.ts']), true);
  assert.equal(stagedTouchesHygieneSurface(['scripts/update.ts']), true);
  assert.equal(stagedTouchesHygieneSurface(['scripts/bootstrap.ts']), true);
});

test('stagedTouchesHygieneSurface matches hygiene-critical dir prefixes', () => {
  assert.equal(stagedTouchesHygieneSurface(['harness/hooks/check-staged-size.mjs']), true);
  assert.equal(stagedTouchesHygieneSurface(['harness/hooks/tests/foo.test.mjs']), true);
  assert.equal(stagedTouchesHygieneSurface(['scripts/lib/vendor-links.ts']), true);
});

test('stagedTouchesHygieneSurface ignores unrelated paths', () => {
  assert.equal(stagedTouchesHygieneSurface(['README.md', 'docs/adrs/ADR-0001.md']), false);
  assert.equal(stagedTouchesHygieneSurface(['ws_apps/example-typescript/src/index.ts']), false);
  assert.equal(stagedTouchesHygieneSurface(['harness/sensors/gate.mjs']), false);
});

test('stagedTouchesHygieneSurface treats exact files as full paths, not prefixes', () => {
  // scripts/init.ts is hygiene-critical; its lookalike siblings are not.
  assert.equal(stagedTouchesHygieneSurface(['scripts/inspector.ts']), false);
  assert.equal(stagedTouchesHygieneSurface(['scripts/tests/bootstrap.test.ts']), false);
  // A nested lefthook.yml or justfile in a workspace app is not the root one.
  assert.equal(stagedTouchesHygieneSurface(['ws_apps/example-typescript/justfile']), false);
});

test('stagedTouchesHygieneSurface handles empty and non-array input', () => {
  assert.equal(stagedTouchesHygieneSurface([]), false);
  assert.equal(stagedTouchesHygieneSurface(undefined), false);
});

test('stagedTouchesHygieneSurface matches when at least one path is relevant', () => {
  assert.equal(
    stagedTouchesHygieneSurface(['docs/foo.md', 'harness/hooks/track-perf.mjs', 'README.md']),
    true,
  );
});

test('parseChangedPaths splits null-separated git output', () => {
  // git diff --name-only -z output: each path NUL-terminated.
  const raw = 'foo/bar.mjs\0baz/qux.md\0';
  assert.deepEqual(parseChangedPaths(raw), ['foo/bar.mjs', 'baz/qux.md']);
});

test('parseChangedPaths handles empty input', () => {
  assert.deepEqual(parseChangedPaths(''), []);
});

test('parseChangedPaths filters empty trailing entries', () => {
  const raw = 'a\0\0b\0';
  assert.deepEqual(parseChangedPaths(raw), ['a', 'b']);
});

test('listHookScripts returns sorted repo-relative .mjs paths only', () => {
  const fakeReaddir = () => ['track-perf.mjs', 'README.md', 'check-staged-size.mjs', 'tests'];
  assert.deepEqual(listHookScripts('/repo/harness/hooks', fakeReaddir), [
    'harness/hooks/check-staged-size.mjs',
    'harness/hooks/track-perf.mjs',
  ]);
});
