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
  IncompleteScanError,
  listActiveSourceFiles,
  main as locMain,
  parseArgs,
  runLocScan,
  SOFT_TARGET_LOC,
  summarizeLoc,
} from '../loc_scan.mjs';

// The JSON a run wrote, or a failed assertion naming the text that is not JSON.
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    assert.fail(`not JSON (${error.message}): ${text}`);
  }
}

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
  const code = locMain(['--workspace-root=/r', '--floor=765'], {
    write: (s) => out.push(s),
    listFiles,
  });
  assert.equal(code, 0);
  assert.equal(
    out.join(''),
    '2 file(s) over the 765-line floor (current max 900):\n  900  a.rs\n  800  b.rs\n',
  );
});

test('loc_scan main() keeps the normal JSON offender list capped at DEFAULT_OFFENDER_LIMIT', () => {
  const listFiles = () =>
    Array.from({ length: DEFAULT_OFFENDER_LIMIT + 5 }, (_, index) => ({
      file: `file-${index}.rs`,
      lines: 1000 - index,
    }));
  const out = [];
  const code = locMain(['--workspace-root=/r'], { write: (s) => out.push(s), listFiles });
  assert.equal(code, 0);
  const env = parseJson(out.join(''));
  assert.equal(env.details.offenders.length, DEFAULT_OFFENDER_LIMIT);
});

test('loc_scan main() writes a JSON envelope and returns 0 (soft-skip on a non-workspace root)', () => {
  const out = [];
  const code = locMain(['--workspace-root=/definitely-not-a-workspace-xyz'], {
    write: (s) => out.push(s),
  });
  assert.equal(code, 0);
  const env = parseJson(out.join(''));
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

test('listActiveSourceFiles lists nothing for a workspace member that holds no .rs file', () => {
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
// Enumeration: crate-root walk (dream-ship_v0 beads ltqc, jchs4)
// ---------------------------------------------------------------------------

const LINK = Symbol('link');
const UNREADABLE = Symbol('unreadable');
const link = (to) => ({ [LINK]: to });
// An unreadable file still lists as a file and an unreadable dir as a dir; only reading fails.
const unreadable = { [UNREADABLE]: 'file' };
const unreadableDir = { [UNREADABLE]: 'dir' };
const eacces = (op, p) => Object.assign(new Error(`${op} ${p}`), { code: 'EACCES' });

// An in-memory tree with symlinks and unreadable paths: a string is a file, an object a dir,
// link(abs) a symlink, unreadable / unreadableDir a path every read of which fails with EACCES.
function buildLinkedFs(root, tree) {
  const nodes = new Map();
  const walk = (prefix, node) => {
    nodes.set(prefix, node);
    if (typeof node === 'object' && !node[LINK] && !node[UNREADABLE]) {
      for (const [name, val] of Object.entries(node)) {
        walk(`${prefix}/${name}`, val);
      }
    }
  };
  walk(root, tree);
  const realPath = (p, depth = 0) => {
    if (depth > 40) {
      throw Object.assign(new Error(`loop ${p}`), { code: 'ELOOP' });
    }
    const parts = p.split('/');
    for (let i = 2; i <= parts.length; i += 1) {
      const head = parts.slice(0, i).join('/');
      const node = nodes.get(head);
      if (node?.[LINK]) {
        return realPath([node[LINK], ...parts.slice(i)].join('/'), depth + 1);
      }
    }
    if (!nodes.has(p)) {
      throw Object.assign(new Error(`no ${p}`), { code: 'ENOENT' });
    }
    return p;
  };
  const resolved = (p) => nodes.get(realPath(p));
  const isDir = (n) => typeof n === 'object' && !n[UNREADABLE];
  return {
    realPath,
    readFile: (p) => {
      const n = resolved(p);
      if (n?.[UNREADABLE]) {
        throw eacces('read', p);
      }
      if (typeof n !== 'string') {
        throw Object.assign(new Error(`no file ${p}`), { code: 'ENOENT' });
      }
      return n;
    },
    stat: (p) => {
      const n = resolved(p);
      if (n?.[UNREADABLE]) {
        throw eacces('stat', p);
      }
      return { isDirectory: () => isDir(n), isFile: () => typeof n === 'string' };
    },
    readDir: (d) => {
      const n = resolved(d);
      if (n?.[UNREADABLE]) {
        throw eacces('readdir', d);
      }
      if (!isDir(n)) {
        throw Object.assign(new Error(`not a dir ${d}`), { code: 'ENOTDIR' });
      }
      return Object.entries(n).map(([name, val]) => ({
        name,
        isFile: () => typeof val === 'string' || val?.[UNREADABLE] === 'file',
        isDirectory: () => (isDir(val) && !val[LINK]) || val?.[UNREADABLE] === 'dir',
        isSymbolicLink: () => Boolean(val?.[LINK]),
      }));
    },
  };
}

const lines = (files) => Object.fromEntries(files.map((f) => [f.file, f.lines]));

test('a crate without src/ is walked from its root: its [lib] path and every module beside it count', () => {
  const tree = {
    'Cargo.toml': rootManifest(['contexts/knowledge']),
    contexts: {
      knowledge: {
        'Cargo.toml': '[package]\nname = "knowledge"\n[lib]\npath = "lib.rs"\n',
        'lib.rs': 'mod domain;\n',
        domain: { 'mod.rs': body(900), 'item.rs': body(40) },
      },
    },
  };
  assert.deepEqual(lines(listActiveSourceFiles(ROOT, buildLinkedFs(ROOT, tree))), {
    'contexts/knowledge/lib.rs': 1,
    'contexts/knowledge/domain/mod.rs': 900,
    'contexts/knowledge/domain/item.rs': 40,
  });
  const env = runLocScan({ workspaceRoot: ROOT, io: buildLinkedFs(ROOT, tree) });
  assert.equal(env.metrics.max_file_loc, 900, 'the src-less crate sets the maximum');
});

test('the root walk prunes tests/ benches/ examples/ target/ node_modules/ and walks a nested member once', () => {
  const tree = {
    'Cargo.toml': rootManifest(['crates/app', 'crates/app/inner']),
    crates: {
      app: {
        'Cargo.toml': '[package]\nname = "app"\n',
        'build.rs': body(3),
        src: { 'main.rs': body(2), bin: { 'tool.rs': body(4) } },
        tests: { 'it.rs': body(999) },
        benches: { 'b.rs': body(999) },
        examples: { 'e.rs': body(999) },
        target: { 'gen.rs': body(999) },
        node_modules: { 'x.rs': body(999) },
        inner: { 'Cargo.toml': '[package]\nname = "inner"\n', src: { 'lib.rs': body(5) } },
      },
    },
  };
  assert.deepEqual(lines(listActiveSourceFiles(ROOT, buildLinkedFs(ROOT, tree))), {
    'crates/app/build.rs': 3,
    'crates/app/src/main.rs': 2,
    'crates/app/src/bin/tool.rs': 4,
    'crates/app/inner/src/lib.rs': 5,
  });
});

test('a declared target the root walk cannot reach is still scanned, with its dir', () => {
  const tree = {
    'Cargo.toml': rootManifest(['crates/app']),
    crates: {
      app: {
        'Cargo.toml':
          '[package]\nname = "app"\n[lib]\npath = "../shared/lib.rs"\n[[bin]]\nname = "t"\npath = "examples/tool.rs"\n',
        examples: { 'tool.rs': body(7), 'other.rs': body(999) },
      },
      shared: { 'lib.rs': body(6), 'part.rs': body(8) },
    },
  };
  assert.deepEqual(lines(listActiveSourceFiles(ROOT, buildLinkedFs(ROOT, tree))), {
    'crates/shared/lib.rs': 6,
    'crates/shared/part.rs': 8,
    'crates/app/examples/tool.rs': 7,
    'crates/app/examples/other.rs': 999,
  });
});

test('a declared target that does not exist fails the reading closed', () => {
  const tree = {
    'Cargo.toml': rootManifest(['crates/app']),
    crates: { app: { 'Cargo.toml': '[package]\nname = "app"\n[lib]\npath = "lib.rs"\n' } },
  };
  assert.throws(() => listActiveSourceFiles(ROOT, buildLinkedFs(ROOT, tree)), IncompleteScanError);
});

test('an unreadable file or dir fails the reading closed: unavailable, never a partial max', () => {
  for (const hidden of [{ 'big.rs': unreadable }, { deep: unreadableDir }]) {
    const tree = {
      'Cargo.toml': rootManifest(['crates/app']),
      crates: {
        app: { 'Cargo.toml': '[package]\nname = "app"\n', src: { 'lib.rs': body(9), ...hidden } },
      },
    };
    assert.throws(
      () => listActiveSourceFiles(ROOT, buildLinkedFs(ROOT, tree)),
      IncompleteScanError,
    );
    const env = runLocScan({ workspaceRoot: ROOT, io: buildLinkedFs(ROOT, tree) });
    assert.equal(env.available, false);
    assert.equal(env.metrics.max_file_loc, null);
    assert.match(
      env.reason,
      /source scan incomplete: (read|readdir) crates\/app\/src\/(big\.rs|deep) \(EACCES\)/,
    );
  }
});

test('an unreadable or unparsable member manifest fails the reading closed (Codex tu792 p1)', () => {
  const shared = { 'lib.rs': body(500) };
  for (const manifest of [
    unreadable,
    '[package\nname = "app"\n[lib]\npath = "../shared/lib.rs"\n',
  ]) {
    const tree = {
      'Cargo.toml': rootManifest(['crates/app']),
      crates: { app: { 'Cargo.toml': manifest, src: { 'main.rs': body(2) } }, shared },
    };
    const env = runLocScan({ workspaceRoot: ROOT, io: buildLinkedFs(ROOT, tree) });
    assert.equal(env.available, false, 'never a max without the target the manifest may declare');
    assert.match(env.reason, /(read|parse) crates\/app\/Cargo\.toml \((EACCES|TOML)\)/);
  }
});

test('a listed member whose dir is missing fails the reading closed', () => {
  const tree = { 'Cargo.toml': rootManifest(['crates/gone']) };
  assert.throws(() => listActiveSourceFiles(ROOT, buildLinkedFs(ROOT, tree)), IncompleteScanError);
});

test('symlinks are followed, a link cycle terminates, and each real file counts once', () => {
  const tree = {
    'Cargo.toml': rootManifest(['crates/app']),
    crates: {
      app: {
        'Cargo.toml': '[package]\nname = "app"\n',
        src: {
          'lib.rs': body(2),
          linked: link(`${ROOT}/vendor/gen`),
          'alias.rs': link(`${ROOT}/crates/app/src/lib.rs`),
          loop: link(`${ROOT}/crates/app/src`),
          'dangling.rs': link(`${ROOT}/nowhere.rs`),
        },
      },
    },
    vendor: { gen: { 'made.rs': body(11) } },
  };
  assert.deepEqual(lines(listActiveSourceFiles(ROOT, buildLinkedFs(ROOT, tree))), {
    'crates/app/src/lib.rs': 2,
    'crates/app/src/linked/made.rs': 11,
  });
});

test('a symlink whose target cannot be stat-ed fails the reading closed', () => {
  const tree = {
    'Cargo.toml': rootManifest(['crates/app']),
    crates: {
      app: {
        'Cargo.toml': '[package]\nname = "app"\n',
        src: { 'lib.rs': body(1), 'locked.rs': link(`${ROOT}/locked.rs`) },
      },
    },
    'locked.rs': unreadable,
  };
  assert.throws(() => listActiveSourceFiles(ROOT, buildLinkedFs(ROOT, tree)), IncompleteScanError);
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
  const written = parseJson(writes[0].content);
  assert.equal(written.dimensions.MT01.metrics['max-file-loc'].baseline, 800);
  assert.match(stdout(), /VERDICT: PASS sensors gate/);
  assert.match(stdout(), /RATCHET: floor tightened/);
});
