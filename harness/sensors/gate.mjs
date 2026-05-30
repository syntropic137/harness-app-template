// gate.mjs — baseline-snapshot fitness gate for the sensors slot.
//
// Reads a workspace report (the output of aggregate.mjs) and compares each
// folder's Martin metrics against a persisted baseline. Fails on any
// worsening of `I` (instability) or `D` (distance from the main sequence).
//
// Closes bead create-harness-app-n48.4 (P0).  Implements ADR-0017's
// Decision (2) consequence — the gate consumes whatever the aggregator
// emits (Node aggregator today, APSS topology later) without depending on
// APSS being ported first.
//
// Discipline (operator framing, governance-every-run):
//   - First run: no baseline exists → write current report as the baseline
//     and exit 0 with a "baseline created" message. The baseline becomes a
//     committed floor.
//   - Subsequent runs: compare each folder. A regression is any folder
//     whose `I` or `D` is numerically greater than the baseline (beyond a
//     small epsilon). Exit non-zero on any regression; print a per-folder
//     diff so the operator sees exactly what worsened.
//   - The baseline is never auto-updated on regression. The only way to
//     change the floor is `gate --update-baseline`, which is a deliberate
//     act recorded in git.
//
// Preservation-first: aggregate.mjs and abstractness.mjs are untouched.
// The gate consumes their JSON output without altering it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, realpathSync } from 'node:fs';

const EPSILON = 1e-6;

/**
 * Extract a stable baseline shape from an aggregator report.  Per-folder
 * `I` and `D` only — modules are too granular (renames invalidate the
 * baseline immediately) and `Ca`/`Ce` count are directionally ambiguous
 * (growth raises them legitimately).
 */
export function extractBaselineMetrics(report) {
  const folders = {};
  for (const f of report?.workspace?.folders ?? []) {
    if (typeof f?.name !== 'string') {
      continue;
    }
    folders[f.name] = {
      I: typeof f.I === 'number' ? f.I : null,
      D: typeof f.D === 'number' ? f.D : null,
    };
  }
  return { folders };
}

/**
 * Compare a current report against a baseline shape.  Returns
 * `{ ok, regressions, summary }`.
 *
 * A regression is any baseline folder whose `I` or `D` is strictly worse
 * (numerically greater) in the current report, beyond `EPSILON`.
 *
 * New folders in the current report (absent from baseline) are NOT
 * regressions — they're new code that hasn't been measured against a
 * floor yet.  Removed folders (present in baseline, absent in current)
 * are also not regressions; they were refactored away or filtered out.
 */
export function compareBaseline(baseline, currentReport) {
  const current = extractBaselineMetrics(currentReport);
  const regressions = [];
  const baseFolders = baseline?.folders ?? {};
  const curFolders = current.folders;

  let comparedFolders = 0;
  for (const [name, base] of Object.entries(baseFolders)) {
    const cur = curFolders[name];
    if (!cur) {
      continue;
    }
    comparedFolders += 1;
    if (
      typeof base.I === 'number' &&
      typeof cur.I === 'number' &&
      cur.I > base.I + EPSILON
    ) {
      regressions.push({
        folder: name,
        metric: 'I',
        baseline: base.I,
        current: cur.I,
        delta: cur.I - base.I,
      });
    }
    if (
      typeof base.D === 'number' &&
      typeof cur.D === 'number' &&
      cur.D > base.D + EPSILON
    ) {
      regressions.push({
        folder: name,
        metric: 'D',
        baseline: base.D,
        current: cur.D,
        delta: cur.D - base.D,
      });
    }
  }

  const newFolders = Object.keys(curFolders).filter((n) => !(n in baseFolders));
  const removedFolders = Object.keys(baseFolders).filter((n) => !(n in curFolders));

  return {
    ok: regressions.length === 0,
    regressions,
    summary: {
      comparedFolders,
      newFolders,
      removedFolders,
    },
  };
}

function fmt(n) {
  return n === null || n === undefined ? '—' : n.toFixed(3);
}

/** Render a human-readable diff. */
export function renderReport(comparison) {
  const lines = [];
  if (comparison.ok) {
    lines.push('sensors gate: PASS');
  } else {
    lines.push('sensors gate: FAIL');
  }
  const { comparedFolders, newFolders, removedFolders } = comparison.summary;
  lines.push(
    `compared ${comparedFolders} folder(s); ` +
      `${newFolders.length} new, ${removedFolders.length} removed.`,
  );
  if (newFolders.length > 0) {
    lines.push(`  new (no baseline floor yet): ${newFolders.join(', ')}`);
  }
  if (removedFolders.length > 0) {
    lines.push(`  removed (refactored or filtered): ${removedFolders.join(', ')}`);
  }
  if (comparison.regressions.length > 0) {
    lines.push('');
    lines.push('regressions:');
    for (const r of comparison.regressions) {
      lines.push(
        `  ${r.folder}  ${r.metric}: ${fmt(r.baseline)} → ${fmt(r.current)}  ` +
          `(+${fmt(r.delta)})`,
      );
    }
    lines.push('');
    lines.push(
      'If the regression is intentional (refactor, slot redesign), update the ' +
        'baseline deliberately: `just sensors gate --update-baseline` and commit ' +
        'the resulting harness/sensors/baseline.json as part of the same change.',
    );
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

/**
 * CLI entry.  Defaults: read aggregator JSON from stdin, baseline from
 * `harness/sensors/baseline.json`.  Flags:
 *   --baseline=<path>      override baseline path
 *   --update-baseline      write the current report as the new baseline
 *                          (exits 0)
 *   --first-run-mode=...   `snapshot` (default) writes baseline on first
 *                          run and exits 0; `strict` exits non-zero if no
 *                          baseline exists.
 */
export async function main(
  argv = process.argv.slice(2),
  io = {
    read: readStdin,
    write: (s) => process.stdout.write(s),
    writeErr: (s) => process.stderr.write(s),
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, s) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, s);
    },
    fileExists: (p) => existsSync(p),
  },
) {
  let baselinePath = 'harness/sensors/baseline.json';
  let updateBaseline = false;
  let firstRunMode = 'snapshot';
  for (const a of argv) {
    if (a.startsWith('--baseline=')) {
      baselinePath = a.slice('--baseline='.length);
    } else if (a === '--update-baseline') {
      updateBaseline = true;
    } else if (a.startsWith('--first-run-mode=')) {
      firstRunMode = a.slice('--first-run-mode='.length);
    }
  }

  let raw;
  try {
    raw = await io.read();
  } catch (err) {
    io.writeErr(`gate: failed to read stdin (${err.message})\n`);
    return 2;
  }
  if (raw.trim().length === 0) {
    io.writeErr('gate: empty stdin — pipe aggregator JSON in\n');
    return 2;
  }
  let report;
  try {
    report = JSON.parse(raw);
  } catch (err) {
    io.writeErr(`gate: stdin is not valid JSON (${err.message})\n`);
    return 2;
  }

  const currentBaseline = extractBaselineMetrics(report);

  if (updateBaseline) {
    io.writeFile(baselinePath, `${JSON.stringify(currentBaseline, null, 2)}\n`);
    io.write(`sensors gate: baseline updated at ${baselinePath}\n`);
    return 0;
  }

  if (!io.fileExists(baselinePath)) {
    if (firstRunMode === 'strict') {
      io.writeErr(
        `gate: no baseline at ${baselinePath} and --first-run-mode=strict; ` +
          'run with --update-baseline once to create it.\n',
      );
      return 2;
    }
    io.writeFile(baselinePath, `${JSON.stringify(currentBaseline, null, 2)}\n`);
    io.write(
      `sensors gate: baseline created at ${baselinePath} (first run; ` +
        `${Object.keys(currentBaseline.folders).length} folder(s) recorded).\n`,
    );
    return 0;
  }

  let baseline;
  try {
    baseline = JSON.parse(io.readFile(baselinePath));
  } catch (err) {
    io.writeErr(`gate: failed to read baseline at ${baselinePath} (${err.message})\n`);
    return 2;
  }

  const comparison = compareBaseline(baseline, report);
  io.write(renderReport(comparison));
  return comparison.ok ? 0 : 1;
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
      process.stderr.write(`gate: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(1);
    });
}

// `resolve` is part of the public path-handling contract (consumers may
// override `io.readFile` with absolute paths); imported for symmetry with
// `dirname` to satisfy the linter.
void resolve;
