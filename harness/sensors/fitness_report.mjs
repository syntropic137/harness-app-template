// fitness_report.mjs - agent-facing read-only architectural-health report.
//
// The sensors slot already MEASURES + GATES + RATCHETS architectural
// fitness across MT01 / MD01 / ST01 / SC01 / LG01 / PF01 (the active
// dimensions in harness/sensors/baseline.json). Today the only feedback
// any coding agent receives is a gate FAILURE - tight only on the
// regression path. This module closes the other half of the loop: a
// fast, concise, agent-readable report that prints the current value,
// the ratchet floor, and the headroom for every fitness dimension,
// flagging dimensions that are at or near their floor so an agent can
// see "you are one cognitive-complexity point away from tripping the
// MT01 max-cognitive floor" BEFORE it commits and trips the gate.
//
// Discipline (read-only, no side effects on the baseline or the gate):
//   - This module REUSES gate.mjs primitives (FITNESS_METRICS-aware
//     value extraction via extractApssFitnessBaseline + the comparison
//     shape returned by compareFitnessBaseline). It owns no metric
//     definitions of its own and never writes to baseline.json.
//   - The status classifier (PASS / AT-RISK / FAIL / SKIP) is layered
//     ON TOP of the gate's "ok / regression" decision; the gate stays
//     the sole authority over whether a run is allowed to pass. This
//     report tells the agent how close it is to that line; it does not
//     change the line.
//   - When no current readings are available (no stdin, no
//     --readings-from) the report renders a FLOORS-ONLY view from
//     baseline.json so the surface still gives an agent the targets to
//     beat. The hook integration uses this mode for the fast one-liner.
//
// Closes bead create-harness-app-feat-fitness-feedback-report.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { compareFitnessBaseline, extractApssFitnessBaseline } from './gate.mjs';

const EPSILON = 1e-6;
const AT_RISK_FRACTION = 0.1; // headroom < 10% of |floor| -> AT-RISK
const AT_RISK_MIN_ABS = 1; // integer-typed counts: 1 step from the floor is AT-RISK

const DIMENSION_ORDER = ['MT01', 'MD01', 'ST01', 'SC01', 'LG01', 'AC01', 'PF01', 'AV01'];

const STATUS_RANK = {
  PASS: 0,
  SKIP: 0,
  'AT-RISK': 1,
  FAIL: 2,
};

const STATUS_TAG = {
  PASS: '[ OK ]',
  SKIP: '[ -- ]',
  'AT-RISK': '[NEAR]',
  FAIL: '[FAIL]',
};

/**
 * Direction-aware signed headroom: how far the current measurement is
 * from the floor, in the "better is positive" direction.
 *   - direction `max` (smaller is better): floor - current
 *   - direction `min` (larger  is better): current - floor
 * Returns null when either side is missing or non-finite.
 */
export function headroom(direction, current, floor) {
  if (typeof current !== 'number' || typeof floor !== 'number') {
    return null;
  }
  if (!Number.isFinite(current) || !Number.isFinite(floor)) {
    return null;
  }
  return direction === 'min' ? current - floor : floor - current;
}

/**
 * Classify a single metric. Mirrors the gate's regression boundary
 * (worsened() uses EPSILON), then layers the AT-RISK band on top:
 *   - FAIL when headroom is below -EPSILON (the gate would fail).
 *   - AT-RISK when headroom is non-negative but inside the AT-RISK
 *     band, EXCEPT when the floor is the theoretical minimum for the
 *     metric (max-direction at 0, current also 0) - that case is PASS
 *     because the floor cannot tighten further.
 *   - PASS otherwise.
 *   - SKIP when either floor or current is missing.
 */
export function classifyMetric({ direction, current, floor }) {
  const hasFloor = typeof floor === 'number' && Number.isFinite(floor);
  const hasCurrent = typeof current === 'number' && Number.isFinite(current);
  if (!hasFloor || !hasCurrent) {
    return { status: 'SKIP', headroom: null };
  }
  const h = headroom(direction, current, floor);
  if (h < -EPSILON) {
    return { status: 'FAIL', headroom: h };
  }
  // current is exactly at the floor and the floor is the theoretical
  // boundary (0): the metric cannot legally tighten further on either
  // direction, so flagging this as AT-RISK every commit is noise.
  if (floor === 0 && current === 0) {
    return { status: 'PASS', headroom: h };
  }
  const band = Math.max(AT_RISK_MIN_ABS, AT_RISK_FRACTION * Math.abs(floor));
  if (h < band) {
    return { status: 'AT-RISK', headroom: h };
  }
  return { status: 'PASS', headroom: h };
}

function worstStatus(a, b) {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/**
 * Compose the structured report. Pure: takes a baseline object and a
 * current report object and emits per-dimension/per-metric rows plus an
 * overall status. Does not read the filesystem or write anything; the
 * CLI wrapper handles I/O.
 *
 * Output shape (stable contract for agent consumers):
 *   {
 *     schema_version,
 *     overall_status,             // PASS | AT-RISK | FAIL
 *     dimensions: [
 *       { code, name, enforcement, status, metrics: [
 *         { id, name, direction, current, floor, headroom, status, fail_on_regression }
 *       ]}
 *     ],
 *     summary: { pass, at_risk, fail, skip }
 *   }
 */
export function buildReport({ baseline, currentReport, fitnessOptions = {} } = {}) {
  const current = extractApssFitnessBaseline(currentReport ?? emptyReport(), fitnessOptions);
  const summary = { pass: 0, at_risk: 0, fail: 0, skip: 0 };
  const dimensions = [];
  let overall = 'PASS';

  for (const code of DIMENSION_ORDER) {
    const currentDim = current.dimensions?.[code];
    const baselineDim = baseline?.dimensions?.[code];
    if (!currentDim) {
      continue;
    }
    const metricRows = [];
    let dimStatus = 'PASS';
    const enforcement = currentDim.enforcement ?? baselineDim?.enforcement ?? 'enforced';

    for (const [metricId, currentMetric] of Object.entries(currentDim.metrics ?? {})) {
      const floor = baselineDim?.metrics?.[metricId]?.baseline;
      const currentValue = currentMetric.baseline;
      const direction = currentMetric.direction;
      const { status, headroom: h } = classifyMetric({
        direction,
        current: currentValue,
        floor,
      });

      const row = {
        id: metricId,
        name: currentMetric.name,
        direction,
        current: typeof currentValue === 'number' ? currentValue : null,
        floor: typeof floor === 'number' ? floor : null,
        headroom: h,
        status,
        fail_on_regression: currentMetric.fail_on_regression !== false,
      };
      metricRows.push(row);

      if (status === 'PASS') summary.pass += 1;
      else if (status === 'AT-RISK') summary.at_risk += 1;
      else if (status === 'FAIL') summary.fail += 1;
      else summary.skip += 1;

      dimStatus = worstStatus(dimStatus, status === 'SKIP' ? 'PASS' : status);
    }

    dimensions.push({
      code,
      name: currentDim.name,
      enforcement,
      promotion_status: currentDim.promotion_status,
      status: dimStatus,
      metrics: metricRows,
    });

    if (enforcement === 'enforced') {
      overall = worstStatus(overall, dimStatus);
    }
  }

  return {
    schema_version: '1.0.0',
    generated_by: 'harness/sensors/fitness_report.mjs',
    overall_status: overall,
    summary,
    dimensions,
  };
}

function emptyReport() {
  return { workspace: { folders: [], modules: [] } };
}

function fmtNum(n) {
  if (n === null || n === undefined) return 'n/a';
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3);
}

function fmtHeadroom(h, direction) {
  if (h === null || h === undefined) return 'n/a';
  if (typeof h !== 'number' || !Number.isFinite(h)) return 'n/a';
  const sign = h >= 0 ? '+' : '';
  const value = Number.isInteger(h) ? String(h) : h.toFixed(3);
  // Direction hint so the reader can see "better by N" vs "worse by N".
  const arrow = direction === 'min' ? '>=floor' : '<=floor';
  return `${sign}${value} (${arrow})`;
}

function pad(s, w) {
  s = String(s);
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

/**
 * Render the human-readable report. Concise, fixed-width columns, fast
 * to skim. Status tags are bracketed so they survive grep / agent
 * parsing pipelines.
 */
export function renderText(report) {
  const lines = [];
  const tag = STATUS_TAG[report.overall_status] ?? '[ ?? ]';
  lines.push(
    `Fitness ${tag} overall: ${report.overall_status} ` +
      `(${report.summary.pass} pass, ${report.summary.at_risk} at-risk, ` +
      `${report.summary.fail} fail, ${report.summary.skip} skip)`,
  );
  lines.push('');
  // Column widths sized for the canonical metric IDs in baseline.json.
  const metricW = 34;
  const numW = 10;
  for (const dim of report.dimensions) {
    const dimTag = STATUS_TAG[dim.status] ?? '[ ?? ]';
    const enforcementTag = dim.enforcement === 'enforced' ? 'ENFORCED' : 'advisory';
    lines.push(`${dimTag} ${dim.code} ${dim.name} [${enforcementTag}]`);
    lines.push(
      `       ${pad('metric', metricW)} ${pad('current', numW)} ${pad('floor', numW)} ${pad('headroom', numW + 8)} status`,
    );
    for (const m of dim.metrics) {
      const rowTag = STATUS_TAG[m.status] ?? '[ ?? ]';
      lines.push(
        `       ${pad(m.id, metricW)} ${pad(fmtNum(m.current), numW)} ${pad(fmtNum(m.floor), numW)} ${pad(fmtHeadroom(m.headroom, m.direction), numW + 8)} ${rowTag} ${m.status}`,
      );
    }
    lines.push('');
  }
  lines.push(
    'Read this report whenever you change code that touches complexity, ' +
      'coupling, cycles, security findings, or licensing. AT-RISK means the ' +
      'next regression on that metric will trip the ratchet; PASS means you ' +
      'have headroom. Run `just sensors gate` (slow, ~108 s) to refresh all ' +
      'sensors; this command is the agent-facing READ-ONLY surface and never ' +
      'rewrites baseline.json.',
  );
  return `${lines.join('\n')}\n`;
}

/**
 * One-line summary, intended for hook output. Always emits exactly one
 * line so coding agents and shells can grep it without parsing tables.
 */
export function renderSummary(report) {
  const tag = STATUS_TAG[report.overall_status] ?? '[ ?? ]';
  const atRiskNames = report.dimensions
    .flatMap((d) => d.metrics.filter((m) => m.status === 'AT-RISK').map((m) => `${d.code}/${m.id}`))
    .slice(0, 3);
  const failNames = report.dimensions
    .flatMap((d) => d.metrics.filter((m) => m.status === 'FAIL').map((m) => `${d.code}/${m.id}`))
    .slice(0, 3);
  const parts = [];
  if (failNames.length > 0) {
    parts.push(`fail=${failNames.join(',')}`);
  }
  if (atRiskNames.length > 0) {
    parts.push(`at-risk=${atRiskNames.join(',')}`);
  }
  parts.push(
    `${report.summary.pass}P/${report.summary.at_risk}R/${report.summary.fail}F/${report.summary.skip}-`,
  );
  return `fitness ${tag} ${report.overall_status} ${parts.join(' ')} (run \`just fitness\` for the table)`;
}

export function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Optionally treat the report as a comparison shape. Useful for
 * consumers that want the same `compareFitnessBaseline` payload the
 * gate emits, sourced from the same primitives.
 */
export function asComparison({ baseline, currentReport, fitnessOptions = {} } = {}) {
  return compareFitnessBaseline(baseline, currentReport ?? emptyReport(), fitnessOptions);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseArgs(argv) {
  const opts = {
    baselinePath: 'harness/sensors/baseline.json',
    readingsFromPath: null,
    perfPath: 'harness/perf/baseline.json',
    securityPath: null,
    licensesPath: null,
    sentruxPath: null,
    deadcodePath: null,
    format: 'text',
    quick: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--baseline=')) opts.baselinePath = a.slice('--baseline='.length);
    else if (a === '--baseline') {
      opts.baselinePath = argv[i + 1] ?? opts.baselinePath;
      i += 1;
    } else if (a.startsWith('--readings-from=')) {
      opts.readingsFromPath = a.slice('--readings-from='.length);
    } else if (a === '--readings-from') {
      opts.readingsFromPath = argv[i + 1] ?? opts.readingsFromPath;
      i += 1;
    } else if (a.startsWith('--perf-baseline=')) opts.perfPath = a.slice('--perf-baseline='.length);
    else if (a.startsWith('--security=')) opts.securityPath = a.slice('--security='.length);
    else if (a.startsWith('--licenses=')) opts.licensesPath = a.slice('--licenses='.length);
    else if (a.startsWith('--sentrux=')) opts.sentruxPath = a.slice('--sentrux='.length);
    else if (a === '--sentrux') {
      opts.sentruxPath = argv[i + 1] ?? opts.sentruxPath;
      i += 1;
    } else if (a.startsWith('--deadcode=')) opts.deadcodePath = a.slice('--deadcode='.length);
    else if (a === '--deadcode') {
      opts.deadcodePath = argv[i + 1] ?? opts.deadcodePath;
      i += 1;
    } else if (a.startsWith('--format=')) opts.format = a.slice('--format='.length);
    else if (a === '--format') {
      opts.format = argv[i + 1] ?? opts.format;
      i += 1;
    } else if (a === '--json') opts.format = 'json';
    else if (a === '--summary') opts.format = 'summary';
    else if (a === '--quick' || a === '--floors-only') opts.quick = true;
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

const HELP = `harness/sensors/fitness_report.mjs - read-only fitness report

Usage: node harness/sensors/fitness_report.mjs [options] < aggregator.json
       just fitness [--quick] [--format=text|json|summary]

Options:
  --baseline=PATH        Path to baseline.json (default: harness/sensors/baseline.json).
  --readings-from=PATH   Replay aggregator/readings JSON instead of reading stdin.
  --perf-baseline=PATH   PF01 perf baseline (default: harness/perf/baseline.json).
  --security=PATH        UBS report JSON (feeds SC01).
  --licenses=PATH        License scan JSON (feeds LG01).
  --sentrux=PATH         Sentrux adapter envelope (feeds MT01/MD01/ST01 sentrux metrics).
  --deadcode=PATH        Knip dead-code adapter envelope (feeds MT01 unused-export-count).
  --format=FMT           text (default), json, or summary (one-liner for hooks).
  --json / --summary     Aliases for --format.
  --quick                Skip stdin; render the floor-only view from baseline.json.
                         Use this for fast one-liner output in pre-commit/pre-push.
  --help                 This text.

Output:
  text: per-dimension table of current, floor, headroom, status.
  summary: one line "fitness [TAG] STATUS ..." for hook output.
  json: structured payload for agent consumers.

Exit codes:
  0  Always 0 in --quick mode (read-only floor view).
  0  Overall PASS or AT-RISK.
  1  Overall FAIL (a metric is below its ratchet floor).
  2  Invocation error (missing baseline, malformed JSON, etc.).
`;

function defaultIo() {
  return {
    read: readStdin,
    write: (s) => process.stdout.write(s),
    writeErr: (s) => process.stderr.write(s),
    readFile: (p) => readFileSync(p, 'utf8'),
    fileExists: (p) => existsSync(p),
    env: process.env,
  };
}

export async function main(argv = process.argv.slice(2), io = defaultIo()) {
  const opts = parseArgs(argv);
  if (opts.help) {
    io.write(HELP);
    return 0;
  }
  if (!io.fileExists(opts.baselinePath)) {
    io.writeErr(`fitness: no baseline at ${opts.baselinePath}; run \`just sensors gate\` once.\n`);
    return 2;
  }
  let baseline;
  try {
    baseline = JSON.parse(io.readFile(opts.baselinePath));
  } catch (err) {
    io.writeErr(`fitness: failed to parse baseline (${err.message})\n`);
    return 2;
  }

  let currentReport = emptyReport();
  if (!opts.quick) {
    let raw = '';
    if (opts.readingsFromPath) {
      try {
        raw = io.readFile(opts.readingsFromPath);
      } catch (err) {
        io.writeErr(
          `fitness: failed to read --readings-from=${opts.readingsFromPath} (${err.message})\n`,
        );
        return 2;
      }
    } else {
      try {
        raw = await io.read();
      } catch (err) {
        io.writeErr(`fitness: failed to read stdin (${err.message})\n`);
        return 2;
      }
    }
    if (raw.trim().length > 0) {
      try {
        currentReport = JSON.parse(raw);
      } catch (err) {
        io.writeErr(`fitness: stdin is not valid JSON (${err.message})\n`);
        return 2;
      }
    }
  }

  const fitnessOptions = {
    perfPath: opts.perfPath,
    securityPath: opts.securityPath,
    licensesPath: opts.licensesPath,
    sentruxPath: opts.sentruxPath,
    deadcodePath: opts.deadcodePath,
    io,
  };

  const report = buildReport({ baseline, currentReport, fitnessOptions });

  if (opts.format === 'json') {
    io.write(renderJson(report));
  } else if (opts.format === 'summary') {
    io.write(`${renderSummary(report)}\n`);
  } else if (opts.format === 'text') {
    io.write(renderText(report));
  } else {
    io.writeErr(`fitness: unsupported --format=${opts.format}; expected text|json|summary\n`);
    return 2;
  }

  // Quick mode is purely informational - never fail. Live mode mirrors
  // the gate's pass/fail decision so an agent can wire `just fitness`
  // into automation that wants to short-circuit on FAIL.
  if (opts.quick) {
    return 0;
  }
  return report.overall_status === 'FAIL' ? 1 : 0;
}

function isScriptEntry() {
  if (!process.argv[1]) return false;
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
      process.stderr.write(`fitness: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(2);
    });
}
