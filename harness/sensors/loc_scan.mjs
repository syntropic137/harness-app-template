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
// ENUMERATION - this adapter walks every Cargo workspace member's src/ tree
// (as declared under `[workspace] members` in the root Cargo.toml) and
// counts the physical line count of every .rs file found there. Ported from
// dream-ship_v0's per-file LOC ratchet (bead dreamship-v0-hjka), which
// shares its file enumeration with a mechanical architecture-fitness scan
// (harness/sensors/arch_fitness_scan.mjs, activeSourceFiles()) that does not
// exist in this template. Rather than force that dependency into existence
// here, this port keeps its own small, self-contained workspace-member/src/
// walk with no platform-cfg exclusion logic (the template ships no
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

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
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

// List every .rs file under `dir`, recursively, using the injectable
// readDir/fileExists pair so unit tests can drive this from an in-memory
// filesystem.
function listRustFiles(dir, readDir) {
  const out = [];
  let entries;
  try {
    entries = readDir(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listRustFiles(full, readDir));
    } else if (entry.isFile() && full.endsWith('.rs')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Enumerate every active (workspace-member) .rs source file with its
 * physical line count, workspace-relative. Returns null when the root has
 * no parseable Cargo workspace (soft-skip), mirroring the shape of the
 * other adapters' no-workspace contract.
 */
export function listActiveSourceFiles(root, io = {}) {
  const readFile = io.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const fileExists = io.fileExists ?? existsSync;
  const readDir = io.readDir ?? ((dir) => readdirSync(dir, { withFileTypes: true }));

  const rootManifest = parseRootManifest(root, readFile);
  const members = workspaceMembers(rootManifest);
  if (members.length === 0) {
    return null;
  }
  const out = [];
  for (const member of members) {
    const srcDir = join(root, member, 'src');
    if (!fileExists(srcDir)) {
      continue;
    }
    for (const file of listRustFiles(srcDir, readDir)) {
      let body;
      try {
        body = readFile(file);
      } catch {
        continue;
      }
      out.push({ file: relative(root, file), lines: physicalLineCount(body) });
    }
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
  const files = listFiles(workspaceRoot, io);
  if (files === null || files === undefined) {
    return {
      tool: 'loc-scan',
      available: false,
      reason: 'no Cargo workspace members found',
      version: SCAN_VERSION,
      soft_target_loc: SOFT_TARGET_LOC,
      metrics: { max_file_loc: null, file_count: null },
      details: { offenders: [] },
    };
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
  const envelope = runLocScan({ workspaceRoot: args.workspaceRoot, offenderLimit: Infinity });
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
