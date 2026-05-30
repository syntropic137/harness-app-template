// Unit test for `shouldSkip` from check-staged-size.mjs.
//
// Plain node:test runner — no vitest dependency at the lab-hooks layer.
// Covers E-11: hardcoded skip list for build-output / cache dirs.
//
// Run via: node --test harness/hooks/tests/check-staged-size.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldSkip } from '../check-staged-size.mjs';

test('shouldSkip matches cargo target/ build artifacts', () => {
  assert.equal(shouldSkip('ws_apps/example-rust/target/debug/build/anyhow-abc/out/probe'), true);
  assert.equal(shouldSkip('target/release/some-binary'), true);
});

test('shouldSkip matches node_modules nested anywhere', () => {
  assert.equal(shouldSkip('ws_apps/example-typescript/node_modules/foo/index.js'), true);
});

test('shouldSkip matches python build/cache dirs', () => {
  assert.equal(shouldSkip('ws_apps/example-python/.venv/lib/python3.11/site-packages/x.py'), true);
  assert.equal(shouldSkip('ws_apps/example-python/__pycache__/x.cpython-311.pyc'), true);
  assert.equal(shouldSkip('ws_apps/example-python/.pytest_cache/v/cache/nodeids'), true);
  assert.equal(shouldSkip('ws_apps/example-python/.ruff_cache/0.6.9/blah'), true);
});

test('shouldSkip matches dist/ build/ coverage/ .harness/', () => {
  assert.equal(shouldSkip('packages/foo/dist/index.js'), true);
  assert.equal(shouldSkip('apps/foo/build/output.o'), true);
  assert.equal(shouldSkip('coverage/lcov.info'), true);
  assert.equal(shouldSkip('.harness/artifacts/2026-05-17/foo.png'), true);
});

test('shouldSkip does NOT match source files', () => {
  assert.equal(shouldSkip('ws_apps/example-rust/src/main.rs'), false);
  assert.equal(shouldSkip('ws_apps/example-python/tests/test_main.py'), false);
  assert.equal(shouldSkip('Cargo.toml'), false);
  assert.equal(shouldSkip('README.md'), false);
});

test('shouldSkip does NOT match files that merely contain a skip-segment substring', () => {
  // The segment includes a trailing slash, so 'targeting.md' should NOT match.
  assert.equal(shouldSkip('docs/targeting.md'), false);
  // But a directory named 'target' anywhere in the path WILL match — that's intentional.
  assert.equal(shouldSkip('foo/target/x'), true);
});
