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
const FITNESS_SCHEMA_VERSION = '1.0.0';

const DIMENSION_ORDER = ['MT01', 'MD01', 'ST01', 'SC01', 'LG01', 'AC01', 'PF01', 'AV01'];

const DIMENSIONS = {
  MT01: {
    name: 'Maintainability',
    promotion_status: 'active',
    enforcement: 'enforced',
    default: 'default-enabled',
  },
  MD01: {
    name: 'Modularity and Coupling',
    promotion_status: 'active',
    enforcement: 'enforced',
    default: 'default-enabled',
  },
  ST01: {
    name: 'Structural Integrity',
    promotion_status: 'active',
    enforcement: 'enforced',
    default: 'default-enabled',
  },
  SC01: {
    name: 'Security',
    promotion_status: 'active',
    enforcement: 'enforced',
    default: 'default-enabled',
  },
  LG01: {
    name: 'Legality',
    promotion_status: 'incubating',
    enforcement: 'advisory',
    default: 'default-enabled',
  },
  AC01: {
    name: 'Accessibility',
    promotion_status: 'incubating',
    enforcement: 'advisory',
    default: 'opt-in',
  },
  PF01: {
    name: 'Performance',
    promotion_status: 'incubating',
    enforcement: 'advisory',
    default: 'opt-in',
  },
  AV01: {
    name: 'Availability',
    promotion_status: 'incubating',
    enforcement: 'advisory',
    default: 'opt-in',
  },
};

const FITNESS_METRICS = {
  MT01: [
    {
      id: 'max-cognitive',
      name: 'Maximum Cognitive Complexity',
      objective:
        'Max function cognitive complexity from APSS functions or the local complexity adapter.',
      source: '.topology/metrics/functions.json or harness/sensors/complexity.mjs',
      direction: 'max',
      default_threshold: 15,
      fail_on_regression: true,
      value: (report) => maxNumber([
        ...apssFunctionValues(report, 'cognitive'),
        ...moduleValues(report, (m) => m.max_cognitive),
        ...folderValues(report, (f) => f.max_cognitive ?? f.apss_max_cognitive),
      ]),
    },
    {
      id: 'max-cyclomatic',
      name: 'Maximum Cyclomatic Complexity',
      objective:
        'Max function cyclomatic complexity from APSS functions or the local complexity adapter.',
      source: '.topology/metrics/functions.json or harness/sensors/complexity.mjs',
      direction: 'max',
      default_threshold: 10,
      fail_on_regression: true,
      value: (report) => maxNumber([
        ...apssFunctionValues(report, 'cyclomatic'),
        ...moduleValues(report, (m) => m.max_cyclomatic),
        ...folderValues(report, (f) => f.max_cyclomatic ?? f.apss_max_cyclomatic),
      ]),
    },
    {
      id: 'max-halstead-volume',
      name: 'Maximum Halstead Volume',
      objective: 'Max APSS Halstead volume per function when APSS emits Halstead metrics.',
      source: '.topology/metrics/functions.json metrics.halstead.volume',
      direction: 'max',
      default_threshold: 1000,
      fail_on_regression: true,
      value: (report) => maxNumber(apssFunctionValues(report, 'halstead_volume')),
    },
  ],
  MD01: [
    {
      id: 'max-fan-out',
      name: 'Maximum Efferent Coupling',
      objective:
        'Max module efferent coupling from APSS coupling or the dependency-cruiser fallback.',
      source: '.topology/metrics/coupling.json or aggregate workspace modules',
      direction: 'max',
      default_threshold: 20,
      fail_on_regression: true,
      value: (report) => maxNumber([
        ...moduleValues(report, (m) => m.apss?.efferent_coupling ?? m.apss?.ce ?? m.Ce),
        ...folderValues(report, (f) => f.apss_efferent_coupling_max),
      ]),
    },
    {
      id: 'max-main-sequence-distance',
      name: 'Maximum Distance from Main Sequence',
      objective: 'Max module distance from the Martin main sequence.',
      source: '.topology/metrics/coupling.json or aggregate workspace modules',
      direction: 'max',
      default_threshold: 0.7,
      fail_on_regression: true,
      value: (report) => maxNumber([
        ...moduleValues(report, (m) => m.apss?.distance_from_main_sequence ?? m.D),
        ...folderValues(report, (f) => f.apss_distance_max ?? f.D),
      ]),
    },
    {
      id: 'instability-out-of-range-count',
      name: 'Instability Outside Healthy Range',
      objective: 'Count modules with instability below 0.1 or above 0.9.',
      source: '.topology/metrics/coupling.json or aggregate workspace modules',
      direction: 'max',
      default_threshold: 0,
      fail_on_regression: true,
      value: (report) =>
        moduleValues(report, (m) => m.apss?.instability ?? m.I).filter(
          (v) => typeof v === 'number' && (v < 0.1 || v > 0.9),
        ).length,
    },
  ],
  ST01: [
    {
      id: 'circular-dependency-edges',
      name: 'Circular Dependency Edges',
      objective:
        'Count of dependency edges flagged as circular by dependency-cruiser, scoped to workspace sources (ws_apps + ws_packages). Each cycle of length N contributes N edges. Source: workspace.circular_edges in the aggregate report (bead create-harness-app-2zz.1).',
      source: 'aggregate workspace.circular_edges (dependency-cruiser circular flag)',
      direction: 'max',
      default_threshold: 0,
      fail_on_regression: true,
      value: (report) => {
        const v = report?.workspace?.circular_edges;
        return typeof v === 'number' ? v : null;
      },
    },
  ],
  SC01: [
    {
      id: 'critical-finding-count',
      name: 'Critical Security Finding Count',
      objective:
        'Count of critical-severity findings emitted by the Ultimate Bug Scanner (UBS) over template-owned source paths. The bin/sensors wrapper runs ubs --report-json scoped to a stable file list and writes the JSON to a tempfile; the gate reads totals.critical via --security=<path>. Soft-skip yields a null reading; an active scan with zero findings yields baseline 0 and the gate fails on any new critical pattern (bead create-harness-app-2zz.2).',
      source: 'ubs --report-json totals.critical (template-owned source paths)',
      direction: 'max',
      default_threshold: 0,
      fail_on_regression: true,
      value: (_report, options) => ubsCriticalCount(options),
    },
  ],
  LG01: [
    {
      id: 'license-violation-count',
      name: 'License Violation Count',
      objective: 'Count denied or unknown license findings once a license adapter is wired.',
      source: 'incubating adapter slot',
      direction: 'max',
      default_threshold: 0,
      fail_on_regression: true,
      value: () => null,
    },
  ],
  AC01: [
    {
      id: 'accessibility-violation-count',
      name: 'Accessibility Violation Count',
      objective: 'Count accessibility violations once a web accessibility adapter is wired.',
      source: 'incubating adapter slot',
      direction: 'max',
      default_threshold: 0,
      fail_on_regression: true,
      value: () => null,
    },
  ],
  PF01: [
    {
      id: 'startup-benchmark-mean',
      name: 'Maximum Startup Benchmark Mean',
      objective:
        'Maximum hyperfine benchmark mean wall-clock from harness/perf/baseline.json. Reports the committed perf floor; the separate harness/perf gate enforces regression at pre-push with its own per-benchmark tolerance.',
      source: 'harness/perf/baseline.json benchmarks.[*].mean',
      direction: 'max',
      default_threshold: 5,
      fail_on_regression: false,
      value: (_report, options) => maxNumber(perfBenchmarkMeans(options)),
    },
    {
      id: 'startup-benchmark-count',
      name: 'Startup Benchmark Count',
      objective:
        'Number of benchmarks committed in harness/perf/baseline.json. Floor of zero is acceptable until hyperfine has produced a real measurement.',
      source: 'harness/perf/baseline.json benchmarks',
      direction: 'min',
      default_threshold: 0,
      fail_on_regression: false,
      value: (_report, options) => perfBenchmarkMeans(options).length,
    },
  ],
  AV01: [
    {
      id: 'availability-failure-count',
      name: 'Availability Failure Count',
      objective: 'Count availability or resilience failures once an adapter is wired.',
      source: 'incubating adapter slot',
      direction: 'max',
      default_threshold: 0,
      fail_on_regression: true,
      value: () => null,
    },
  ],
};

function moduleValues(report, read) {
  return (report?.workspace?.modules ?? []).map(read).filter((v) => typeof v === 'number');
}

function folderValues(report, read) {
  return (report?.workspace?.folders ?? []).map(read).filter((v) => typeof v === 'number');
}

function apssFunctionValues(report, field) {
  return (report?.workspace?.modules ?? [])
    .flatMap((m) => (Array.isArray(m?.apss?.functions) ? m.apss.functions : []))
    .map((fn) => fn?.[field])
    .filter((v) => typeof v === 'number');
}

function maxNumber(values) {
  const nums = values.filter((v) => typeof v === 'number');
  return nums.length === 0 ? null : Math.max(...nums);
}

/**
 * Read the UBS report the SC01 dimension watches. Accepts either a
 * pre-parsed object on options.security or a filesystem reader pair
 * on options.io pointing at options.securityPath. Returns the
 * critical-finding count (null when no report is available, so the
 * gate degrades to "no reading" rather than a false zero).
 */
function ubsCriticalCount(options) {
  let report = options?.security;
  if (!report && options?.io && options?.securityPath) {
    if (options.io.fileExists?.(options.securityPath)) {
      try {
        report = JSON.parse(options.io.readFile(options.securityPath));
      } catch {
        report = null;
      }
    }
  }
  if (!report) {
    return null;
  }
  const total = report?.totals?.critical;
  if (typeof total === 'number') {
    return total;
  }
  // Some UBS modes omit totals; sum per-scanner critical fields.
  const scanners = Array.isArray(report?.scanners) ? report.scanners : [];
  if (scanners.length === 0) {
    return null;
  }
  return scanners.reduce(
    (acc, s) => acc + (typeof s?.critical === 'number' ? s.critical : 0),
    0,
  );
}

/**
 * Read the perf baseline benchmarks the PF01 dimension watches. Accepts
 * either a pre-parsed object on options.perf or a filesystem reader
 * pair on options.io that points at a path on options.perfPath. Used
 * to wire the existing harness/perf adapter into the APSS fitness gate
 * (bead create-harness-app-2zz).
 */
function perfBenchmarkMeans(options) {
  let perf = options?.perf;
  if (!perf && options?.io && options?.perfPath) {
    if (options.io.fileExists?.(options.perfPath)) {
      try {
        perf = JSON.parse(options.io.readFile(options.perfPath));
      } catch {
        perf = null;
      }
    }
  }
  const benchmarks = perf?.benchmarks ?? {};
  return Object.values(benchmarks)
    .map((b) => (typeof b?.mean === 'number' ? b.mean : null))
    .filter((v) => typeof v === 'number');
}

function worsened(direction, current, baseline) {
  if (typeof current !== 'number' || typeof baseline !== 'number') {
    return false;
  }
  if (direction === 'min') {
    return current < baseline - EPSILON;
  }
  return current > baseline + EPSILON;
}

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

export function extractApssFitnessBaseline(report, options = {}) {
  const dimensions = {};
  for (const code of DIMENSION_ORDER) {
    const dimension = DIMENSIONS[code];
    const metrics = {};
    for (const metric of FITNESS_METRICS[code] ?? []) {
      const baseline = metric.value(report, options);
      metrics[metric.id] = {
        name: metric.name,
        objective: metric.objective,
        source: metric.source,
        direction: metric.direction,
        default_threshold: metric.default_threshold,
        baseline,
        fail_on_regression: metric.fail_on_regression,
      };
    }
    dimensions[code] = {
      ...dimension,
      metrics,
    };
  }
  return {
    schema_version: FITNESS_SCHEMA_VERSION,
    standard: 'APS-V1-0002',
    generated_by: 'harness/sensors/gate.mjs',
    ...extractBaselineMetrics(report),
    dimensions,
  };
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
function compareLegacyBaseline(baseline, currentReport) {
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

export function compareFitnessBaseline(baseline, currentReport, options = {}) {
  const current = extractApssFitnessBaseline(currentReport, options);
  const regressions = [];
  const advisoryRegressions = [];
  const missingBaselines = [];
  const dimensionSummaries = {};
  let comparedMetrics = 0;

  for (const code of DIMENSION_ORDER) {
    const dimension = current.dimensions[code];
    const baselineDimension = baseline?.dimensions?.[code];
    const metricSummaries = {};
    let evaluated = 0;
    let failed = 0;
    let warned = 0;
    let missing = 0;

    for (const [metricId, currentMetric] of Object.entries(dimension.metrics ?? {})) {
      const baselineMetric = baselineDimension?.metrics?.[metricId];
      const baselineValue = baselineMetric?.baseline;
      const currentValue = currentMetric.baseline;
      const hasBaseline = typeof baselineValue === 'number';
      const hasCurrent = typeof currentValue === 'number';
      const regression =
        currentMetric.fail_on_regression &&
        hasBaseline &&
        hasCurrent &&
        worsened(currentMetric.direction, currentValue, baselineValue);

      if (hasBaseline && hasCurrent) {
        comparedMetrics += 1;
        evaluated += 1;
      } else {
        missing += 1;
        missingBaselines.push({ dimension: code, metric: metricId, baseline: baselineValue, current: currentValue });
      }

      const summary = {
        name: currentMetric.name,
        baseline: baselineValue ?? null,
        current: currentValue ?? null,
        direction: currentMetric.direction,
        fail_on_regression: currentMetric.fail_on_regression,
        regression,
      };
      metricSummaries[metricId] = summary;

      if (regression) {
        const delta = currentValue - baselineValue;
        const record = {
          dimension: code,
          metric: metricId,
          metric_name: currentMetric.name,
          baseline: baselineValue,
          current: currentValue,
          delta,
          enforcement: dimension.enforcement,
        };
        if (dimension.enforcement === 'enforced') {
          failed += 1;
          regressions.push(record);
        } else {
          warned += 1;
          advisoryRegressions.push({
            ...record,
            diagnostic: 'INCUBATING_DIMENSION_ERROR_DOWNGRADED',
          });
        }
      }
    }

    dimensionSummaries[code] = {
      name: dimension.name,
      runtime_status: evaluated > 0 ? 'evaluated' : 'skipped',
      promotion_status: dimension.promotion_status,
      enforcement: dimension.enforcement,
      rules_evaluated: evaluated,
      rules_failed: failed,
      rules_warned: warned,
      rules_missing_baseline: missing,
      metrics: metricSummaries,
    };
  }

  return {
    ok: regressions.length === 0,
    regressions,
    advisoryRegressions,
    missingBaselines,
    comparedMetrics,
    dimensions: dimensionSummaries,
  };
}

/**
 * Compare a current report against a baseline shape.  Old baselines with
 * only `folders` keep the n48 I/D behavior. New baselines with
 * `dimensions` also enforce APSS active MT01/MD01 metric regressions.
 */
export function compareBaseline(baseline, currentReport, options = {}) {
  const legacy = compareLegacyBaseline(baseline, currentReport);
  if (!baseline?.dimensions) {
    return legacy;
  }

  const fitness = compareFitnessBaseline(baseline, currentReport, options);
  const regressions = [...legacy.regressions, ...fitness.regressions];
  return {
    ok: legacy.ok && fitness.ok,
    regressions,
    legacyRegressions: legacy.regressions,
    fitness,
    summary: {
      ...legacy.summary,
      fitnessComparedMetrics: fitness.comparedMetrics,
      advisoryRegressions: fitness.advisoryRegressions.length,
      missingBaselines: fitness.missingBaselines.length,
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
  if (comparison.fitness) {
    const { fitnessComparedMetrics, advisoryRegressions, missingBaselines } = comparison.summary;
    const dimEntries = DIMENSION_ORDER.map((code) => comparison.fitness.dimensions?.[code]).filter(Boolean);
    const enforced = dimEntries.filter((d) => d.enforcement === 'enforced');
    const advisory = dimEntries.filter((d) => d.enforcement === 'advisory');
    const enforcedEvaluated = enforced.filter((d) => d.rules_evaluated > 0).length;
    const advisoryEvaluated = advisory.filter((d) => d.rules_evaluated > 0).length;
    lines.push('');
    lines.push(
      `APSS fitness: ${enforcedEvaluated}/${enforced.length} enforced ` +
        `dimensions actively gating; ${advisoryEvaluated}/${advisory.length} ` +
        `advisory dimensions reporting; ${fitnessComparedMetrics} metric(s) compared; ` +
        `${advisoryRegressions} advisory regression(s); ${missingBaselines} missing baseline(s).`,
    );
    for (const code of DIMENSION_ORDER) {
      const d = comparison.fitness.dimensions?.[code];
      if (!d) {
        continue;
      }
      const tag = d.enforcement === 'enforced' ? '[ENFORCED]' : '[advisory]';
      const lane =
        d.rules_evaluated > 0
          ? `evaluated ${d.rules_evaluated}, failed ${d.rules_failed}, warned ${d.rules_warned}`
          : 'no adapter wired';
      lines.push(`  ${tag} ${code} ${d.name}: ${lane}`);
    }
  }
  if (comparison.regressions.length > 0) {
    lines.push('');
    lines.push('regressions:');
    for (const r of comparison.regressions) {
      if (r.folder) {
        lines.push(
          `  ${r.folder}  ${r.metric}: ${fmt(r.baseline)} → ${fmt(r.current)}  ` +
            `(+${fmt(r.delta)})`,
        );
      } else {
        lines.push(
          `  ${r.dimension} ${r.metric}: ${fmt(r.baseline)} -> ${fmt(r.current)} ` +
            `(+${fmt(r.delta)})`,
        );
      }
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
  let perfPath = 'harness/perf/baseline.json';
  let securityPath = null;
  let updateBaseline = false;
  let firstRunMode = 'snapshot';
  for (const a of argv) {
    if (a.startsWith('--baseline=')) {
      baselinePath = a.slice('--baseline='.length);
    } else if (a.startsWith('--perf-baseline=')) {
      perfPath = a.slice('--perf-baseline='.length);
    } else if (a.startsWith('--security=')) {
      securityPath = a.slice('--security='.length);
    } else if (a === '--update-baseline') {
      updateBaseline = true;
    } else if (a.startsWith('--first-run-mode=')) {
      firstRunMode = a.slice('--first-run-mode='.length);
    }
  }

  const fitnessOptions = { perfPath, securityPath, io };

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

  const currentBaseline = extractApssFitnessBaseline(report, fitnessOptions);

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

  const comparison = compareBaseline(baseline, report, fitnessOptions);
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
