// aggregate.mjs — pure-Node ESM that turns dependency-cruiser's JSON output
// into a workspace-scoped Martin metrics report (Ca, Ce, I) per folder and
// per module.
//
// Why this exists (see experiments/2026-05-30--depcruiser-arch-quality/):
//   1. cruiser sometimes emits the same `modules[].source` twice with
//      different graph views; counting Ca off the raw array double-reports.
//   2. cruiser walks into node_modules once a test imports vitest; a 5-file
//      probe became a 67-module report dominated by vendor code.
//   3. cruiser does not compute abstractness (A) or Martin's distance (D);
//      this aggregator only ships I.  A will land alongside ts-morph in a
//      later increment.
//
// This file ships report-only.  No policy gate.  Threshold-based pass/fail
// is deferred until at least one consumer fork has >= 50 workspace modules.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKSPACE_RE = /^(ws_apps|ws_packages)\//;
// Segments that mean "vendored or generated" anywhere in the path —
// cruiser enumerates ancestor folders recursively (including a workspace
// app's nested node_modules), so the top-level `excludePattern` in
// .dependency-cruiser.cjs is not enough to keep those out of `folders[]`.
const EXCLUDED_SEGMENT_RE = /(^|\/)(node_modules|dist|build|out|\.next|coverage)(\/|$)/;

/** Return true when a cruiser node name is workspace code (not vendor / not bare). */
export function isWorkspaceName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return false;
  }
  if (name.startsWith('node_modules')) {
    return false;
  }
  if (EXCLUDED_SEGMENT_RE.test(name)) {
    return false;
  }
  return WORKSPACE_RE.test(name);
}

/**
 * De-duplicate `modules[]` entries that share a `source` string.  Cruiser
 * occasionally emits the same source twice (once as an entry, once as a
 * follow-target).  We merge dependents/dependencies into deduplicated sets
 * keyed by string identity and recompute Ca/Ce/I from the merged view.
 */
export function dedupeModules(modules) {
  const byId = new Map();
  for (const mod of modules) {
    const source = mod.source;
    if (typeof source !== 'string') {
      continue;
    }
    const prev = byId.get(source);
    const dependents = new Set(prev ? prev._dependents : []);
    const dependencies = new Set(prev ? prev._dependencies : []);
    for (const d of mod.dependents ?? []) {
      if (typeof d === 'string') {
        dependents.add(d);
      } else if (d && typeof d.name === 'string') {
        dependents.add(d.name);
      }
    }
    for (const d of mod.dependencies ?? []) {
      const key = (d && (d.resolved ?? d.module ?? d.name)) ?? null;
      if (typeof key === 'string') {
        dependencies.add(key);
      }
    }
    byId.set(source, { source, _dependents: dependents, _dependencies: dependencies });
  }
  const out = [];
  for (const entry of byId.values()) {
    const ca = entry._dependents.size;
    const ce = entry._dependencies.size;
    const total = ca + ce;
    out.push({
      source: entry.source,
      Ca: ca,
      Ce: ce,
      I: total === 0 ? null : ce / total,
      dependents: [...entry._dependents].sort(),
      dependencies: [...entry._dependencies].sort(),
    });
  }
  out.sort((a, b) => a.source.localeCompare(b.source));
  return out;
}

/** Filter cruiser folders to workspace scope and normalize the metric keys. */
export function scopeFolders(folders) {
  const out = [];
  for (const folder of folders) {
    if (!isWorkspaceName(folder.name)) {
      continue;
    }
    const ca = folder.afferentCouplings ?? 0;
    const ce = folder.efferentCouplings ?? 0;
    const total = ca + ce;
    out.push({
      name: folder.name,
      moduleCount: folder.moduleCount ?? 0,
      Ca: ca,
      Ce: ce,
      I: total === 0 ? null : (folder.instability ?? ce / total),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function summarize(modules) {
  const defined = modules.map((m) => m.I).filter((i) => typeof i === 'number');
  if (defined.length === 0) {
    return {
      count: modules.length,
      definedI: 0,
      min: null,
      median: null,
      max: null,
      stable: 0,
      unstable: 0,
    };
  }
  const sorted = [...defined].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    count: modules.length,
    definedI: defined.length,
    min: sorted[0],
    median: sorted[mid],
    max: sorted[sorted.length - 1],
    stable: defined.filter((i) => i <= 0.2).length,
    unstable: defined.filter((i) => i >= 0.8).length,
  };
}

/** Martin's distance from the main sequence. null when either input is null. */
export function distanceFromMainSequence(A, I) {
  if (typeof A !== 'number' || typeof I !== 'number') {
    return null;
  }
  return Math.abs(A + I - 1);
}

/**
 * Merge a list of ts-morph abstractness readings into a workspace report
 * produced by `aggregate()`.  Adds `A` and `D` to each module, then
 * rolls A up to folders as the module-count-weighted average of defined
 * per-module A values (folders with no defined A modules get A=null and
 * therefore D=null).  Non-mutating — returns a new report object.
 */
export function mergeAbstractness(report, abstractness) {
  const byModule = new Map();
  for (const r of abstractness?.readings ?? []) {
    if (r && typeof r.source === 'string') {
      byModule.set(r.source, r);
    }
  }
  const modules = report.workspace.modules.map((m) => {
    const reading = byModule.get(m.source);
    const A = reading && typeof reading.A === 'number' ? reading.A : null;
    return {
      ...m,
      A,
      abstract: reading?.abstract ?? 0,
      concrete: reading?.concrete ?? 0,
      D: distanceFromMainSequence(A, m.I),
    };
  });
  const folders = report.workspace.folders.map((f) => {
    const prefix = `${f.name}/`;
    const inFolder = modules.filter((m) => m.source === f.name || m.source.startsWith(prefix));
    const defined = inFolder.filter((m) => typeof m.A === 'number');
    let A = null;
    if (defined.length > 0) {
      const sum = defined.reduce((acc, m) => acc + m.A, 0);
      A = sum / defined.length;
    }
    return { ...f, A, D: distanceFromMainSequence(A, f.I) };
  });
  return {
    ...report,
    abstractnessTool: abstractness?.tool ?? null,
    workspace: {
      ...report.workspace,
      modules,
      folders,
      abstractnessDistribution: summarizeA(modules),
    },
  };
}

function summarizeA(modules) {
  const definedA = modules.map((m) => m.A).filter((a) => typeof a === 'number');
  const definedD = modules.map((m) => m.D).filter((d) => typeof d === 'number');
  if (definedA.length === 0) {
    return { count: modules.length, definedA: 0, definedD: definedD.length };
  }
  const sortedA = [...definedA].sort((a, b) => a - b);
  return {
    count: modules.length,
    definedA: definedA.length,
    definedD: definedD.length,
    minA: sortedA[0],
    medianA: sortedA[Math.floor(sortedA.length / 2)],
    maxA: sortedA[sortedA.length - 1],
    nearMainSequence: definedD.filter((d) => d <= 0.3).length,
    farFromMainSequence: definedD.filter((d) => d > 0.7).length,
  };
}

/**
 * Merge ts-morph-complexity readings into a workspace report.  Adds
 * `function_count`, `max_cyclomatic`, `max_cognitive`, plus medians, to
 * each module.  Per-folder: `max_cyclomatic` and `max_cognitive` are the
 * max across the folder's modules (worst-case fitness signal); folder
 * `function_count` is the sum.  Also propagates the per-source spread
 * counters `high_cognitive_count` / `high_cyclomatic_count` (functions
 * at or above the HIGH_*_THRESHOLD lines in complexity.mjs) and sums
 * them into a workspace-level total the MT01 fitness gate reads as the
 * `high-cognitive-fn-count` / `high-cyclomatic-fn-count` ratchet
 * metrics.  Non-mutating.
 */
export function mergeComplexity(report, complexity) {
  const byModule = new Map();
  for (const r of complexity?.readings ?? []) {
    if (r && typeof r.source === 'string') {
      byModule.set(r.source, r);
    }
  }
  const modules = report.workspace.modules.map((m) => {
    const reading = byModule.get(m.source);
    if (!reading) {
      return {
        ...m,
        function_count: 0,
        max_cyclomatic: null,
        median_cyclomatic: null,
        max_cognitive: null,
        median_cognitive: null,
        high_cognitive_count: 0,
        high_cyclomatic_count: 0,
      };
    }
    return {
      ...m,
      function_count: reading.function_count ?? 0,
      max_cyclomatic: typeof reading.max_cyclomatic === 'number' ? reading.max_cyclomatic : null,
      median_cyclomatic:
        typeof reading.median_cyclomatic === 'number' ? reading.median_cyclomatic : null,
      max_cognitive: typeof reading.max_cognitive === 'number' ? reading.max_cognitive : null,
      median_cognitive:
        typeof reading.median_cognitive === 'number' ? reading.median_cognitive : null,
      high_cognitive_count:
        typeof reading.high_cognitive_count === 'number' ? reading.high_cognitive_count : 0,
      high_cyclomatic_count:
        typeof reading.high_cyclomatic_count === 'number' ? reading.high_cyclomatic_count : 0,
    };
  });
  const folders = report.workspace.folders.map((f) => {
    const prefix = `${f.name}/`;
    const inFolder = modules.filter((m) => m.source === f.name || m.source.startsWith(prefix));
    const cycValues = inFolder.map((m) => m.max_cyclomatic).filter((v) => typeof v === 'number');
    const cogValues = inFolder.map((m) => m.max_cognitive).filter((v) => typeof v === 'number');
    const fnSum = inFolder.reduce((acc, m) => acc + (m.function_count ?? 0), 0);
    const highCogSum = inFolder.reduce((acc, m) => acc + (m.high_cognitive_count ?? 0), 0);
    const highCycSum = inFolder.reduce((acc, m) => acc + (m.high_cyclomatic_count ?? 0), 0);
    return {
      ...f,
      function_count: fnSum,
      max_cyclomatic: cycValues.length === 0 ? null : Math.max(...cycValues),
      max_cognitive: cogValues.length === 0 ? null : Math.max(...cogValues),
      high_cognitive_count: highCogSum,
      high_cyclomatic_count: highCycSum,
    };
  });
  const highCognitiveTotal = modules.reduce((acc, m) => acc + (m.high_cognitive_count ?? 0), 0);
  const highCyclomaticTotal = modules.reduce((acc, m) => acc + (m.high_cyclomatic_count ?? 0), 0);
  return {
    ...report,
    complexityTool: complexity?.tool ?? null,
    workspace: {
      ...report.workspace,
      modules,
      folders,
      complexityDistribution: summarizeComplexity(modules),
      high_cognitive_count: highCognitiveTotal,
      high_cyclomatic_count: highCyclomaticTotal,
    },
  };
}

/**
 * Merge APSS topology readings into the workspace report.  Per the
 * preservation rule recorded in ADR-0017 (sentrux + APSS coexist; APSS
 * is canonical for new gates, but the existing dep-cruiser/ts-morph/
 * complexity values stay unchanged), APSS readings land under a
 * dedicated `apss` sub-object on each module rather than overwriting
 * Ca/Ce/I/A/D/complexity.  Folders get a `apss_modules` count plus
 * `apss_distance_max` for a worst-case rollup.  Non-mutating.
 */
export function mergeApssTopology(report, apss) {
  if (!apss || apss.available === false) {
    return {
      ...report,
      apssTopologyTool: null,
      apssAvailable: false,
      workspace: { ...report.workspace },
    };
  }
  const byModule = new Map();
  for (const r of apss?.readings ?? []) {
    if (r && typeof r.source === 'string') {
      byModule.set(r.source, r);
    }
  }
  const modules = report.workspace.modules.map((m) => {
    const reading = byModule.get(m.source);
    if (!reading) {
      return m;
    }
    const { source: _s, functions, ...metrics } = reading;
    const functionList = Array.isArray(functions) ? functions : [];
    return {
      ...m,
      apss: {
        ...metrics,
        functions: functionList,
        function_count:
          functionList.length > 0 ? functionList.length : (metrics.function_count ?? null),
      },
    };
  });
  const folders = report.workspace.folders.map((f) => {
    const prefix = `${f.name}/`;
    const inFolder = modules.filter((m) => m.source === f.name || m.source.startsWith(prefix));
    const withApss = inFolder.filter((m) => m.apss);
    const dValues = withApss
      .map((m) => m.apss?.distance_from_main_sequence)
      .filter((v) => typeof v === 'number');
    const ceValues = withApss
      .map((m) => m.apss?.efferent_coupling ?? m.apss?.ce)
      .filter((v) => typeof v === 'number');
    const functionValues = withApss.flatMap((m) => m.apss?.functions ?? []);
    const cognitiveValues = functionValues
      .map((fn) => fn.cognitive)
      .filter((v) => typeof v === 'number');
    const cyclomaticValues = functionValues
      .map((fn) => fn.cyclomatic)
      .filter((v) => typeof v === 'number');
    return {
      ...f,
      apss_modules: withApss.length,
      apss_distance_max: dValues.length === 0 ? null : Math.max(...dValues),
      apss_efferent_coupling_max: ceValues.length === 0 ? null : Math.max(...ceValues),
      apss_max_cognitive: cognitiveValues.length === 0 ? null : Math.max(...cognitiveValues),
      apss_max_cyclomatic: cyclomaticValues.length === 0 ? null : Math.max(...cyclomaticValues),
    };
  });
  return {
    ...report,
    apssTopologyTool: apss?.tool ?? null,
    apssAvailable: true,
    workspace: {
      ...report.workspace,
      modules,
      folders,
    },
  };
}

function summarizeComplexity(modules) {
  const cyc = modules.map((m) => m.max_cyclomatic).filter((v) => typeof v === 'number');
  const cog = modules.map((m) => m.max_cognitive).filter((v) => typeof v === 'number');
  const fnCount = modules.reduce((acc, m) => acc + (m.function_count ?? 0), 0);
  if (cyc.length === 0 && cog.length === 0) {
    return { count: modules.length, definedCyc: 0, definedCog: 0, totalFunctions: fnCount };
  }
  const sortedCyc = [...cyc].sort((a, b) => a - b);
  const sortedCog = [...cog].sort((a, b) => a - b);
  return {
    count: modules.length,
    definedCyc: cyc.length,
    definedCog: cog.length,
    totalFunctions: fnCount,
    maxCyc: cyc.length === 0 ? null : sortedCyc[sortedCyc.length - 1],
    medianCyc: cyc.length === 0 ? null : sortedCyc[Math.floor(sortedCyc.length / 2)],
    maxCog: cog.length === 0 ? null : sortedCog[sortedCog.length - 1],
    medianCog: cog.length === 0 ? null : sortedCog[Math.floor(sortedCog.length / 2)],
  };
}

/**
 * Count circular dependency edges in the raw cruiser module list, scoped
 * to workspace sources only. dep-cruiser sets a `circular: true` flag on
 * every dependency edge that is part of a detected cycle. We sum those
 * flags across all in-scope modules; each cycle of length N is counted
 * as N edges (one per participating module).  Source for the APSS ST01
 * (Structural Integrity) adapter, bead create-harness-app-2zz.1.
 */
export function countCircularEdges(rawModules) {
  if (!Array.isArray(rawModules)) {
    return 0;
  }
  let count = 0;
  for (const m of rawModules) {
    if (!isWorkspaceName(m?.source)) {
      continue;
    }
    for (const dep of m?.dependencies ?? []) {
      if (dep && dep.circular === true) {
        count += 1;
      }
    }
  }
  return count;
}

/** Aggregate a cruiser JSON object into a workspace-scoped report. */
export function aggregate(cruiser) {
  const rawModules = Array.isArray(cruiser?.modules) ? cruiser.modules : [];
  const rawFolders = Array.isArray(cruiser?.folders) ? cruiser.folders : [];
  const deduped = dedupeModules(rawModules);
  const workspaceModules = deduped.filter((m) => isWorkspaceName(m.source));
  const workspaceFolders = scopeFolders(rawFolders);
  return {
    tool: 'dependency-cruiser',
    raw: {
      totalCruised: cruiser?.summary?.totalCruised ?? rawModules.length,
      totalDependenciesCruised: cruiser?.summary?.totalDependenciesCruised ?? 0,
      modulesBeforeDedupe: rawModules.length,
      modulesAfterDedupe: deduped.length,
    },
    workspace: {
      folders: workspaceFolders,
      modules: workspaceModules,
      distribution: summarize(workspaceModules),
      circular_edges: countCircularEdges(rawModules),
    },
  };
}

function fmtI(i) {
  return i === null || i === undefined ? '—' : i.toFixed(3);
}

function fmtInt(n) {
  return n === null || n === undefined ? '—' : String(n);
}

/** Render the report as Markdown for human eyes. */
export function renderMarkdown(report) {
  const hasA = report.abstractnessTool !== null && report.abstractnessTool !== undefined;
  const hasC = report.complexityTool !== null && report.complexityTool !== undefined;
  const hasApss = report.apssAvailable === true;
  const lines = [];
  const tools = ['dependency-cruiser'];
  if (hasA) tools.push('ts-morph A');
  if (hasC) tools.push('ts-morph complexity');
  if (hasApss) tools.push('APSS topology');
  const title = `# Workspace architecture metrics (${tools.join(' + ')})`;
  lines.push(`${title}\n`);
  const r = report.raw;
  lines.push(
    `Raw cruise: ${r.totalCruised} modules / ${r.totalDependenciesCruised} deps. ` +
      `After de-dup: ${r.modulesAfterDedupe} (was ${r.modulesBeforeDedupe}). ` +
      `Workspace-scoped: ${report.workspace.modules.length} modules in ${report.workspace.folders.length} folders.\n`,
  );
  lines.push('## Per-folder\n');
  if (hasA) {
    lines.push('| folder | mods | Ca | Ce | I | A | D |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const f of report.workspace.folders) {
      lines.push(
        `| \`${f.name}\` | ${f.moduleCount} | ${f.Ca} | ${f.Ce} | ${fmtI(f.I)} | ${fmtI(f.A)} | ${fmtI(f.D)} |`,
      );
    }
  } else {
    lines.push('| folder | mods | Ca | Ce | I |');
    lines.push('|---|---:|---:|---:|---:|');
    for (const f of report.workspace.folders) {
      lines.push(`| \`${f.name}\` | ${f.moduleCount} | ${f.Ca} | ${f.Ce} | ${fmtI(f.I)} |`);
    }
  }
  lines.push('\n## Per-module\n');
  if (hasA) {
    lines.push('| module | Ca | Ce | I | A | D |');
    lines.push('|---|---:|---:|---:|---:|---:|');
    for (const m of report.workspace.modules) {
      lines.push(
        `| \`${m.source}\` | ${m.Ca} | ${m.Ce} | ${fmtI(m.I)} | ${fmtI(m.A)} | ${fmtI(m.D)} |`,
      );
    }
  } else {
    lines.push('| module | Ca | Ce | I |');
    lines.push('|---|---:|---:|---:|');
    for (const m of report.workspace.modules) {
      lines.push(`| \`${m.source}\` | ${m.Ca} | ${m.Ce} | ${fmtI(m.I)} |`);
    }
  }
  const d = report.workspace.distribution;
  lines.push('\n## Distribution\n');
  if (d.definedI === 0) {
    lines.push('_No modules with a defined I value._');
  } else {
    lines.push(`- modules with defined I: **${d.definedI} / ${d.count}**`);
    lines.push(`- min / median / max I: **${fmtI(d.min)} / ${fmtI(d.median)} / ${fmtI(d.max)}**`);
    lines.push(`- stable (I ≤ 0.2): **${d.stable}**, unstable (I ≥ 0.8): **${d.unstable}**`);
  }
  if (hasA) {
    const a = report.workspace.abstractnessDistribution;
    lines.push('');
    if (a.definedA === 0) {
      lines.push(
        '_No modules with a defined A value (ts-morph saw no class/interface declarations)._',
      );
    } else {
      lines.push(`- modules with defined A: **${a.definedA} / ${a.count}**`);
      lines.push(
        `- min / median / max A: **${fmtI(a.minA)} / ${fmtI(a.medianA)} / ${fmtI(a.maxA)}**`,
      );
      lines.push(
        `- main-sequence: **${a.nearMainSequence}** near (D ≤ 0.3), **${a.farFromMainSequence}** far (D > 0.7), ${a.definedD} with defined D`,
      );
    }
  }
  if (hasC) {
    const c = report.workspace.complexityDistribution;
    lines.push('');
    if (c.definedCyc === 0 && c.definedCog === 0) {
      lines.push(
        `_No modules with measurable complexity (ts-morph saw ${c.totalFunctions} function(s) total)._`,
      );
    } else {
      lines.push(
        `- functions scanned: **${c.totalFunctions}** across ${c.definedCyc} module(s) with cyclomatic, ${c.definedCog} with cognitive`,
      );
      lines.push(
        `- per-module max cyclomatic — median / max: **${fmtInt(c.medianCyc)} / ${fmtInt(c.maxCyc)}**`,
      );
      lines.push(
        `- per-module max cognitive — median / max: **${fmtInt(c.medianCog)} / ${fmtInt(c.maxCog)}**`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseAbstractnessFlag(argv) {
  for (const a of argv) {
    if (a.startsWith('--abstractness=')) {
      return a.slice('--abstractness='.length);
    }
  }
  return null;
}

function parseComplexityFlag(argv) {
  for (const a of argv) {
    if (a.startsWith('--complexity=')) {
      return a.slice('--complexity='.length);
    }
  }
  return null;
}

function parseApssFlag(argv) {
  for (const a of argv) {
    if (a.startsWith('--apss=')) {
      return a.slice('--apss='.length);
    }
  }
  return null;
}

/** CLI entry: read cruiser JSON from stdin, print JSON or Markdown to stdout. */
export async function main(
  argv = process.argv.slice(2),
  io = {
    read: readStdin,
    write: (s) => process.stdout.write(s),
    readFile: (p) => readFileSync(p, 'utf8'),
  },
) {
  const format = argv.includes('--format=md') || argv.includes('--md') ? 'md' : 'json';
  let raw;
  try {
    raw = await io.read();
  } catch (err) {
    process.stderr.write(`aggregate: failed to read stdin (${err.message})\n`);
    return 2;
  }
  if (raw.trim().length === 0) {
    process.stderr.write('aggregate: empty stdin — pipe cruiser JSON in\n');
    return 2;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`aggregate: stdin is not valid JSON (${err.message})\n`);
    return 2;
  }
  let report = aggregate(parsed);
  const abstractnessPath = parseAbstractnessFlag(argv);
  if (abstractnessPath) {
    let abstractness;
    try {
      abstractness = JSON.parse(io.readFile(abstractnessPath));
    } catch (err) {
      process.stderr.write(
        `aggregate: failed to read --abstractness=${abstractnessPath} (${err.message})\n`,
      );
      return 2;
    }
    report = mergeAbstractness(report, abstractness);
  }
  const complexityPath = parseComplexityFlag(argv);
  if (complexityPath) {
    let complexity;
    try {
      complexity = JSON.parse(io.readFile(complexityPath));
    } catch (err) {
      process.stderr.write(
        `aggregate: failed to read --complexity=${complexityPath} (${err.message})\n`,
      );
      return 2;
    }
    report = mergeComplexity(report, complexity);
  }
  const apssPath = parseApssFlag(argv);
  if (apssPath) {
    let apss;
    try {
      apss = JSON.parse(io.readFile(apssPath));
    } catch (err) {
      process.stderr.write(`aggregate: failed to read --apss=${apssPath} (${err.message})\n`);
      return 2;
    }
    report = mergeApssTopology(report, apss);
  }
  io.write(format === 'md' ? renderMarkdown(report) : `${JSON.stringify(report, null, 2)}\n`);
  return 0;
}

/** True when this module is being executed directly (not imported).
 *  Resolves symlinks on both sides because the slot ships at a path that
 *  ntm-style setups symlink in from /data/projects/<repo> — without realpath
 *  the comparison fails and main() never runs.
 */
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
      process.stderr.write(`aggregate: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(1);
    });
}
