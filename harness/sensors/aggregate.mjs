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

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORKSPACE_RE = /^(ws_apps|ws_packages)\//;

/** Return true when a cruiser node name is workspace code (not vendor / not bare). */
export function isWorkspaceName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return false;
  }
  if (name.startsWith('node_modules')) {
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
    return { count: modules.length, definedI: 0, min: null, median: null, max: null, stable: 0, unstable: 0 };
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
    },
  };
}

function fmtI(i) {
  return i === null || i === undefined ? '—' : i.toFixed(3);
}

/** Render the report as Markdown for human eyes. */
export function renderMarkdown(report) {
  const lines = [];
  lines.push('# Workspace architecture metrics (dependency-cruiser)\n');
  const r = report.raw;
  lines.push(
    `Raw cruise: ${r.totalCruised} modules / ${r.totalDependenciesCruised} deps. ` +
      `After de-dup: ${r.modulesAfterDedupe} (was ${r.modulesBeforeDedupe}). ` +
      `Workspace-scoped: ${report.workspace.modules.length} modules in ${report.workspace.folders.length} folders.\n`,
  );
  lines.push('## Per-folder\n');
  lines.push('| folder | mods | Ca | Ce | I |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const f of report.workspace.folders) {
    lines.push(`| \`${f.name}\` | ${f.moduleCount} | ${f.Ca} | ${f.Ce} | ${fmtI(f.I)} |`);
  }
  lines.push('\n## Per-module\n');
  lines.push('| module | Ca | Ce | I |');
  lines.push('|---|---:|---:|---:|');
  for (const m of report.workspace.modules) {
    lines.push(`| \`${m.source}\` | ${m.Ca} | ${m.Ce} | ${fmtI(m.I)} |`);
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
  return `${lines.join('\n')}\n`;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** CLI entry: read cruiser JSON from stdin, print JSON or Markdown to stdout. */
export async function main(argv = process.argv.slice(2), io = { read: readStdin, write: (s) => process.stdout.write(s) }) {
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
  const report = aggregate(parsed);
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
