// license_scan.mjs - APSS LG01 Legality adapter for the sensors slot.
//
// Walks every package.json under provided node_modules roots, reads its
// declared license, and reports counts of packages on a small allowlist
// vs everything else. Bead create-harness-app-2zz.3 promotes LG01 from
// advisory to enforced; the gate fails the build on any new
// denied-license-count introduced.
//
// Allowlist is the standard OSI-permissive set safe for shipping in a
// permissive harness (matches the per-adapter license footer in
// ADR-0006-sensors.md). Consumer forks that need a different policy
// can fork the allowlist or supply --allowlist=path/to/list.txt to the
// CLI.
//
// Soft-skip semantics: if no node_modules directory is found, the
// scanner emits {available: false, denied: [], denied_count: 0,
// scanned: 0}. The gate's LG01 value() returns null on
// available=false, so a fresh checkout (before bun install) reports
// LG01 as no-reading rather than a false zero.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** OSI-permissive licenses safe for shipping in a permissive harness. */
export const DEFAULT_ALLOWLIST = new Set([
  '0BSD',
  'Apache-2.0',
  'Apache 2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BSD-3-Clause-Clear',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
]);

/**
 * Read a single package.json and return its normalized license string
 * (or null when the file is missing/malformed/has no license). Handles
 * the historical `licenses: [{type: ...}, ...]` shape too.
 */
export function readLicense(packageJsonPath, fs = { readFileSync }) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return null;
  }
  if (typeof pkg?.license === 'string') {
    return pkg.license;
  }
  if (pkg?.license && typeof pkg.license === 'object' && typeof pkg.license.type === 'string') {
    return pkg.license.type;
  }
  if (Array.isArray(pkg?.licenses) && pkg.licenses.length > 0) {
    const first = pkg.licenses[0];
    if (typeof first === 'string') {
      return first;
    }
    if (first && typeof first.type === 'string') {
      return first.type;
    }
  }
  return null;
}

/**
 * SPDX strings can be expressions (`MIT OR Apache-2.0`, `(MIT AND CC0-1.0)`)
 * or qualifiers (`SEE LICENSE IN file`). For the allowlist check, an
 * expression passes when at least one term in an OR clause is in the
 * allowlist (lenient OR semantics, matches industry practice for
 * permissive policies). AND clauses require every term to pass.
 */
export function isLicenseAllowed(license, allowlist = DEFAULT_ALLOWLIST) {
  if (typeof license !== 'string' || license.trim().length === 0) {
    return false;
  }
  const trimmed = license.trim();
  if (allowlist.has(trimmed)) {
    return true;
  }
  // Strip surrounding parens for SPDX expressions like "(MIT OR Apache-2.0)".
  const stripped = trimmed.replace(/^\(+|\)+$/g, '').trim();
  if (allowlist.has(stripped)) {
    return true;
  }
  // AND: every operand must pass.
  if (/\bAND\b/i.test(stripped) && !/\bOR\b/i.test(stripped)) {
    return stripped.split(/\s+AND\s+/i).every((part) => isLicenseAllowed(part.trim(), allowlist));
  }
  // OR: any operand passing is sufficient.
  if (/\bOR\b/i.test(stripped)) {
    return stripped.split(/\s+OR\s+/i).some((part) => isLicenseAllowed(part.trim(), allowlist));
  }
  return false;
}

/**
 * Walk a node_modules root for first- and scoped-package package.json
 * files. Returns an array of {path, license} entries.
 */
export function walkNodeModules(root, fs = { readdirSync, statSync, existsSync }) {
  const out = [];
  if (!fs.existsSync(root)) {
    return out;
  }
  for (const entry of fs.readdirSync(root)) {
    if (entry.startsWith('.')) {
      continue;
    }
    const entryPath = join(root, entry);
    let st;
    try {
      st = fs.statSync(entryPath);
    } catch {
      continue;
    }
    if (!st.isDirectory()) {
      continue;
    }
    if (entry.startsWith('@')) {
      // Scoped namespace; recurse one level deeper.
      let scopedEntries = [];
      try {
        scopedEntries = fs.readdirSync(entryPath);
      } catch {
        continue;
      }
      for (const scoped of scopedEntries) {
        const scopedPath = join(entryPath, scoped);
        const pkg = join(scopedPath, 'package.json');
        out.push(pkg);
      }
      continue;
    }
    const pkg = join(entryPath, 'package.json');
    out.push(pkg);
  }
  return out;
}

/**
 * Run the scan over a list of node_modules roots. Returns a structured
 * report the gate consumes via --licenses=<path>.
 */
export function scanLicenses(roots, options = {}) {
  const fs = options.fs ?? { readFileSync, readdirSync, statSync, existsSync };
  const allowlist = options.allowlist ?? DEFAULT_ALLOWLIST;
  const readLicenseFn = options.readLicense ?? readLicense;
  const allowFn = options.isLicenseAllowed ?? isLicenseAllowed;
  let scanned = 0;
  const denied = [];
  const seenRoots = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    seenRoots.push(root);
    for (const pkgPath of walkNodeModules(root, fs)) {
      scanned += 1;
      const license = readLicenseFn(pkgPath, fs);
      if (!allowFn(license, allowlist)) {
        denied.push({
          path: pkgPath,
          package: basename(pkgPath.replace(/\/package\.json$/, '')),
          license,
        });
      }
    }
  }
  return {
    available: seenRoots.length > 0,
    scanned_roots: seenRoots,
    scanned,
    denied,
    denied_count: denied.length,
  };
}

/**
 * Default roots to scan in this template. Walks every node_modules
 * directory that ships under a tracked source tree. Consumer forks
 * with custom workspace layouts can override via --roots=csv.
 */
export const DEFAULT_ROOTS = [
  'node_modules',
  'harness/sensors/node_modules',
  'harness/doc-validator/node_modules',
  'harness/perf/node_modules',
  'ws_apps/example-typescript/node_modules',
  'ws_apps/docs/node_modules',
];

export async function main(argv = process.argv.slice(2), io = { write: (s) => process.stdout.write(s) }) {
  let roots = DEFAULT_ROOTS;
  for (const a of argv) {
    if (a.startsWith('--roots=')) {
      roots = a.slice('--roots='.length).split(',').filter((s) => s.length > 0);
    }
  }
  const report = scanLicenses(roots);
  io.write(`${JSON.stringify(report, null, 2)}\n`);
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
      process.stderr.write(`license_scan: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(1);
    });
}
