// apss_topology.mjs — APSS (Agent Paradise Standards System) topology
// adapter for the sensors slot.  Reads APSS's canonical output —
// `.topology/metrics/modules.json` + `.topology/metrics/functions.json`
// — and emits per-source readings the aggregator merges alongside the
// existing dep-cruiser / ts-morph / complexity adapters.
//
// Closes bead create-harness-app-n48.3 (P1).  Decision context lives in
// ADR-0017 ("Sensors v0.3 — APSS canonical, sentrux preserved").
//
// Preservation-first: this adapter is ADDITIVE.  It does NOT replace or
// silently override the existing adapters' values.  When APSS is
// installed and emits topology files, those readings land under a
// distinct `apss` sub-object on each module so callers can reconcile
// explicitly.  When APSS is not installed (no .topology/ directory),
// the adapter emits `{ tool: 'apss-topology', available: false, readings: [] }`
// — a no-op signal the aggregator can treat as "no APSS data this run".
//
// Per the lab's `sensors-v0.3-apss-canonical.md` Path-α decision:
//   - APSS emits per-module + per-function metrics in workspace-relative
//     slash-form paths (the Rust ref impl normalizes Python dot-paths +
//     Rust `::` paths to slash form; we accept whatever APSS emits and
//     leave normalization as a future concern when a Python or Rust
//     APSS reading actually appears in this template).
//   - Single workspace-root invocation, not fan-out — APSS already emits
//     workspace-relative paths.
//   - Forward-compatible: every per-entity metric field is optional;
//     missing fields land as `null` so APSS can add metrics without
//     breaking this adapter.
//
// The canonical 15-metric surface (per the ADR):
//   - Module: ca, ce, instability, abstractness, distance_from_main_sequence,
//             file_count, function_count, lines_of_code,
//             total_cognitive, total_cyclomatic, avg_cognitive, avg_cyclomatic
//   - Function (3 extra): cognitive, cyclomatic, loc

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Canonical APSS module-level metric field names (V0.3 schema). */
export const APSS_MODULE_METRICS = [
  'ca',
  'ce',
  'instability',
  'abstractness',
  'distance_from_main_sequence',
  'file_count',
  'function_count',
  'lines_of_code',
  'total_cognitive',
  'total_cyclomatic',
  'avg_cognitive',
  'avg_cyclomatic',
];

/** Canonical APSS function-level metric field names (V0.3 schema). */
export const APSS_FUNCTION_METRICS = ['cognitive', 'cyclomatic', 'loc'];

/** APSS Tier 1 flat coupling fields from `.topology/metrics/coupling.json`. */
export const APSS_COUPLING_METRICS = [
  'afferent_coupling',
  'efferent_coupling',
  'instability',
  'abstractness',
  'distance_from_main_sequence',
];

/**
 * Normalize an APSS-emitted source path to slash form so cross-language
 * paths (`my.python.module`, `crate::path::mod`) end up in the same
 * shape the aggregator already keys on for the other adapters.
 */
export function normalizePath(p) {
  if (typeof p !== 'string') {
    return null;
  }
  // Rust `::` separator → `/`
  let out = p.replaceAll('::', '/');
  // Python dot-separator → `/`, but only on segments that don't look
  // like file extensions (foo.bar.baz → foo/bar/baz; foo/bar.py stays).
  if (!out.includes('/') && out.includes('.')) {
    out = out.replaceAll('.', '/');
  }
  return out;
}

/** Pick the metric values present in an entity object; null when absent. */
export function extractMetrics(entity, fieldNames) {
  const out = {};
  for (const k of fieldNames) {
    const v = entity?.[k];
    out[k] = typeof v === 'number' ? v : null;
  }
  return out;
}

function numericOrNull(v) {
  return typeof v === 'number' ? v : null;
}

function extractFunctionMetrics(entity) {
  const metrics = entity?.metrics ?? {};
  const halstead = metrics?.halstead ?? {};
  return {
    cognitive: numericOrNull(entity?.cognitive ?? metrics?.cognitive),
    cyclomatic: numericOrNull(entity?.cyclomatic ?? metrics?.cyclomatic),
    loc: numericOrNull(entity?.loc ?? metrics?.loc),
    halstead_volume: numericOrNull(entity?.halstead_volume ?? halstead?.volume),
  };
}

/**
 * Parse an APSS modules.json document into per-source readings.  Tolerant
 * of two on-wire shapes — top-level `{ modules: [...] }` OR a bare array.
 */
export function parseModulesJson(doc) {
  const modules = Array.isArray(doc) ? doc : Array.isArray(doc?.modules) ? doc.modules : [];
  const out = [];
  for (const m of modules) {
    const metrics = m?.metrics ?? {};
    const martin = metrics?.martin ?? {};
    const source = normalizePath(m?.source ?? m?.path ?? m?.file ?? m?.name ?? m?.id);
    if (!source) {
      continue;
    }
    out.push({
      source,
      ...extractMetrics(
        {
          ...m,
          ca: m?.ca ?? metrics?.ca ?? martin?.ca ?? m?.afferent_coupling,
          ce: m?.ce ?? metrics?.ce ?? martin?.ce ?? m?.efferent_coupling,
          instability: m?.instability ?? metrics?.instability ?? martin?.instability,
          abstractness: m?.abstractness ?? metrics?.abstractness ?? martin?.abstractness,
          distance_from_main_sequence:
            m?.distance_from_main_sequence ??
            metrics?.distance_from_main_sequence ??
            martin?.distance_from_main_sequence,
        },
        APSS_MODULE_METRICS,
      ),
    });
  }
  return out;
}

/**
 * Parse the APSS Tier 1 flat coupling artifact. It is a denormalized
 * projection of Martin metrics for fitness consumers.
 */
export function parseCouplingJson(doc) {
  const modules = Array.isArray(doc) ? doc : Array.isArray(doc?.modules) ? doc.modules : [];
  const out = [];
  for (const m of modules) {
    const source = normalizePath(m?.path ?? m?.source ?? m?.file ?? m?.id);
    if (!source) {
      continue;
    }
    const metrics = extractMetrics(m, APSS_COUPLING_METRICS);
    out.push({
      source,
      id: typeof m?.id === 'string' ? m.id : source,
      path: typeof m?.path === 'string' ? m.path : source,
      ...metrics,
      ca: metrics.afferent_coupling,
      ce: metrics.efferent_coupling,
    });
  }
  return out;
}

/**
 * Parse an APSS functions.json document.  Each function has a `module`
 * (the source it belongs to) plus per-function metrics; we group by
 * module so the aggregator can attach per-function totals.
 */
export function parseFunctionsJson(doc) {
  const fns = Array.isArray(doc) ? doc : Array.isArray(doc?.functions) ? doc.functions : [];
  const byModule = new Map();
  for (const f of fns) {
    const source = normalizePath(f?.file ?? f?.source ?? f?.path ?? f?.module);
    if (!source) {
      continue;
    }
    const metrics = extractFunctionMetrics(f);
    const name = typeof f?.name === 'string' ? f.name : typeof f?.id === 'string' ? f.id : '<anonymous>';
    const line = typeof f?.line === 'number' ? f.line : null;
    if (!byModule.has(source)) {
      byModule.set(source, []);
    }
    byModule.get(source).push({ name, line, ...metrics });
  }
  return byModule;
}

/**
 * Merge module-level readings with per-function rollups.  Each reading
 * lists every function under that module's source; if APSS already
 * supplied module-level aggregates (function_count, total_cognitive,
 * etc.), those win.  Otherwise we compute them from the per-function
 * lists when present.
 */
export function joinModulesAndFunctions(modules, functionsByModule) {
  const out = [];
  for (const m of modules) {
    const functions = functionsByModule.get(m.source) ?? [];
    const reading = { ...m, functions };
    // Fill module aggregates from per-function data when APSS didn't emit them.
    if (reading.function_count === null && functions.length > 0) {
      reading.function_count = functions.length;
    }
    if (functions.length > 0) {
      const cog = functions.map((f) => f.cognitive).filter((v) => typeof v === 'number');
      const cyc = functions.map((f) => f.cyclomatic).filter((v) => typeof v === 'number');
      const loc = functions.map((f) => f.loc).filter((v) => typeof v === 'number');
      if (reading.total_cognitive === null && cog.length > 0) {
        reading.total_cognitive = cog.reduce((a, b) => a + b, 0);
      }
      if (reading.total_cyclomatic === null && cyc.length > 0) {
        reading.total_cyclomatic = cyc.reduce((a, b) => a + b, 0);
      }
      if (reading.avg_cognitive === null && cog.length > 0) {
        reading.avg_cognitive = cog.reduce((a, b) => a + b, 0) / cog.length;
      }
      if (reading.avg_cyclomatic === null && cyc.length > 0) {
        reading.avg_cyclomatic = cyc.reduce((a, b) => a + b, 0) / cyc.length;
      }
      if (reading.lines_of_code === null && loc.length > 0) {
        reading.lines_of_code = loc.reduce((a, b) => a + b, 0);
      }
    }
    out.push(reading);
  }
  return out;
}

/**
 * Locate APSS topology files for a workspace root.  Looks at the
 * canonical `.topology/metrics/{modules,functions}.json` path that
 * APSS's `aps` binary emits.  Override via opts.topologyDir for tests
 * or non-standard layouts.
 */
export function findTopologyFiles(root, opts = {}) {
  const topologyDir = opts.topologyDir ?? join(root, '.topology', 'metrics');
  const modulesPath = join(topologyDir, 'modules.json');
  const functionsPath = join(topologyDir, 'functions.json');
  const couplingPath = join(topologyDir, 'coupling.json');
  const fs = opts.fs ?? { existsSync, readFileSync };
  return {
    topologyDir,
    modulesPath,
    functionsPath,
    couplingPath,
    available: fs.existsSync(modulesPath) || fs.existsSync(couplingPath) || fs.existsSync(functionsPath),
    fs,
  };
}

/**
 * Read APSS topology files from disk (or from opts.fs in tests) and
 * produce the per-source readings.  When the `.topology/` directory
 * does not exist, returns `{ tool: 'apss-topology', available: false,
 * readings: [] }` — the adapter is a no-op signal for "APSS is not
 * installed in this template / not yet run".
 */
export function analyzeFromTopology(root = '.', opts = {}) {
  const found = findTopologyFiles(root, opts);
  if (!found.available) {
    return { tool: 'apss-topology', available: false, readings: [] };
  }
  let modules = [];
  if (found.fs.existsSync(found.modulesPath)) {
    try {
      modules = parseModulesJson(JSON.parse(found.fs.readFileSync(found.modulesPath, 'utf8')));
    } catch (err) {
      return {
        tool: 'apss-topology',
        available: false,
        readings: [],
        error: `failed to read ${found.modulesPath}: ${err.message}`,
      };
    }
  }
  if (found.fs.existsSync(found.couplingPath)) {
    try {
      const coupling = parseCouplingJson(JSON.parse(found.fs.readFileSync(found.couplingPath, 'utf8')));
      const bySource = new Map(modules.map((m) => [m.source, m]));
      for (const c of coupling) {
        bySource.set(c.source, { ...(bySource.get(c.source) ?? {}), ...c });
      }
      modules = [...bySource.values()];
    } catch (err) {
      return {
        tool: 'apss-topology',
        available: false,
        readings: [],
        error: `failed to read ${found.couplingPath}: ${err.message}`,
      };
    }
  }
  let functionsDoc = null;
  if (found.fs.existsSync(found.functionsPath)) {
    try {
      functionsDoc = JSON.parse(found.fs.readFileSync(found.functionsPath, 'utf8'));
    } catch (err) {
      // Functions are optional; log to error key but keep module readings.
      functionsDoc = { _error: `failed to read ${found.functionsPath}: ${err.message}` };
    }
  }
  const functionsByModule =
    functionsDoc && !functionsDoc._error ? parseFunctionsJson(functionsDoc) : new Map();
  if (modules.length === 0 && functionsByModule.size > 0) {
    modules = [...functionsByModule.keys()].map((source) => ({
      source,
      ...extractMetrics({}, APSS_MODULE_METRICS),
    }));
  }
  const readings = joinModulesAndFunctions(modules, functionsByModule);
  const out = { tool: 'apss-topology', available: true, readings };
  if (functionsDoc?._error) {
    out.functions_error = functionsDoc._error;
  }
  return out;
}

/**
 * CLI entry — defaults to `.` for the workspace root.  Emits the same
 * JSON shape as the other adapters: `{ tool, available, readings }`.
 * Flags:
 *   --root=<path>            workspace root (default: cwd)
 *   --topology-dir=<path>    override the `.topology/metrics/` location
 */
export async function main(argv = process.argv.slice(2), io = { write: (s) => process.stdout.write(s) }) {
  let root = '.';
  let topologyDir;
  for (const a of argv) {
    if (a.startsWith('--root=')) {
      root = a.slice('--root='.length);
    } else if (a.startsWith('--topology-dir=')) {
      topologyDir = a.slice('--topology-dir='.length);
    }
  }
  const opts = topologyDir ? { topologyDir } : {};
  const result = analyzeFromTopology(root, opts);
  io.write(`${JSON.stringify(result, null, 2)}\n`);
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
      process.stderr.write(`apss_topology: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(1);
    });
}
