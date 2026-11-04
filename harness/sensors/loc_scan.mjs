// loc_scan.mjs - per-file line-count (LOC) ratchet adapter for MT01.
//
// Encodes a ~500-LOC-per-file soft target as a DOWNWARD RATCHET rather than a
// hard ceiling. The metric VALUE is the MAXIMUM physical line count of any
// ACTIVE source file in the Cargo workspace. baseline.json seeds that value
// at the current worst file; the gate (direction "max") fails only when a
// file grows the maximum PAST the recorded baseline (a regression). Each
// time the worst file is legitimately shrunk, `just sensors gate
// --update-baseline` re-seeds the floor DOWNWARD, so the whole tree walks
// toward the ~500-line soft target without ever hard-failing at an arbitrary
// number.
//
// ENUMERATION - this adapter walks every Cargo workspace member (as declared
// under `[workspace] members` in the root Cargo.toml) from its crate ROOT,
// not only its src/, and counts the physical line count of every .rs file
// found there: a crate without src/ (a root-level [lib] path) is measured,
// root tests/ benches/ examples/, target/, node_modules/ and nested members
// are pruned, and every declared [lib]/[[bin]] path is in the scan wherever
// it sits. An unreadable path makes the reading unavailable, never partial. Ported from
// dream-ship_v0's per-file LOC ratchet (bead dreamship-v0-hjka), which
// shares its file enumeration with a mechanical architecture-fitness scan
// (harness/sensors/arch_fitness_scan.mjs, activeSourceFiles()) that does not
// exist in this template. Rather than force that dependency into existence
// here, this port keeps its own self-contained crate walk (dream-ship_v0's
// after its beads ltqc and jchs4) with no platform-cfg exclusion logic (the template ships no
// platform-gated modules to exclude). A future consumer fork that adds a
// mechanical architecture-fitness lens of its own may want to reconcile the
// two enumerations the way dream-ship_v0 did; until then this adapter does
// not assume that lens exists.
//
// CONTRACT - envelope shape consumed by gate.mjs via --loc=<path>:
//   {
//     "tool": "loc-scan",
//     "available": true | false,
//     "version": "1.0.0",
//     "soft_target_loc": 500,
//     "metrics": { "max_file_loc": <number>, "file_count": <number> },
//     "details": { "offenders": [ { "source": "...", "loc": N }, ... ] }
//   }
//
// SOFT-SKIP contract: when the root has no parseable Cargo workspace,
// listActiveSourceFiles() returns null; the envelope sets available=false
// and max_file_loc=null so gate.mjs degrades the MT01 max-file-loc metric to
// no-reading rather than a false zero - same shape as the sentrux / deadcode
// adapters.

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import TOML from '@iarna/toml';

export const SCAN_VERSION = '1.0.0';

// The soft target the ratchet walks the tree toward. Purely informational in
// the envelope; the gate compares against the seeded baseline, not this number.
export const SOFT_TARGET_LOC = 500;

// How many of the largest files to surface in the actionable offender list.
export const DEFAULT_OFFENDER_LIMIT = 15;

function physicalLineCount(body) {
  if (body.length === 0) {
    return 0;
  }
  const newlines = (body.match(/\n/g) ?? []).length;
  // A trailing newline does not add a line; a file with content but no
  // trailing newline still holds one line beyond its newline count.
  return body.endsWith('\n') ? newlines : newlines + 1;
}

function parseRootManifest(root, readFile) {
  try {
    return TOML.parse(readFile(join(root, 'Cargo.toml')));
  } catch {
    return null;
  }
}

function workspaceMembers(rootManifest) {
  const members = rootManifest?.workspace?.members;
  if (!Array.isArray(members)) {
    return [];
  }
  return members.filter((m) => typeof m === 'string');
}

// The crate walk below is dream-ship_v0's after its beads ltqc and jchs4 (harness/sensors/
// arch_fitness_scan.mjs there), minus its platform-cfg exclusion: a crate is walked from its ROOT,
// not only its src/, so a crate without src/ (a [lib] path = "lib.rs" at the root) is measured, and
// every declared [lib]/[[bin]] path is in the scan wherever it sits. A read that fails leaves the
// scan incomplete, never a max over the files that happened to be readable.

const SKIP_DIR_NAMES = new Set(['target', 'node_modules', '.git']);

// Cargo's non-library target dirs at a crate root. A src/ crate never walks them (they sit beside
// src/), so a root walk skips them too.
const CRATE_ROOT_NON_LIB_DIRS = new Set(['tests', 'benches', 'examples']);

// A real dir reached by more routes than this is an alias web, not a layout: the walk stops and the
// scan is incomplete, so the walk stays linear in the tree.
const MAX_ROUTES_PER_DIR = 8;

/** A scan that could not read every path it needed; its envelope is unavailable, never partial. */
export class IncompleteScanError extends Error {
  constructor(errors) {
    super(
      `source scan incomplete: ${errors.map((e) => `${e.op} ${e.path} (${e.code})`).join('; ')}`,
    );
    this.name = 'IncompleteScanError';
    this.errors = errors;
  }
}

function recordScanError(walkIo, path, op, error) {
  walkIo.errors.push({ path, op, code: error?.code ?? 'UNKNOWN' });
}

function tryReadDir(walkIo, dir) {
  try {
    return walkIo.readDir(dir);
  } catch (error) {
    recordScanError(walkIo, dir, 'readdir', error);
    return [];
  }
}

// The real path of p, or p itself when it cannot be resolved.
function realPathOr(walkIo, p) {
  try {
    return walkIo.realPath(p);
  } catch {
    return p;
  }
}

// The kind of a readdir entry: 'dir', 'file' or null. A symlink is followed to what it points at; a dangling one (ENOENT) is
// null, it has no bytes to count. Any other stat failure leaves the scan incomplete.
function direntKind(dirent, full, walkIo) {
  if (dirent.isDirectory()) {
    return 'dir';
  }
  if (dirent.isFile()) {
    return 'file';
  }
  if (!dirent.isSymbolicLink?.()) {
    return null;
  }
  try {
    const st = walkIo.stat(full);
    if (st.isDirectory()) {
      return 'dir';
    }
    return st.isFile() ? 'file' : null;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      recordScanError(walkIo, full, 'stat', error);
    }
    return null;
  }
}

function visitDirent(dirent, walk) {
  const full = join(walk.dir, dirent.name); // ubs:ignore[js.security.archive-entry] readdir name, not an archive path: the analyzer reads "Tar" in declaredTargetPaths as an archive type
  const kind = direntKind(dirent, full, walk.io);
  if (kind === 'dir' && !SKIP_DIR_NAMES.has(dirent.name) && !walk.skipDir(full)) {
    walk.stack.push({ dir: full, ancestors: walk.ancestors });
  } else if (kind === 'file' && dirent.name.endsWith('.rs')) {
    const real = dirent.isSymbolicLink?.()
      ? realPathOr(walk.io, full)
      : join(walk.realDir, dirent.name); // ubs:ignore[js.security.archive-entry] readdir name, not an archive path: the analyzer reads "Tar" in declaredTargetPaths as an archive type
    walk.out.push({ file: full, real });
  }
}

// Every .rs file under startDir, following symlinks, as { file, real } pairs. A dir whose real path
// is one of its own ancestors' is a link cycle and is not entered. skipDir(path) prunes subtrees
// beyond SKIP_DIR_NAMES.
function listRustFiles(startDir, walkIo, skipDir) {
  const out = [];
  const stack = [{ dir: startDir, ancestors: new Set() }];
  while (stack.length > 0) {
    const { dir, ancestors: parents } = stack.pop();
    const realDir = realPathOr(walkIo, dir);
    if (parents.has(realDir)) {
      continue;
    }
    const routes = (walkIo.routes.get(realDir) ?? 0) + 1;
    walkIo.routes.set(realDir, routes);
    if (routes > MAX_ROUTES_PER_DIR) {
      recordScanError(walkIo, dir, 'walk', { code: 'TOO_MANY_ROUTES' });
      continue;
    }
    const ancestors = new Set(parents).add(realDir);
    const walk = { dir, realDir, ancestors, io: walkIo, skipDir, stack, out };
    for (const dirent of tryReadDir(walkIo, dir)) {
      visitDirent(dirent, walk);
    }
  }
  return out;
}

// The explicit `path` of a crate's [lib] and each [[bin]].
function declaredTargetPaths(manifest) {
  const bins = Array.isArray(manifest?.bin) ? manifest.bin : [];
  return [manifest?.lib, ...bins].map((t) => t?.path).filter((p) => typeof p === 'string');
}

// True when the root walk prunes dir: outside the crate root, under a pruned root dir (examples/),
// under any SKIP_DIR_NAMES dir (src/node_modules/), or inside a nested workspace member.
function rootWalkPrunes(crate, dir, memberDirs) {
  const rel = relative(crate.dir, dir);
  if (rel === '') {
    return false;
  }
  const parts = rel.split('/');
  if (parts[0] === '..' || CRATE_ROOT_NON_LIB_DIRS.has(parts[0])) {
    return true;
  }
  return parts.some(
    (part, i) =>
      SKIP_DIR_NAMES.has(part) || memberDirs.has(join(crate.dir, ...parts.slice(0, i + 1))),
  );
}

// A crate's own source files: its whole root, minus the root's non-library dirs and any nested
// workspace member (walked as a crate of its own), plus each declared target's dir the root walk
// cannot reach and every declared target file itself (one not reached is added by itself, and a
// missing one then fails its read). The root, not only each target's dir, so a [lib] path in a
// subdir cannot leave a #[path = "../x.rs"] sibling unscanned.
function crateRustFiles(crate, memberDirs, walkIo) {
  const skipDir = (path) =>
    (dirname(path) === crate.dir && CRATE_ROOT_NON_LIB_DIRS.has(basename(path))) ||
    memberDirs.has(path);
  const unreached = new Set();
  for (const target of crate.targetPaths) {
    const dir = dirname(resolve(crate.dir, target));
    if (rootWalkPrunes(crate, dir, memberDirs)) {
      unreached.add(dir);
    }
  }
  const files = [crate.dir, ...unreached].flatMap((dir) => listRustFiles(dir, walkIo, skipDir));
  const paths = new Set(files.map((entry) => entry.file));
  for (const target of crate.targetPaths) {
    const file = resolve(crate.dir, target);
    if (!paths.has(file)) {
      paths.add(file);
      files.push({ file, real: realPathOr(walkIo, file) });
    }
  }
  return files;
}

// A member's manifest, read for its declared targets. One that cannot be read or parsed leaves the
// scan incomplete: a target it declares outside the walk would otherwise drop out unseen.
function readMemberManifest(dir, readFile, walkIo) {
  const path = join(dir, 'Cargo.toml');
  let text;
  try {
    text = readFile(path);
  } catch (error) {
    recordScanError(walkIo, path, 'read', error);
    return null;
  }
  try {
    return TOML.parse(text);
  } catch {
    recordScanError(walkIo, path, 'parse', { code: 'TOML' });
    return null;
  }
}

/**
 * Enumerate every active (workspace-member) .rs source file with its
 * physical line count, workspace-relative: each member walked from its crate
 * root (src-less crates included), every declared [lib]/[[bin]] path, each
 * real file once. Returns null when the root has no parseable Cargo
 * workspace (soft-skip), mirroring the shape of the other adapters'
 * no-workspace contract. Throws IncompleteScanError when a path the scan
 * needs cannot be read, so no reading is taken over a partial file set.
 */
export function listActiveSourceFiles(root, io = {}) {
  const readFile = io.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const rootManifest = parseRootManifest(root, readFile);
  const members = workspaceMembers(rootManifest);
  if (members.length === 0) {
    return null;
  }
  const walkIo = {
    readDir: io.readDir ?? ((dir) => readdirSync(dir, { withFileTypes: true })),
    realPath: io.realPath ?? realpathSync,
    stat: io.stat ?? statSync,
    errors: [],
    routes: new Map(),
  };
  const crates = members.map((member) => {
    const dir = join(root, member);
    return { dir, targetPaths: declaredTargetPaths(readMemberManifest(dir, readFile, walkIo)) };
  });
  const memberDirs = new Set(crates.map((crate) => crate.dir));
  const seen = new Set();
  const out = [];
  for (const crate of crates) {
    for (const { file, real } of crateRustFiles(crate, memberDirs, walkIo)) {
      if (seen.has(real)) {
        continue;
      }
      seen.add(real);
      let body;
      try {
        body = readFile(file);
      } catch (error) {
        recordScanError(walkIo, file, 'read', error);
        continue;
      }
      out.push({ file: relative(root, file), lines: physicalLineCount(body) });
    }
  }
  if (walkIo.errors.length > 0) {
    throw new IncompleteScanError(
      walkIo.errors.map((e) => ({ ...e, path: relative(root, e.path) })),
    );
  }
  return out;
}

/**
 * Pure core: given a list of active files as { file, lines } records, return
 * the LOC rollup the ratchet needs. Deterministic and filesystem-free so it is
 * fully unit-testable:
 *   - max_file_loc: the largest single-file line count (0 for an empty set),
 *   - file_count: how many files were measured,
 *   - offenders: the top-N files by LOC (ties broken by path, ascending),
 *   - per_source: every file as { source, loc }, sorted the same way.
 * Sorting by (loc desc, path asc) makes both the max and the offender list
 * independent of the input order.
 */
export function summarizeLoc(files, { offenderLimit = DEFAULT_OFFENDER_LIMIT } = {}) {
  const perSource = files
    .map((entry) => ({ source: entry.file, loc: entry.lines }))
    .sort((a, b) => b.loc - a.loc || compareSource(a.source, b.source));
  const maxFileLoc = perSource.length === 0 ? 0 : perSource[0].loc;
  return {
    max_file_loc: maxFileLoc,
    file_count: perSource.length,
    offenders: perSource.slice(0, offenderLimit),
    per_source: perSource,
  };
}

function compareSource(a, b) {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Run the LOC scan. The active-file lister is injectable (default:
 * listActiveSourceFiles over the real Cargo workspace) so unit tests drive
 * the rollup without touching disk. A null return from the lister is the
 * no-workspace soft-skip.
 */
export function runLocScan({
  workspaceRoot = process.cwd(),
  listFiles = listActiveSourceFiles,
  offenderLimit = DEFAULT_OFFENDER_LIMIT,
  io = {},
} = {}) {
  let files;
  try {
    files = listFiles(workspaceRoot, io);
  } catch (error) {
    if (!(error instanceof IncompleteScanError)) {
      throw error;
    }
    return unavailable(error.message);
  }
  if (files === null || files === undefined) {
    return unavailable('no Cargo workspace members found');
  }
  const summary = summarizeLoc(files, { offenderLimit });
  return {
    tool: 'loc-scan',
    available: true,
    version: SCAN_VERSION,
    soft_target_loc: SOFT_TARGET_LOC,
    metrics: { max_file_loc: summary.max_file_loc, file_count: summary.file_count },
    details: { offenders: summary.offenders },
  };
}

// The no-reading envelope: gate.mjs degrades max-file-loc to no-reading, never a false zero.
function unavailable(reason) {
  return {
    tool: 'loc-scan',
    available: false,
    reason,
    version: SCAN_VERSION,
    soft_target_loc: SOFT_TARGET_LOC,
    metrics: { max_file_loc: null, file_count: null },
    details: { offenders: [] },
  };
}

export function parseArgs(argv) {
  const args = { workspaceRoot: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--workspace-root' || arg === '--root') {
      args.workspaceRoot = argv[i + 1] ?? args.workspaceRoot;
      i += 1;
    } else if (arg.startsWith('--workspace-root=')) {
      args.workspaceRoot = arg.slice('--workspace-root='.length);
    } else if (arg.startsWith('--root=')) {
      args.workspaceRoot = arg.slice('--root='.length);
    } else if (arg === '--floor') {
      args.floor = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--floor=')) {
      args.floor = Number(arg.slice('--floor='.length));
    }
  }
  return args;
}

/**
 * Every active file whose LOC is STRICTLY ABOVE `floor` (e.g. the committed
 * MT01 max-file-loc baseline), sorted the same way as `offenders`
 * (loc desc, path asc). Unlike `offenders` (fixed top-N), this is the FULL
 * requisition list a decomposition pass needs: fixing the single current max
 * only promotes the next-largest file to be the new max on the following
 * gate run (whack-a-mole) when several files already sit above the floor.
 * Surfacing all of them at once lets that work be parallelized instead.
 */
export function filesOverFloor(perSource, floor) {
  return perSource.filter((entry) => entry.loc > floor);
}

export function main(argv = process.argv.slice(2), io = { write: (s) => process.stdout.write(s) }) {
  const args = parseArgs(argv);
  const envelope = runLocScan({
    workspaceRoot: args.workspaceRoot,
    listFiles: io.listFiles ?? listActiveSourceFiles,
    offenderLimit: Number.isFinite(args.floor) ? Infinity : DEFAULT_OFFENDER_LIMIT,
    io,
  });
  if (Number.isFinite(args.floor)) {
    const over = filesOverFloor(envelope.details.offenders, args.floor);
    io.write(
      `${over.length} file(s) over the ${args.floor}-line floor (current max ${envelope.metrics.max_file_loc}):\n`,
    );
    for (const entry of over) {
      io.write(`  ${entry.loc}  ${entry.source}\n`);
    }
    return 0;
  }
  io.write(`${JSON.stringify(envelope, null, 2)}\n`);
  return 0;
}

function isScriptEntry() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isScriptEntry()) {
  main();
  process.exit(0);
}
