// cx_gate.mjs - fast complexity-ONLY ratchet gate.
//
// The full sensors-gate (harness/sensors/bin/sensors gate) bundles:
// dependency-cruiser (~tens of seconds, npx + workspace graph walk),
// APSS topology, sentrux (52-language tree-sitter scan), aggregation,
// governance policy, ratchet snapshot. CI is the canonical place for
// that pipeline; locally it is too slow for tight inner-loop feedback
// on complexity regressions specifically.
//
// This gate strips the pipeline to ONE concern: per-function cyclomatic
// + cognitive complexity from complexity.mjs, compared against the
// three complexity-shaped ratchet floors already snapshotted in
// harness/sensors/baseline.json:
//   - MT01.max-cyclomatic       (peak per-function McCabe; max)
//   - MT01.max-cognitive        (peak per-function cognitive; max)
//   - MT01.high-cognitive-fn-count
//       (workspace SUM of functions at or above HIGH_COGNITIVE_THRESHOLD;
//        the spread signal that catches death-by-a-thousand-cuts even
//        when peak improves)
//
// Reuse, not duplication: the metric implementation, the spread
// threshold, and the baseline JSON are all imported / read live. This
// file owns NO scoring logic of its own; it composes existing pieces.
//
// Workspace scoping is direct (fs walk under ws_apps / ws_packages)
// rather than dependency-cruiser-mediated. Dropping the cruiser step
// is what makes the gate fast.
//
// Exit codes: 0 = floor held, 1 = regression on at least one of the
// three metrics, 2 = invocation error (missing baseline, missing
// ts-morph dep, etc).

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeFiles, HIGH_COGNITIVE_THRESHOLD } from './complexity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_DEFAULT = resolve(HERE, '..', '..');

const WORKSPACE_DIRS = ['ws_apps', 'ws_packages'];
const TS_RE = /\.(ts|tsx)$/;
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.next',
  'out',
  'dist',
  'build',
  '.turbo',
  'coverage',
  '.cache',
  '.beads',
  '.ntm',
  '.git',
]);

/** Walk a directory tree and yield workspace .ts/.tsx files. */
async function walk(dir, out, repoRoot) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name)) {
        continue;
      }
      await walk(full, out, repoRoot);
      continue;
    }
    if (!ent.isFile()) {
      continue;
    }
    if (!TS_RE.test(ent.name)) {
      continue;
    }
    out.push(relative(repoRoot, full));
  }
}

export async function collectWorkspaceSources(repoRoot) {
  const out = [];
  for (const dir of WORKSPACE_DIRS) {
    const full = join(repoRoot, dir);
    try {
      const s = statSync(full);
      if (!s.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    await walk(full, out, repoRoot);
  }
  return out.sort();
}

/**
 * Pull the complexity-shaped MT01 floors from a baseline.json object.
 * Returns the three numeric baselines we enforce; null when the field
 * is missing or non-numeric, which the comparator treats as advisory.
 */
export function extractFloors(baseline) {
  const mt01 = baseline?.dimensions?.MT01?.metrics ?? {};
  const pick = (key) => {
    const v = mt01?.[key]?.baseline;
    return typeof v === 'number' ? v : null;
  };
  return {
    'max-cognitive': pick('max-cognitive'),
    'max-cyclomatic': pick('max-cyclomatic'),
    'high-cognitive-fn-count': pick('high-cognitive-fn-count'),
  };
}

/**
 * Roll workspace readings up to the three workspace-level numbers the
 * gate compares against floors. Mirrors the aggregation contract in
 * harness/sensors/aggregate.mjs (max of per-source max, sum of per-source
 * high counts) so a regression caught here is the same shape of
 * regression the full ratchet would flag.
 */
export function rollupReadings(readings) {
  let maxCognitive = null;
  let maxCyclomatic = null;
  let highCognitiveTotal = 0;
  for (const r of readings) {
    if (typeof r.max_cognitive === 'number') {
      maxCognitive =
        maxCognitive === null ? r.max_cognitive : Math.max(maxCognitive, r.max_cognitive);
    }
    if (typeof r.max_cyclomatic === 'number') {
      maxCyclomatic =
        maxCyclomatic === null ? r.max_cyclomatic : Math.max(maxCyclomatic, r.max_cyclomatic);
    }
    if (typeof r.high_cognitive_count === 'number') {
      highCognitiveTotal += r.high_cognitive_count;
    }
  }
  return {
    'max-cognitive': maxCognitive,
    'max-cyclomatic': maxCyclomatic,
    'high-cognitive-fn-count': highCognitiveTotal,
  };
}

/**
 * Compare workspace rollups against the floor. All three MT01
 * complexity metrics have direction `max` (smaller is better): a
 * regression is current > floor. Floor of null means baseline has not
 * recorded a value yet; we let that pass (the full ratchet owns
 * baseline writes).
 */
export function compareToFloor(rollup, floors) {
  const failures = [];
  for (const key of Object.keys(floors)) {
    const floor = floors[key];
    const current = rollup[key];
    if (floor === null || typeof current !== 'number') {
      continue;
    }
    if (current > floor) {
      failures.push({ metric: key, current, floor });
    }
  }
  return { ok: failures.length === 0, failures };
}

function renderHumanReport(rollup, floors, comparison, fileCount, elapsedMs) {
  const lines = [];
  lines.push(
    `cx-gate: scanned ${fileCount} workspace .ts/.tsx file(s) in ${elapsedMs.toFixed(0)} ms`,
  );
  for (const key of Object.keys(floors)) {
    const floor = floors[key];
    const current = rollup[key];
    const floorStr = floor === null ? '(no floor)' : String(floor);
    const curStr = typeof current === 'number' ? String(current) : '(none)';
    const note =
      typeof current === 'number' && typeof floor === 'number'
        ? current > floor
          ? ' REGRESSION'
          : current < floor
            ? ' (improved; full ratchet will tighten)'
            : ''
        : '';
    lines.push(`  ${key}: current=${curStr} floor=${floorStr}${note}`);
  }
  if (!comparison.ok) {
    lines.push('');
    lines.push('cx-gate: FAIL - complexity regression vs. baseline floor:');
    for (const f of comparison.failures) {
      lines.push(`  ${f.metric}: ${f.current} > floor ${f.floor}`);
    }
    lines.push('');
    lines.push(
      'Fix: reduce the function(s) responsible (peak or spread), then re-run. ' +
        'Run `just sensors gate` to refresh the full ratchet once the regression is resolved.',
    );
  } else {
    lines.push('cx-gate: OK (no complexity regression vs. baseline)');
  }
  lines.push(
    `  (HIGH_COGNITIVE_THRESHOLD=${HIGH_COGNITIVE_THRESHOLD}; baseline floors from harness/sensors/baseline.json MT01)`,
  );
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const opts = {
    repoRoot: REPO_ROOT_DEFAULT,
    baselinePath: null,
    format: 'human',
    files: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--repo-root' && i + 1 < argv.length) {
      i += 1;
      opts.repoRoot = resolve(argv[i]);
    } else if (a.startsWith('--repo-root=')) {
      opts.repoRoot = resolve(a.slice('--repo-root='.length));
    } else if (a === '--baseline' && i + 1 < argv.length) {
      i += 1;
      opts.baselinePath = resolve(argv[i]);
    } else if (a.startsWith('--baseline=')) {
      opts.baselinePath = resolve(a.slice('--baseline='.length));
    } else if (a === '--format' && i + 1 < argv.length) {
      i += 1;
      opts.format = argv[i];
    } else if (a.startsWith('--format=')) {
      opts.format = a.slice('--format='.length);
    } else if (a === '--files' && i + 1 < argv.length) {
      i += 1;
      opts.files = argv[i].split(',').filter(Boolean);
    } else if (a.startsWith('--files=')) {
      opts.files = a.slice('--files='.length).split(',').filter(Boolean);
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    }
  }
  if (opts.baselinePath === null) {
    opts.baselinePath = resolve(opts.repoRoot, 'harness', 'sensors', 'baseline.json');
  }
  return opts;
}

const HELP = `harness/sensors/cx_gate.mjs - fast complexity-only ratchet gate

Usage: node harness/sensors/cx_gate.mjs [options]

Options:
  --repo-root PATH      Workspace root (default: repository root).
  --baseline PATH       Path to baseline.json (default: harness/sensors/baseline.json).
  --files a.ts,b.ts     Override file list (advanced; default = full workspace walk).
  --format human|json   Output format (default: human).

Exit codes:
  0  No regression against MT01.{max-cognitive, max-cyclomatic, high-cognitive-fn-count}.
  1  Regression on at least one of the three complexity floors.
  2  Invocation error (missing baseline, ts-morph not installed, etc.).
`;

export async function main(argv = process.argv.slice(2), io = defaultIo()) {
  const opts = parseArgs(argv);
  if (opts.help) {
    io.write(HELP);
    return 0;
  }
  let baselineRaw;
  try {
    baselineRaw = readFileSync(opts.baselinePath, 'utf8');
  } catch (err) {
    io.writeErr(`cx-gate: failed to read baseline at ${opts.baselinePath} (${err.message})\n`);
    return 2;
  }
  let baseline;
  try {
    baseline = JSON.parse(baselineRaw);
  } catch (err) {
    io.writeErr(`cx-gate: baseline.json is not valid JSON (${err.message})\n`);
    return 2;
  }
  const floors = extractFloors(baseline);

  const start = process.hrtime.bigint();
  let files;
  if (opts.files && opts.files.length > 0) {
    files = opts.files.map((f) => relative(opts.repoRoot, resolve(opts.repoRoot, f)));
  } else {
    files = await collectWorkspaceSources(opts.repoRoot);
  }
  const absFiles = files.map((f) => resolve(opts.repoRoot, f));
  let readings;
  try {
    readings = analyzeFiles(absFiles);
  } catch (err) {
    io.writeErr(`cx-gate: complexity analysis failed (${err.message})\n`);
    return 2;
  }
  const rollup = rollupReadings(readings);
  const comparison = compareToFloor(rollup, floors);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

  if (opts.format === 'json') {
    io.write(
      `${JSON.stringify(
        {
          tool: 'cx-gate',
          repo_root: opts.repoRoot,
          baseline_path: opts.baselinePath,
          file_count: files.length,
          elapsed_ms: Math.round(elapsedMs),
          floors,
          current: rollup,
          ok: comparison.ok,
          failures: comparison.failures,
          high_cognitive_threshold: HIGH_COGNITIVE_THRESHOLD,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    io.write(renderHumanReport(rollup, floors, comparison, files.length, elapsedMs));
  }
  return comparison.ok ? 0 : 1;
}

function defaultIo() {
  return {
    write: (s) => process.stdout.write(s),
    writeErr: (s) => process.stderr.write(s),
  };
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
      process.stderr.write(`cx-gate: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(2);
    });
}
