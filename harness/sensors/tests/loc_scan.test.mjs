// Tests for the per-file LOC ratchet adapter (harness/sensors/loc_scan.mjs),
// wired through harness/sensors/gate.mjs via the --loc=<path> flag. Mirrors
// deadcode.test.mjs in shape: a pure adapter core driven with injected data
// plus an in-memory filesystem, plus the closed loop through the gate
// proving the ratchet semantics (regression fails without moving the floor;
// a legitimate shrink tightens the floor downward).
//
// Ported from dream-ship_v0's per-file LOC ratchet (bead dreamship-v0-hjka).
// dream-ship_v0's version shares its active-file enumeration with a
// mechanical architecture-fitness scan (harness/sensors/arch_fitness_scan.mjs
// activeSourceFiles()) that does not exist in this template, so this port's
// loc_scan.mjs carries its own small, self-contained workspace-member/src/
// walk (listActiveSourceFiles) instead of importing a shared enumeration.
//
// The contract under test:
//   - The metric VALUE is the MAX physical line count across active Cargo
//     workspace source files. summarizeLoc is a pure function over
//     { file, lines } records, so the max / offender-list / per-source
//     rollup is deterministic and needs no disk.
//   - Metrics flow in through --loc=<path>; the MT01 max-file-loc metric
//     reads `max_file_loc`. Direction max (smaller-is-better): a value
//     ABOVE the recorded baseline is a REGRESSION (gate fail); a shrink
//     tightens the floor; an unavailable envelope degrades to no-reading,
//     not a false zero.
//
// Run via: node --test harness/sensors/tests/loc_scan.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareBaseline, extractApssFitnessBaseline, main, ratchetBaseline } from '../gate.mjs';
import {
  DEFAULT_OFFENDER_LIMIT,
  filesOverFloor,
  listActiveSourceFiles,
  main as locMain,
  parseArgs,
  runLocScan,
  SOFT_TARGET_LOC,
  summarizeLoc,
} from '../loc_scan.mjs';

function emptyReport() {
  return {
    workspace: { folders: [], modules: [], circular_edges: 0 },
  };
}

function locEnvelope(maxLoc, fileCount = 10) {
  return {
    tool: 'loc-scan',
    available: true,
    version: '1.0.0',
    soft_target_loc: SOFT_TARGET_LOC,
    metrics: { max_file_loc: maxLoc, file_count: fileCount },
    details: { offenders: [] },
  };
}

function baselineWithLoc(maxLoc) {
  return extractApssFitnessBaseline(emptyReport(), { loc: locEnvelope(maxLoc) });
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

// Build an in-memory FS from a nested tree of { name: string|object }: a
// string is a file body, an object is a directory.
function buildFs(root, tree) {
  const files = new Map();
  const dirEntries = new Map();
  const walk = (prefix, node) => {
    const entries = [];
    for (const [name, val] of Object.entries(node)) {
      const full = `${prefix}/${name}`;
      if (typeof val === 'string') {
        files.set(full, val);
        entries.push({ name, isFile: () => true, isDirectory: () => false });
      } else {
        entries.push({ name, isFile: () => false, isDirectory: () => true });
        walk(full, val);
      }
    }
    dirEntries.set(prefix, entries);
  };
  walk(root, tree);
  return {
    readFile: (p) => {
      if (!files.has(p)) {
        throw new Error(`stub: no such file ${p}`);
      }
      return files.get(p);
    },
    fileExists: (p) => files.has(p) || dirEntries.has(p),
    readDir: (d) => {
      if (!dirEntries.has(d)) {
        throw new Error(`stub: not a directory ${d}`);
      }
      return dirEntries.get(d);
    },
  };
}

function rootManifest(members) {
  return `[workspace]\nmembers = [${members.map((m) => `"${m}"`).join(', ')}]\n`;
}

function body(lines) {
  return `${Array.from({ length: lines }, (_, i) => `// line ${i}`).join('\n')}\n`;
}

const ROOT = '/ws';

// ---------------------------------------------------------------------------
// Pure core: summarizeLoc
// ---------------------------------------------------------------------------

test('summarizeLoc computes the max, count, ranked offenders, and per-source', () => {
  const files = [
    { file: 'a.rs', lines: 100 },
    { file: 'b.rs', lines: 500 },
    { file: 'c.rs', lines: 250 },
  ];
  const out = summarizeLoc(files);
  assert.equal(out.max_file_loc, 500);
  assert.equal(out.file_count, 3);
  assert.deepEqual(
    out.per_source.map((e) => e.source),
    ['b.rs', 'c.rs', 'a.rs'],
  );
  assert.deepEqual(out.offenders[0], { source: 'b.rs', loc: 500 });
});

test('summarizeLoc breaks LOC ties by path ascending (deterministic)', () => {
  const files = [
    { file: 'z.rs', lines: 400 },
    { file: 'a.rs', lines: 400 },
    { file: 'm.rs', lines: 400 },
  ];
  const out = summarizeLoc(files);
  assert.deepEqual(
    out.per_source.map((e) => e.source),
    ['a.rs', 'm.rs', 'z.rs'],
  );
  assert.equal(out.max_file_loc, 400);
});

test('summarizeLoc honours the offender limit and truncates the ranked list', () => {
  const files = Array.from({ length: 25 }, (_, i) => ({
    file: `f${String(i).padStart(2, '0')}.rs`,
    lines: 1000 - i,
  }));
  const out = summarizeLoc(files);
  assert.equal(out.offenders.length, DEFAULT_OFFENDER_LIMIT);
  assert.equal(out.per_source.length, 25);
  assert.equal(out.offenders[0].loc, 1000);
  const three = summarizeLoc(files, { offenderLimit: 3 });
  assert.equal(three.offenders.length, 3);
});

test('summarizeLoc is stable for equal-path, equal-loc entries (compareSource tie)', () => {
  const files = [
    { file: 'dup.rs', lines: 300 },
    { file: 'dup.rs', lines: 300 },
  ];
  const out = summarizeLoc(files);
  assert.equal(out.max_file_loc, 300);
  assert.equal(out.file_count, 2);
  assert.deepEqual(
    out.per_source.map((e) => e.source),
    ['dup.rs', 'dup.rs'],
  );
});

test('summarizeLoc returns max 0 for an empty file set', () => {
  const out = summarizeLoc([]);
  assert.equal(out.max_file_loc, 0);
  assert.equal(out.file_count, 0);
  assert.deepEqual(out.offenders, []);
  assert.deepEqual(out.per_source, []);
});

// ---------------------------------------------------------------------------
// IO shell: runLocScan / parseArgs / main
// ---------------------------------------------------------------------------

test('runLocScan builds an available envelope from an injected file list', () => {
  const listFiles = () => [
    { file: 'big.rs', lines: 900 },
    { file: 'small.rs', lines: 12 },
  ];
  const env = runLocScan({ workspaceRoot: '/r', listFiles });
  assert.equal(env.available, true);
  assert.equal(env.tool, 'loc-scan');
  assert.equal(env.metrics.max_file_loc, 900);
  assert.equal(env.metrics.file_count, 2);
  assert.equal(env.soft_target_loc, SOFT_TARGET_LOC);
  assert.equal(env.details.offenders[0].source, 'big.rs');
});

test('runLocScan soft-skips (available=false, null metric) when there is no workspace', () => {
  const env = runLocScan({ workspaceRoot: '/r', listFiles: () => null });
  assert.equal(env.available, false);
  assert.match(env.reason, /no Cargo workspace/);
  assert.equal(env.metrics.max_file_loc, null);
  assert.equal(env.metrics.file_count, null);
  assert.deepEqual(env.details.offenders, []);
});

test('parseArgs accepts --workspace-root, --root, and their = forms; defaults to cwd', () => {
  assert.equal(parseArgs(['--workspace-root', '/a']).workspaceRoot, '/a');
  assert.equal(parseArgs(['--workspace-root=/b']).workspaceRoot, '/b');
  assert.equal(parseArgs(['--root', '/c']).workspaceRoot, '/c');
  assert.equal(parseArgs(['--root=/d']).workspaceRoot, '/d');
  assert.equal(parseArgs([]).workspaceRoot, process.cwd());
});

test('parseArgs accepts --floor and its = form', () => {
  assert.equal(parseArgs(['--floor', '765']).floor, 765);
  assert.equal(parseArgs(['--floor=500']).floor, 500);
  assert.equal(parseArgs([]).floor, undefined);
});

test('filesOverFloor returns every entry strictly above the floor, not just the top-N', () => {
  const perSource = [
    { source: 'a.rs', loc: 900 },
    { source: 'b.rs', loc: 800 },
    { source: 'c.rs', loc: 765 },
    { source: 'd.rs', loc: 400 },
  ];
  assert.deepEqual(filesOverFloor(perSource, 765), [
    { source: 'a.rs', loc: 900 },
    { source: 'b.rs', loc: 800 },
  ]);
  // At-the-floor is not a regression, so it must not be reported as "over".
  assert.deepEqual(filesOverFloor(perSource, 800), [{ source: 'a.rs', loc: 900 }]);
});

test('loc_scan main() with --floor reports every offender above it, not just the current max', () => {
  const listFiles = () => [
    { file: 'a.rs', lines: 900 },
    { file: 'b.rs', lines: 800 },
    { file: 'c.rs', lines: 765 },
    { file: 'd.rs', lines: 400 },
  ];
  const originalScan = runLocScan({ workspaceRoot: '/r', listFiles });
  assert.equal(originalScan.metrics.max_file_loc, 900);

  const out = [];
  const code = locMain(['--workspace-root=/r', '--floor=765'], { write: (s) => out.push(s) });
  // main() defaults to the real listActiveSourceFiles lister, which will
  // soft-skip on a non-workspace root; assert the CLI still returns 0 and
  // prints the human "N file(s) over the floor" report shape rather than JSON.
  assert.equal(code, 0);
  assert.match(out.join(''), /file\(s\) over the 765-line floor/);
});

test('loc_scan main() writes a JSON envelope and returns 0 (soft-skip on a non-workspace root)', () => {
  const out = [];
  const code = locMain(['--workspace-root=/definitely-not-a-workspace-xyz'], {
    write: (s) => out.push(s),
  });
  assert.equal(code, 0);
  const env = JSON.parse(out.join(''));
  assert.equal(env.tool, 'loc-scan');
  assert.equal(env.available, false);
});

// ---------------------------------------------------------------------------
// Enumeration: listActiveSourceFiles
// ---------------------------------------------------------------------------

test('listActiveSourceFiles counts physical lines per .rs file under every workspace member src/', () => {
  const tree = {
    'Cargo.toml': rootManifest(['ws_packages/compositor']),
    ws_packages: {
      compositor: {
        'Cargo.toml': '[package]\nname = "compositor"\n',
        src: {
          'lib.rs': '#[path = "core.rs"]\nmod core;\n',
          'core.rs': body(120),
          nested: {
            'deep.rs': body(30),
          },
        },
      },
    },
  };
  const io = buildFs(ROOT, tree);
  const files = listActiveSourceFiles(ROOT, io);
  const byName = Object.fromEntries(files.map((f) => [f.file.split('/').pop(), f.lines]));
  assert.equal(byName['core.rs'], 120);
  assert.equal(byName['lib.rs'], 2);
  assert.equal(byName['deep.rs'], 30, 'nested source directories are walked recursively');
});

test('listActiveSourceFiles handles empty files and trailing-newline edges', () => {
  const tree = {
    'Cargo.toml': rootManifest(['ws_packages/x']),
    ws_packages: {
      x: {
        'Cargo.toml': '[package]\nname = "x"\n',
        src: {
          'empty.rs': '', // 0 physical lines
          'one_nl.rs': 'a\n', // 1 line, trailing newline does not add a line
          'no_nl.rs': 'a\nb', // 2 lines, no trailing newline
        },
      },
    },
  };
  const io = buildFs(ROOT, tree);
  const files = listActiveSourceFiles(ROOT, io);
  const byName = Object.fromEntries(files.map((f) => [f.file.split('/').pop(), f.lines]));
  assert.equal(byName['empty.rs'], 0);
  assert.equal(byName['one_nl.rs'], 1);
  assert.equal(byName['no_nl.rs'], 2);
});

test('listActiveSourceFiles returns null when the root has no Cargo workspace', () => {
  const tree = { 'README.md': '# no workspace\n' };
  const io = buildFs(ROOT, tree);
  assert.equal(listActiveSourceFiles(ROOT, io), null);
});

test('listActiveSourceFiles skips a workspace member with no src/ directory', () => {
  const tree = {
    'Cargo.toml': rootManifest(['ws_packages/no-src']),
    ws_packages: {
      'no-src': {
        'Cargo.toml': '[package]\nname = "no-src"\n',
      },
    },
  };
  const io = buildFs(ROOT, tree);
  assert.deepEqual(listActiveSourceFiles(ROOT, io), []);
});

// ---------------------------------------------------------------------------
// Gate integration: ratchet + regression semantics
// ---------------------------------------------------------------------------

test('loc: max-file-loc tightens (direction=max) when the worst file shrinks', () => {
  const baseline = baselineWithLoc(1705);
  const { tightenings, changed, next } = ratchetBaseline(baseline, emptyReport(), {
    loc: locEnvelope(900),
  });
  assert.equal(changed, true);
  assert.equal(next.dimensions.MT01.metrics['max-file-loc'].baseline, 900);
  const t = tightenings.find((x) => x.metric === 'max-file-loc');
  assert.ok(t, 'expected a tightening entry for max-file-loc');
  assert.equal(t.previous, 1705);
  assert.equal(t.next, 900);
});

test('loc: a file exceeding the recorded baseline is flagged as a regression (floor unmoved)', () => {
  const baseline = baselineWithLoc(1705);
  const cmp = compareBaseline(baseline, emptyReport(), { loc: locEnvelope(1706) });
  assert.equal(cmp.ok, false);
  assert.ok(
    cmp.regressions.some((r) => r.dimension === 'MT01' && r.metric === 'max-file-loc'),
    'expected an MT01 max-file-loc regression to be flagged',
  );
});

test('loc: a value at the baseline passes (equal is not a regression)', () => {
  const baseline = baselineWithLoc(1705);
  const cmp = compareBaseline(baseline, emptyReport(), { loc: locEnvelope(1705) });
  assert.equal(cmp.ok, true);
});

test('loc: absent envelope (available=false) degrades to no-reading, not a false zero', () => {
  const baseline = baselineWithLoc(1705);
  const cmp = compareBaseline(baseline, emptyReport(), {
    loc: { tool: 'loc-scan', available: false, reason: 'no workspace' },
  });
  // No regression — when the adapter is unavailable the metric reads as null
  // so worsened() returns false. Same shape as the SC01/LG01/sentrux/deadcode
  // no-reading contract for missing scanners.
  assert.equal(cmp.ok, true);
});

test('loc: main() with --loc: regression fails and leaves the floor untouched', async () => {
  const baselineJson = `${JSON.stringify(
    extractApssFitnessBaseline(emptyReport(), { loc: locEnvelope(1705) }),
    null,
    2,
  )}\n`;
  const locJson = `${JSON.stringify(locEnvelope(1706), null, 2)}\n`;
  const { io, writes, stdout } = stubIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': baselineJson,
      '/tmp/loc.json': locJson,
    },
  });
  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--skip-baseline-relaxation-guard',
      '--policy=none',
      '--profile=none',
      '--perf-baseline=harness/perf/baseline.json',
      '--loc=/tmp/loc.json',
    ],
    io,
  );
  assert.equal(code, 1, 'loc regression should exit non-zero');
  assert.equal(writes.length, 0, 'regression must not rewrite the baseline');
  assert.match(stdout(), /VERDICT: FAIL sensors gate/);
  assert.match(stdout(), /max-file-loc/);
});

test('loc: main() with --loc tightens the baseline on a shrink (mirrors deadcode auto-ratchet-on-improvement)', async () => {
  const baselineJson = `${JSON.stringify(
    extractApssFitnessBaseline(emptyReport(), { loc: locEnvelope(1705) }),
    null,
    2,
  )}\n`;
  const locJson = `${JSON.stringify(locEnvelope(800), null, 2)}\n`;
  const { io, writes, stdout } = stubIo({
    stdin: JSON.stringify(emptyReport()),
    files: {
      'harness/sensors/baseline.json': baselineJson,
      '/tmp/loc.json': locJson,
    },
  });
  const code = await main(
    [
      '--baseline=harness/sensors/baseline.json',
      '--skip-baseline-relaxation-guard',
      '--policy=none',
      '--profile=none',
      '--perf-baseline=harness/perf/baseline.json',
      '--loc=/tmp/loc.json',
    ],
    io,
  );
  assert.equal(code, 0, 'loc improvement should exit 0');
  assert.equal(writes.length, 1, 'expected one baseline write for the tightened floor');
  const written = JSON.parse(writes[0].content);
  assert.equal(written.dimensions.MT01.metrics['max-file-loc'].baseline, 800);
  assert.match(stdout(), /VERDICT: PASS sensors gate/);
  assert.match(stdout(), /RATCHET: floor tightened/);
});
