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
import { fileURLToPath } from 'node:url';

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
