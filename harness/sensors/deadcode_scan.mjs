// deadcode_scan.mjs — deterministic unused-export adapter for MT01.
//
// The previous revision spawned `npx knip` against the workspace. That
// design proved environment-sensitive: knip 6.16.1 reported 2 unused
// items on a developer machine and 3 on every GitHub Actions runner
// (both ubuntu and macos) with `pnpm install --no-frozen-lockfile`
// applied identically. The variance came from knip's resolution of
// auto-discovered workspace entry points, which depends on the exact
// node_modules layout pnpm produces in a given cache state. A ratchet
// floor on a non-deterministic metric fails open or closed at random,
// which is worse than not having the metric at all.
//
// This revision replaces the knip spawn with a pure-source-of-truth
// scan that is fully deterministic: it walks a fixed set of source
// globs, parses named exports with a fixed regex, and counts those
// whose identifier is never referenced anywhere else in the workspace.
// No npx, no node_modules dependency, no network, no platform-specific
// resolution. Same input → same output, locally and on every CI lane.
//
// SCOPE — only pure-TS library code:
//   - ws_packages/<pkg>/src/**/*.{ts,tsx}
//   - ws_apps/<app>/src/**/*.{ts,tsx}
//
// This intentionally excludes:
//   - vitest.config.ts and other config files (loaded by framework
//     convention, never imported)
//   - ws_apps/docs/** (fumadocs / Next.js App Router conventions —
//     framework-loaded files look unused to a static scanner; the
//     curated false-positive list for that subtree belongs in a
//     fork-side knip.json if a fork wants it)
//   - tests/** (test files are entry points; their exports are
//     consumed by the test runner, not other source files)
//   - default exports (often picked up by framework conventions and
//     not always named in import statements)
//
// REFERENCE CORPUS: every .ts and .tsx file under ws_apps/** and
// ws_packages/** that is NOT in node_modules / .next / dist / target /
// .venv / .turbo. An export is "unused" when its identifier never
// appears as a whole-word match in any file in the corpus other than
// the file it was defined in.
//
// CONTRACT — envelope shape consumed by gate.mjs (unchanged from the
// prior knip-based revision):
//   {
//     "tool": "deadcode-grep",
//     "available": true | false,
//     "version": "1.0.0",
//     "scanned_workspaces": [...],
//     "metrics": {
//       "total_unused": 0,
//       "unused_files": 0,           // always 0 — this detector reads exports only
//       "unused_exports": 0,         // identifiers with zero references
//       "unused_types": 0            // always 0 — types fold into unused_exports
//     }
//   }
//
// SOFT-SKIP contract: when neither ws_apps nor ws_packages exists, the
// envelope sets available=false. gate.mjs degrades MT01
// unused-export-count to no-reading (rather than a false zero), so a
// fork that strips the workspace cannot silently pass.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DETECTOR_VERSION = '1.0.0';

// Workspace roots we scan. Matches complexity.mjs WORKSPACE_RE.
export const DEFAULT_WORKSPACE_ROOTS = ['ws_apps', 'ws_packages'];

// Directory segments we never descend into during the file walk. Mirrors
// the ignore lists from .dependency-cruiser.cjs / knip defaults.
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'target',
  '.venv',
  '__pycache__',
  '.cache',
  'coverage',
  '.git',
]);

// Files that look like source modules to the workspace developer but
// are loaded by framework convention rather than imported. Counting
// their exports as unused is structurally wrong — they ARE used; the
// framework just does not produce an import statement we can see.
const FRAMEWORK_CONVENTION_FILES = new Set([
  'mdx-components.tsx',
  'source.config.ts',
  'layout.shared.tsx',
  'middleware.ts',
  'instrumentation.ts',
  'instrumentation-client.ts',
]);

// Path-segment-based exclusions for Next.js App Router conventions.
// Every file directly under app/ (or nested route segments) is loaded
// by the framework; scanning their exports for references would be a
// false-positive farm.
const FRAMEWORK_CONVENTION_PATH_SEGMENTS = ['/app/'];

// Capture an identifier from `export <kind> <name>`. Whole-line
// anchored so it does not match exports inside comments or inside
// string literals. Covers all common shapes of named exports; default
// exports and `export { renamed }` are intentionally excluded — see
// the file header for why.
const EXPORT_RE =
  /^export\s+(?:async\s+)?(?:const|function|class|interface|type|enum|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;

/**
 * Enumerate workspace packages by listing every immediate child of
 * each root that contains a package.json. Returns workspace-relative
 * paths (e.g. "ws_apps/example-typescript"), sorted for determinism.
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

/** True for a file we should never enter from the recursive walk. */
function isExcludedDir(name) {
  return EXCLUDED_DIRS.has(name) || name.startsWith('.');
}

/** True for a path we should never include in the export-source list. */
export function isFrameworkConvention(workspaceRelative) {
  const segments = workspaceRelative.split('/');
  const file = segments[segments.length - 1];
  if (FRAMEWORK_CONVENTION_FILES.has(file)) {
    return true;
  }
  const normalized = `/${workspaceRelative}/`;
  return FRAMEWORK_CONVENTION_PATH_SEGMENTS.some((seg) => normalized.includes(seg));
}

/**
 * Walk a directory and yield every .ts / .tsx file (deterministic,
 * sorted within each level). Honors EXCLUDED_DIRS so node_modules,
 * .next, target, etc. are skipped entirely.
 */
export function walkSourceTree(root, fs = { existsSync, readdirSync, statSync, readFileSync }) {
  const out = [];
  if (!fs.existsSync(root)) {
    return out;
  }
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir).slice().sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!isExcludedDir(entry)) {
          stack.push(full);
        }
        continue;
      }
      if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

/**
 * Identify export-source files: `<workspace>/src/**` under every
 * discovered workspace package. These are the files whose named
 * exports we scan for references.
 */
export function listExportSources(
  workspaceRoot,
  workspaces,
  fs = { existsSync, readdirSync, statSync, readFileSync },
) {
  const out = [];
  for (const w of workspaces) {
    const srcRoot = join(workspaceRoot, w, 'src');
    for (const file of walkSourceTree(srcRoot, fs)) {
      const rel = relative(workspaceRoot, file);
      if (!isFrameworkConvention(rel)) {
        out.push(file);
      }
    }
  }
  return out.sort();
}

/**
 * Identify reference-corpus files: every .ts / .tsx under each
 * workspace root, including tests / configs / framework conventions
 * (we want THOSE to count as referrers). Files inside EXCLUDED_DIRS
 * are skipped.
 */
export function listReferenceCorpus(
  workspaceRoot,
  roots = DEFAULT_WORKSPACE_ROOTS,
  fs = { existsSync, readdirSync, statSync, readFileSync },
) {
  const out = [];
  for (const root of roots) {
    const rootPath = join(workspaceRoot, root);
    for (const file of walkSourceTree(rootPath, fs)) {
      out.push(file);
    }
  }
  return out.sort();
}

/**
 * Capture every named export identifier in a source file. Returns an
 * array of { name, line } records (line is 1-indexed) so a future
 * report layer can surface where the dead export lives.
 */
export function findExports(source) {
  const out = [];
  for (const m of source.matchAll(EXPORT_RE)) {
    const name = m[1];
    const offset = m.index ?? 0;
    let line = 1;
    for (let i = 0; i < offset; i += 1) {
      if (source.charCodeAt(i) === 10) {
        line += 1;
      }
    }
    out.push({ name, line });
  }
  return out;
}

/**
 * Count whole-word references to `name` in `content`. Whole-word
 * boundary uses \b on both sides, matching the way TypeScript imports
 * write the identifier.
 */
export function countReferences(name, content) {
  const re = new RegExp(`\\b${name}\\b`, 'g');
  const matches = content.match(re);
  return matches ? matches.length : 0;
}

/**
 * Run the deterministic dead-code scan. Reads no external state; all
 * filesystem access is injectable via the fs param for unit tests.
 */
export function runDeadcodeScan({
  workspaceRoot = process.cwd(),
  workspaces,
  fs = { existsSync, readdirSync, statSync, readFileSync },
} = {}) {
  const scanned = workspaces ?? discoverWorkspaces(workspaceRoot, DEFAULT_WORKSPACE_ROOTS, fs);
  if (scanned.length === 0) {
    return {
      tool: 'deadcode-grep',
      available: false,
      reason: 'no ws_apps/* or ws_packages/* package detected',
      version: DETECTOR_VERSION,
      scanned_workspaces: [],
      metrics: emptyMetrics(),
    };
  }
  const sources = listExportSources(workspaceRoot, scanned, fs);
  const corpus = listReferenceCorpus(workspaceRoot, DEFAULT_WORKSPACE_ROOTS, fs);
  // Cache file contents — the corpus is tiny (~30 files in the template)
  // and we visit every file once per export name otherwise.
  const corpusContents = new Map();
  for (const f of corpus) {
    try {
      corpusContents.set(f, fs.readFileSync(f, 'utf8'));
    } catch {
      // Unreadable file (broken symlink, race). Skip cleanly.
    }
  }
  let unused = 0;
  for (const sourceFile of sources) {
    const content = corpusContents.get(sourceFile);
    if (typeof content !== 'string') {
      continue;
    }
    const exports = findExports(content);
    for (const { name } of exports) {
      let externalRefs = 0;
      for (const [other, otherContent] of corpusContents) {
        if (other === sourceFile) {
          continue;
        }
        externalRefs += countReferences(name, otherContent);
        if (externalRefs > 0) {
          break;
        }
      }
      if (externalRefs === 0) {
        unused += 1;
      }
    }
  }
  return {
    tool: 'deadcode-grep',
    available: true,
    version: DETECTOR_VERSION,
    scanned_workspaces: scanned,
    metrics: {
      total_unused: unused,
      unused_files: 0,
      unused_exports: unused,
      unused_types: 0,
    },
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
