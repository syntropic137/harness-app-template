// Tests that the sensors slot honors a symlinked entry path.
//
// The VPS swarm runbook (see CLAUDE.md / proj) symlinks every project in
// from /data/projects/<org>--<repo>, and `just sensors gate` invokes the
// sensor scripts through that symlinked tree. Node resolves
// `import.meta.url` through realpath while `process.argv[1]` keeps the
// symlinked path, so a raw `fileURLToPath(import.meta.url) ===
// resolve(process.argv[1])` comparison fails and main() never runs.
//
// When that comparison is broken, sentrux_scan and the adapters CLI emit
// EMPTY output and the gate silently drops every metric they feed
// (MT01/MD01/ST01 sentrux + adapters manifest). The bug was real;
// aggregate.mjs and deadcode_scan.mjs had already adopted the
// realpath-on-both-sides pattern, but sentrux_scan and adapters had not.
//
// This test pins the regression: spawn each script through a symlinked
// path and assert the script actually ran (non-empty parseable JSON).
//
// Run via: node --test harness/sensors/tests/symlink_entry.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SENSORS_DIR = dirname(HERE);
const REPO_ROOT = dirname(dirname(SENSORS_DIR));

function makeSymlinkedRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'harness-symlink-entry-'));
  const linkPath = join(dir, 'mirror');
  symlinkSync(REPO_ROOT, linkPath, 'dir');
  return { dir, linkPath };
}

function runScript(symlinkedRepo, relPath, args = []) {
  const scriptPath = join(symlinkedRepo, relPath);
  const result = spawnSync('node', [scriptPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
}

// Test-local guarded parser. Production code paths read these envelopes
// through gate.mjs which has its own validation; here we just want a
// useful failure message when the script under test emits something
// other than JSON (the original bug shape was empty stdout).
function parseEnvelope(stdout, scriptLabel) {
  try {
    return JSON.parse(stdout);
  } catch (err) {
    assert.fail(
      `${scriptLabel} did not emit valid JSON through a symlinked entry path: ${err?.message ?? err}; stdout was ${JSON.stringify(stdout.slice(0, 200))}`,
    );
  }
}

test('sentrux_scan.mjs runs main() when invoked through a symlinked repo path', () => {
  const { dir, linkPath } = makeSymlinkedRoot();
  try {
    const { stdout, status } = runScript(linkPath, 'harness/sensors/sentrux_scan.mjs', [
      `--workspace-root=${linkPath}`,
    ]);
    assert.equal(status, 0, 'sentrux_scan should exit 0');
    assert.ok(
      stdout.trim().length > 0,
      'sentrux_scan must emit a non-empty envelope through a symlinked entry path',
    );
    const parsed = parseEnvelope(stdout, 'sentrux_scan.mjs');
    assert.equal(parsed.tool, 'sentrux', 'envelope must identify the tool');
    assert.ok(
      Object.hasOwn(parsed, 'available'),
      'envelope must include an availability flag (soft-skip or live)',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loc_scan.mjs runs main() when invoked through a symlinked repo path', () => {
  const { dir, linkPath } = makeSymlinkedRoot();
  try {
    const { stdout, status } = runScript(linkPath, 'harness/sensors/loc_scan.mjs', [
      `--workspace-root=${linkPath}`,
    ]);
    assert.equal(status, 0, 'loc_scan should exit 0');
    assert.ok(
      stdout.trim().length > 0,
      'loc_scan must emit a non-empty envelope through a symlinked entry path',
    );
    const parsed = parseEnvelope(stdout, 'loc_scan.mjs');
    assert.equal(parsed.tool, 'loc-scan', 'envelope must identify the tool');
    assert.equal(parsed.available, true, 'the symlinked real workspace must produce a live scan');
    assert.ok(
      parsed.metrics.max_file_loc > 0,
      'the live scan must measure the workspace sources, not merely emit an envelope',
    );
    assert.ok(parsed.metrics.file_count > 0, 'the live scan must enumerate at least one Rust file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The other side of isScriptEntry(): the two guard branches that return
// false so main() does NOT run. A raw `node --test` import always has a
// real process.argv[1], so these two branches are unreachable in-process;
// we exercise them by spawning node with the module imported (not run as
// argv[1]), matching the subprocess-entry style already used above. Node's
// --experimental-test-coverage propagates NODE_V8_COVERAGE into the child,
// so the child's line hits merge into the slot report.
function importLocScan(fakeArgv1) {
  const url = pathToFileURL(join(SENSORS_DIR, 'loc_scan.mjs')).href;
  // The child imports the module (never runs it as argv[1]); an optional
  // FAKE_ARGV1 lets the caller install a truthy-but-bogus process.argv[1]
  // before the import so the realpath comparison throws.
  const code =
    'if (process.env.FAKE_ARGV1) process.argv[1] = process.env.FAKE_ARGV1; await import(process.env.LOC_SCAN_URL);';
  const env = { ...process.env, LOC_SCAN_URL: url };
  if (fakeArgv1) env.FAKE_ARGV1 = fakeArgv1;
  const result = spawnSync('node', ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
}

test('loc_scan.mjs isScriptEntry() returns false (no main) when process.argv[1] is absent', () => {
  // Imported, never run as a script: node -e leaves process.argv[1] undefined,
  // so the `!process.argv[1]` guard short-circuits to false.
  const { stdout, stderr, status } = importLocScan();
  assert.equal(status, 0, `import should exit 0; stderr was ${stderr}`);
  assert.equal(stdout.trim(), '', 'main() must NOT run, so no envelope is emitted');
});

test('loc_scan.mjs isScriptEntry() returns false (no main) when the argv[1] realpath throws', () => {
  // A truthy but non-existent process.argv[1] makes realpathSync throw ENOENT,
  // driving the try/catch to its `return false` branch. Still imported, so
  // main() never runs.
  const { stdout, stderr, status } = importLocScan('/harness-template-loc-scan-nonexistent-argv1');
  assert.equal(status, 0, `import should exit 0; stderr was ${stderr}`);
  assert.equal(stdout.trim(), '', 'main() must NOT run, so no envelope is emitted');
});

test('adapters.mjs manifest runs main() when invoked through a symlinked repo path', () => {
  const { dir, linkPath } = makeSymlinkedRoot();
  try {
    const { stdout, status } = runScript(linkPath, 'harness/sensors/adapters.mjs', ['manifest']);
    assert.equal(status, 0, 'adapters manifest should exit 0');
    assert.ok(
      stdout.trim().length > 0,
      'adapters.mjs must emit a non-empty manifest through a symlinked entry path',
    );
    const parsed = parseEnvelope(stdout, 'adapters.mjs');
    assert.equal(parsed.protocol_version, 1, 'manifest must declare protocol_version 1');
    assert.ok(Array.isArray(parsed.packages), 'manifest must list packages');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
