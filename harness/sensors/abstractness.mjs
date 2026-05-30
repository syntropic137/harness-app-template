// abstractness.mjs — ts-morph adapter that emits Robert C. Martin
// Abstractness (A) per workspace module.  Pairs with the dependency-cruiser
// adapter so the aggregator can compute Distance from the main sequence,
// D = |A + I − 1|.
//
// A is defined as `abstract / (abstract + concrete)` per module, where:
//   - abstract:  declared `abstract class` + every `interface` declaration
//                (interfaces are pure-abstract).
//   - concrete:  every non-abstract `class` declaration.
//
// Modules with zero classes and zero interfaces produce `A = null` (the
// concept is undefined for them — we never invent a value, the aggregator
// just leaves D undefined too).
//
// Why this isn't bundled with aggregate.mjs:  ts-morph spins up a
// TypeScript Program, which is a heavyweight side-effect we don't want in
// the de-dup / scope-filter path.  Keeping the adapter separate also
// matches the polyglot-adapter shape from docs/adrs/ADR-0006-sensors.md —
// future Python/Rust/Go adapters emit the same per-source A reading.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Project } from 'ts-morph';

const WORKSPACE_RE = /^(ws_apps|ws_packages)\//;

/** True when a cruiser `modules[].source` string is workspace code. */
export function isWorkspaceSource(name) {
  return typeof name === 'string' && WORKSPACE_RE.test(name) && !name.startsWith('node_modules');
}

/**
 * Count `abstract class` + `interface` (abstract) and non-abstract `class`
 * (concrete) declarations in a ts-morph SourceFile.  Module-level only —
 * we deliberately do not walk namespace bodies, because the aggregator
 * keys on file paths, not on nested declaration trees.
 */
export function classifyModule(sourceFile) {
  let abstractCount = 0;
  let concreteCount = 0;
  for (const cls of sourceFile.getClasses()) {
    if (cls.isAbstract()) {
      abstractCount += 1;
    } else {
      concreteCount += 1;
    }
  }
  abstractCount += sourceFile.getInterfaces().length;
  return { abstract: abstractCount, concrete: concreteCount };
}

/** Pure-function Martin A given a counts object.  null when total is 0. */
export function abstractnessFromCounts({ abstract: a, concrete: c }) {
  const total = a + c;
  if (total === 0) {
    return null;
  }
  return a / total;
}

/**
 * Analyze a list of workspace file paths and return per-module A readings.
 * The project is optional so tests can pass a ts-morph in-memory project.
 */
export function analyzeFiles(filePaths, { project } = {}) {
  const p =
    project ??
    new Project({
      useInMemoryFileSystem: false,
      compilerOptions: { allowJs: true, noEmit: true },
    });
  const readings = [];
  for (const path of filePaths) {
    if (typeof path !== 'string' || path.length === 0) {
      continue;
    }
    let sf;
    try {
      sf = project ? p.getSourceFile(path) ?? p.addSourceFileAtPath(path) : p.addSourceFileAtPath(path);
    } catch (err) {
      // A workspace file referenced in cruiser output that ts-morph can't
      // open (deleted between runs, permission error, etc.) is not fatal
      // here — we just emit an undefined reading and let the aggregator
      // handle it.
      readings.push({ source: path, abstract: 0, concrete: 0, A: null, error: err.message });
      continue;
    }
    const counts = classifyModule(sf);
    readings.push({
      source: path,
      abstract: counts.abstract,
      concrete: counts.concrete,
      A: abstractnessFromCounts(counts),
    });
  }
  return readings;
}

/**
 * Extract workspace source paths from a cruiser JSON object.  Filters to
 * `.ts` / `.tsx` (ts-morph won't classify .mjs/.cjs sources meaningfully —
 * they have no class/interface declarations the TS parser will see in JS
 * mode without type info).
 */
export function workspaceSourcesFromCruiser(cruiser) {
  const out = new Set();
  for (const m of cruiser?.modules ?? []) {
    const s = m?.source;
    if (isWorkspaceSource(s) && /\.(ts|tsx)$/.test(s)) {
      out.add(s);
    }
  }
  return [...out].sort();
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** CLI entry: read cruiser JSON from stdin, write abstractness readings JSON to stdout. */
export async function main(argv = process.argv.slice(2), io = { read: readStdin, write: (s) => process.stdout.write(s) }) {
  let raw;
  try {
    raw = await io.read();
  } catch (err) {
    process.stderr.write(`abstractness: failed to read stdin (${err.message})\n`);
    return 2;
  }
  if (raw.trim().length === 0) {
    process.stderr.write('abstractness: empty stdin — pipe cruiser JSON in\n');
    return 2;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`abstractness: stdin is not valid JSON (${err.message})\n`);
    return 2;
  }
  const sources = workspaceSourcesFromCruiser(parsed);
  const readings = analyzeFiles(sources);
  io.write(`${JSON.stringify({ tool: 'ts-morph', readings }, null, 2)}\n`);
  // argv is the public-API shape; nothing to consume today.  Touched here
  // so the symbol stays explicitly part of the contract and the linter
  // doesn't drop it.
  void argv;
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
      process.stderr.write(`abstractness: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(1);
    });
}
