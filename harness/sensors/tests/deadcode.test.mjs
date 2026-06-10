// Tests for the knip dead-code adapter wired through harness/sensors/gate.mjs
// as the 3rd composition lens after dep-cruiser/ts-morph and sentrux. Mirrors
// sentrux.test.mjs in shape: same stubIo + same end-to-end main() drive,
// because the contract is identical (envelope-on-disk, soft-skip on
// available=false, direction=max ratchet under MT01).
//
// The contract under test (ADR-0024-dead-code-ratchet.md):
//   - Knip metrics flow in through the --deadcode=<path> CLI flag and the
//     unused-export-count metric is wired to FITNESS_METRICS.MT01.
//   - The ratchet tightens on improvement (smaller-is-better for the
//     count metric; direction max).
//   - Regressions fail the gate WITHOUT moving the floor — same
//     no-broken-windows rule as the APSS dimensions.
//   - When the adapter envelope reports `available: false`, the metric
//     degrades to "no reading" rather than a false zero, so a missing
//     binary does not silently pass.
//
// Also unit-tests the adapter helpers (summarizeKnipPayload,
// discoverWorkspaces, runDeadcodeScan with stubbed spawn) so a broken
// knip output shape regresses on a fast unit run rather than only at
// CI gate time.
//
// Run via: node --test harness/sensors/tests/deadcode.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoverWorkspaces, runDeadcodeScan, summarizeKnipPayload } from '../deadcode_scan.mjs';
import { compareBaseline, extractApssFitnessBaseline, main, ratchetBaseline } from '../gate.mjs';

function emptyReport() {
  return {
    workspace: { folders: [], modules: [], circular_edges: 0 },
  };
}

function envelope(metrics) {
  return {
    tool: 'knip',
    available: true,
    version: '6.16.1',
    scanned_workspaces: ['ws_apps/example-typescript', 'ws_packages/telemetry'],
    metrics,
  };
}

function baselineWithDeadcode(metrics) {
  return extractApssFitnessBaseline(emptyReport(), { deadcode: envelope(metrics) });
}

function stubIo({ stdin = '{}', files = {} } = {}) {
  const stdout = [];
  const stderr = [];
  const writes = [];
  const written = { ...files };
  return {
    io: {
      read: async () => stdin,
      write: (s) => stdout.push(s),
      writeErr: (s) => stderr.push(s),
      readFile: (p) => {
        if (!(p in written)) {
          throw new Error(`stub: no such file ${p}`);
        }
        return written[p];
      },
      writeFile: (p, s) => {
        written[p] = s;
        writes.push({ path: p, content: s });
      },
      fileExists: (p) => p in written,
      env: {},
    },
    writes,
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
  };
}

// ---------------------------------------------------------------------------
// Adapter unit tests
// ---------------------------------------------------------------------------

test('summarizeKnipPayload sums files + exports + types and ignores other fields', () => {
  const payload = {
    issues: [
      { files: [{ name: 'a.ts' }], exports: [], types: [], unlisted: [{ name: 'noise' }] },
      { files: [], exports: [{ name: 'foo' }, { name: 'bar' }], types: [{ name: 'T' }] },
      { files: [{ name: 'b.ts' }], exports: [{ name: 'baz' }], types: [] },
    ],
  };
  const m = summarizeKnipPayload(payload);
  assert.equal(m.unused_files, 2);
  assert.equal(m.unused_exports, 3);
  assert.equal(m.unused_types, 1);
  assert.equal(m.total_unused, 6);
});

test('summarizeKnipPayload returns zeros for empty / malformed payloads', () => {
  for (const p of [null, {}, { issues: null }, { issues: [] }, { issues: [{}] }]) {
    const m = summarizeKnipPayload(p);
    assert.equal(m.total_unused, 0);
    assert.equal(m.unused_files, 0);
    assert.equal(m.unused_exports, 0);
    assert.equal(m.unused_types, 0);
  }
});

test('discoverWorkspaces returns sorted ws_apps + ws_packages roots with package.json', () => {
  const fs = {
    existsSync: (p) =>
      [
        '/r/ws_apps',
        '/r/ws_packages',
        '/r/ws_apps/example-typescript/package.json',
        '/r/ws_packages/telemetry/package.json',
        '/r/ws_apps/docs/package.json',
      ].includes(p),
    readdirSync: (p) => {
      if (p === '/r/ws_apps') return ['example-typescript', 'docs', '.cache'];
      if (p === '/r/ws_packages') return ['telemetry'];
      return [];
    },
    statSync: () => ({ isDirectory: () => true }),
  };
  const found = discoverWorkspaces('/r', ['ws_apps', 'ws_packages'], fs);
  assert.deepEqual(found, ['ws_apps/docs', 'ws_apps/example-typescript', 'ws_packages/telemetry']);
});

test('runDeadcodeScan surfaces unavailable when no workspace package exists', () => {
  const envelope = runDeadcodeScan({
    workspaceRoot: '/empty',
    fs: {
      existsSync: () => false,
      readdirSync: () => [],
      statSync: () => ({ isDirectory: () => false }),
    },
    spawn: () => {
      throw new Error('spawn should not be called when there are no workspaces');
    },
  });
  assert.equal(envelope.available, false);
  assert.match(envelope.reason, /no ws_apps/);
  assert.deepEqual(envelope.scanned_workspaces, []);
});

test('runDeadcodeScan parses knip JSON via stubbed spawn and rolls up the metric', () => {
  const knipJson = JSON.stringify({
    issues: [{ files: [{ name: 'x.ts' }], exports: [{ name: 'foo' }], types: [] }],
  });
  const envelope = runDeadcodeScan({
    workspaceRoot: '/r',
    workspaces: ['ws_apps/example-typescript'],
    spawn: (cmd, args) => {
      assert.equal(cmd, 'npx');
      assert.ok(args.includes('--yes'));
      assert.ok(args.some((a) => a.startsWith('knip@')));
      assert.ok(args.includes('--workspace'));
      assert.ok(args.includes('ws_apps/example-typescript'));
      return { status: 1, stdout: knipJson, stderr: '' };
    },
  });
  assert.equal(envelope.available, true);
  assert.equal(envelope.metrics.unused_files, 1);
  assert.equal(envelope.metrics.unused_exports, 1);
  assert.equal(envelope.metrics.total_unused, 2);
});

test('runDeadcodeScan returns unavailable when stdout is not JSON', () => {
  const envelope = runDeadcodeScan({
    workspaceRoot: '/r',
    workspaces: ['ws_apps/example-typescript'],
    spawn: () => ({ status: 1, stdout: 'oops not json', stderr: '' }),
  });
  assert.equal(envelope.available, false);
  assert.match(envelope.reason, /did not emit JSON/);
});

test('runDeadcodeScan returns unavailable when spawn throws', () => {
  const envelope = runDeadcodeScan({
    workspaceRoot: '/r',
    workspaces: ['ws_apps/example-typescript'],
    spawn: () => {
      throw new Error('ENOENT npx');
    },
  });
  assert.equal(envelope.available, false);
  assert.match(envelope.reason, /spawn failed/);
});

// ---------------------------------------------------------------------------
// Gate integration: ratchet + regression
// ---------------------------------------------------------------------------

test('deadcode: unused-export-count tightens (direction=max) on improvement', () => {
  const baseline = baselineWithDeadcode({ total_unused: 5 });
  const { tightenings, changed, next } = ratchetBaseline(baseline, emptyReport(), {
    deadcode: envelope({ total_unused: 1 }),
  });
  assert.equal(changed, true);
  assert.equal(next.dimensions.MT01.metrics['unused-export-count'].baseline, 1);
  const t = tightenings.find((x) => x.metric === 'unused-export-count');
  assert.ok(t, 'expected tightening entry for unused-export-count');
  assert.equal(t.previous, 5);
  assert.equal(t.next, 1);
});

test('deadcode: regression is flagged without moving the floor', () => {
  const baseline = baselineWithDeadcode({ total_unused: 0 });
  const cmp = compareBaseline(baseline, emptyReport(), {
    deadcode: envelope({ total_unused: 3 }),
  });
  assert.equal(cmp.ok, false);
  assert.ok(
    cmp.regressions.some((r) => r.dimension === 'MT01' && r.metric === 'unused-export-count'),
    'expected MT01 unused-export-count regression to be flagged',
  );
});

test('deadcode: absent envelope (available=false) degrades to no-reading, not a false zero', () => {
  const baseline = baselineWithDeadcode({ total_unused: 3 });
  const cmp = compareBaseline(baseline, emptyReport(), {
    deadcode: { tool: 'knip', available: false, reason: 'npx missing' },
  });
  // No regression — when the adapter is unavailable the metric reads as null
  // so worsened() returns false. Same shape as the SC01/LG01/sentrux
  // no-reading contract for missing scanners.
  assert.equal(cmp.ok, true);
});

test('deadcode: main() with --deadcode flag tightens baseline.json on improvement', async () => {
  const seedEnvelope = envelope({ total_unused: 4 });
  const baselineJson = `${JSON.stringify(
    extractApssFitnessBaseline(emptyReport(), { deadcode: seedEnvelope }),
    null,
    2,
  )}\n`;
  const currentEnvelope = envelope({ total_unused: 0 });
  const deadcodeJson = `${JSON.stringify(currentEnvelope, null, 2)}\n`;

  const { io, writes, stdout } = stubIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': baselineJson,
      '/tmp/deadcode.json': deadcodeJson,
    },
  });

  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
      '--deadcode=/tmp/deadcode.json',
    ],
    io,
  );

  assert.equal(code, 0, 'deadcode improvement should exit 0');
  assert.equal(writes.length, 1, 'expected one baseline write for the tightened floor');
  const written = JSON.parse(writes[0].content);
  assert.equal(written.dimensions.MT01.metrics['unused-export-count'].baseline, 0);
  assert.match(stdout(), /VERDICT: PASS sensors gate/);
  assert.match(stdout(), /RATCHET: floor tightened/);
});

test('deadcode: main() with --deadcode flag — regression fails and leaves floor untouched', async () => {
  const seedEnvelope = envelope({ total_unused: 0 });
  const baselineJson = `${JSON.stringify(
    extractApssFitnessBaseline(emptyReport(), { deadcode: seedEnvelope }),
    null,
    2,
  )}\n`;
  const worseEnvelope = envelope({ total_unused: 2 });
  const deadcodeJson = `${JSON.stringify(worseEnvelope, null, 2)}\n`;

  const { io, writes, stdout } = stubIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': baselineJson,
      '/tmp/deadcode.json': deadcodeJson,
    },
  });

  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--policy=none',
      '--perf-baseline=harness/perf/baseline.json',
      '--deadcode=/tmp/deadcode.json',
    ],
    io,
  );

  assert.equal(code, 1, 'deadcode regression should exit non-zero');
  assert.equal(writes.length, 0, 'regression must not rewrite baseline');
  assert.match(stdout(), /VERDICT: FAIL sensors gate/);
  assert.match(stdout(), /unused-export-count/);
});
