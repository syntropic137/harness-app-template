// deadcode_scan.mjs — knip-based unused-code adapter for MT01.
//
// Runs knip against the consumer-app workspace (ws_apps + ws_packages),
// counts unused files / unused exports / unused types, and emits an
// envelope the gate consumes via --deadcode=<path>. Mirrors the
// license_scan.mjs / sentrux_scan.mjs envelope contract.
//
// Why knip: the modern oxc-backed dead-code detector for TS/JS
// (https://knip.dev/blog/knip-v6, March 2026). ts-prune is the legacy
// fallback but only sees unused exports — knip catches unused files
// and types too, which is the larger surface for AI-generated rot.
//
// SCOPE: ws_apps + ws_packages only — matches the canonical "workspace
// code" filter used by complexity.mjs / abstractness.mjs. This avoids
// the false-positive trap of scanning the root (where scripts/*.ts
// are invoked by justfile but look unused to a static analyzer).
// Each workspace package has its own package.json so knip auto-derives
// entry points (bin/main/exports) and the baseline can credibly start
// at 0.
//
// CONTRACT — envelope shape consumed by gate.mjs:
//   {
//     "tool": "knip",
//     "available": true | false,
//     "version": "6.16.1",
//     "scanned_workspaces": ["ws_apps/example-typescript", ...],
//     "metrics": {
//       "total_unused": 0,           // sum of files + exports + types
//       "unused_files": 0,
//       "unused_exports": 0,
//       "unused_types": 0
//     }
//   }
//
// SOFT-SKIP contract: when npx is unavailable or knip itself crashes,
// the envelope sets available=false. gate.mjs degrades MT01
// unused-export-count to no-reading (rather than a false zero), so a
// broken scanner cannot silently pass a CI run.
//
// Knip exits 1 when it finds issues — that is its normal "report
// produced" path, not an error. The adapter only treats spawn failures
// (status === null, non-numeric, or no JSON on stdout) as broken.

import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pinned knip version. Bump deliberately under ADR-0024-dead-code-ratchet.md.
export const KNIP_VERSION = '6.16.1';

// Workspace roots we scan. Matches complexity.mjs WORKSPACE_RE.
export const DEFAULT_WORKSPACE_ROOTS = ['ws_apps', 'ws_packages'];

/**
 * Enumerate workspace packages by listing every immediate child of
 * each root that contains a package.json. Returns workspace-relative
 * paths (e.g. "ws_apps/example-typescript") — the form knip accepts
 * as `--workspace <name>`.
 */
export function discoverWorkspaces(
  workspaceRoot,
  roots = DEFAULT_WORKSPACE_ROOTS,
  fs = { existsSync, readdirSync, statSync },
) {
  const out = [];
  for (const root of roots) {
    const rootPath = join(workspaceRoot, root);
    if (!fs.existsSync(rootPath)) {
      continue;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(rootPath);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) {
        continue;
      }
      const pkgPath = join(rootPath, entry);
      let st;
      try {
        st = fs.statSync(pkgPath);
      } catch {
        continue;
      }
      if (!st.isDirectory()) {
        continue;
      }
      if (!fs.existsSync(join(pkgPath, 'package.json'))) {
        continue;
      }
      out.push(`${root}/${entry}`);
    }
  }
  return out.sort();
}

/**
 * Sum unused-files, unused-exports, unused-types across every entry in
 * a knip --reporter=json payload. Knip emits one entry per file with
 * arrays for each issue category. We do NOT count `unlisted` or
 * `unresolved`, since those are dependency hygiene (not dead code).
 */
export function summarizeKnipPayload(payload) {
  const issues = Array.isArray(payload?.issues) ? payload.issues : [];
  let unused_files = 0;
  let unused_exports = 0;
  let unused_types = 0;
  for (const entry of issues) {
    unused_files += Array.isArray(entry?.files) ? entry.files.length : 0;
    unused_exports += Array.isArray(entry?.exports) ? entry.exports.length : 0;
    unused_types += Array.isArray(entry?.types) ? entry.types.length : 0;
  }
  return {
    total_unused: unused_files + unused_exports + unused_types,
    unused_files,
    unused_exports,
    unused_types,
  };
}

const DEFAULT_KNIP_ARGS = [
  '--reporter',
  'json',
  '--no-progress',
  '--include',
  'files,exports,types',
];

/**
 * Run knip via npx and parse its JSON payload. Returns the envelope the
 * gate consumes. Spawn is injectable for tests.
 */
export function runDeadcodeScan({
  workspaceRoot = process.cwd(),
  workspaces,
  version = KNIP_VERSION,
  spawn = nodeSpawnSync,
  fs = { existsSync, readdirSync, statSync },
} = {}) {
  const scanned = workspaces ?? discoverWorkspaces(workspaceRoot, DEFAULT_WORKSPACE_ROOTS, fs);
  if (scanned.length === 0) {
    return {
      tool: 'knip',
      available: false,
      reason: 'no ws_apps/* or ws_packages/* package detected',
      version,
      scanned_workspaces: [],
      metrics: emptyMetrics(),
    };
  }
  const args = [`knip@${version}`, ...DEFAULT_KNIP_ARGS];
  for (const w of scanned) {
    args.push('--workspace', w);
  }
  let result;
  try {
    result = spawn('npx', ['--yes', ...args], {
      cwd: workspaceRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    return {
      tool: 'knip',
      available: false,
      reason: `spawn failed: ${err?.message ?? String(err)}`,
      version,
      scanned_workspaces: scanned,
      metrics: emptyMetrics(),
    };
  }
  if (typeof result?.status !== 'number') {
    return {
      tool: 'knip',
      available: false,
      reason: 'npx knip did not return an exit status',
      version,
      scanned_workspaces: scanned,
      metrics: emptyMetrics(),
    };
  }
  const stdout = result.stdout ?? '';
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    return {
      tool: 'knip',
      available: false,
      reason: 'npx knip did not emit JSON on stdout',
      version,
      scanned_workspaces: scanned,
      metrics: emptyMetrics(),
    };
  }
  return {
    tool: 'knip',
    available: true,
    version,
    scanned_workspaces: scanned,
    metrics: summarizeKnipPayload(payload),
  };
}

function emptyMetrics() {
  return { total_unused: null, unused_files: null, unused_exports: null, unused_types: null };
}

export async function main(
  argv = process.argv.slice(2),
  io = { write: (s) => process.stdout.write(s) },
) {
  let workspaceRoot = process.cwd();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--workspace-root=')) {
      workspaceRoot = a.slice('--workspace-root='.length);
    } else if (a === '--workspace-root') {
      workspaceRoot = argv[i + 1] ?? workspaceRoot;
      i += 1;
    }
  }
  const envelope = runDeadcodeScan({ workspaceRoot });
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
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`deadcode_scan: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(1);
    });
}
