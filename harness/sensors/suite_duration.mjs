// suite_duration.mjs — PF01 test-suite wall-clock adapter (ADR-0025).
//
// Ports the validated design from syntropic137/fitness-timing-lab
// (EXP-01..EXP-04) into harness/sensors as a sibling reading of the
// existing PF01 `startup-benchmark-mean` / `startup-benchmark-count`
// pair. Hybrid gate per ADR-0025 § Decision 4:
//
//   duration_observed > max(committed_p95 * (1 + relative_delta_percent/100),
//                           absolute_seconds_ceiling)
//
// Both thresholds come from the committed baseline file
// (`harness/sensors/suite-duration-baseline.json`). Per ADR-0020's
// direction-aware ratchet, the gate.mjs side declares
// `direction: max` on `suite-duration-p95-seconds` and `direction:
// min` on `suite-duration-iteration-count`; the ratchet auto-tightens
// the floor on improvement and refuses to widen on regression.
//
// Operator hard rules wired in code:
//
// 1. Coverage <100% on ANY metric in `coverage_floor_metrics` is a
//    HARD FAIL in BOTH advisory and enforce modes. Advisory may
//    downgrade a TIMING miss to WARN, NEVER a coverage miss.
//
// 2. No silent-100% fallback. If a coverage column listed in
//    `coverage_floor_metrics` is absent OR unparseable, the adapter
//    emits a `coverage_unverifiable` violation and exits non-zero.
//    The lab prototype's `prototype/suite-performance-sensor.mjs:220-228`
//    fallback-to-100 path is intentionally NOT ported.
//
// 3. Enforce mode runs N iterations (default 5) and reports both the
//    p95 and the median. Advisory mode may short-circuit at iteration
//    1 for fast feedback. The PF01 reader consumes the p95.
//
// 4. The adapter's exit code is the primary enforcer of the coverage
//    rule. `available: false` (no envelope) is what gate.mjs sees
//    when the adapter fails; the PF01 reader returns null in that
//    case, the same shape SC01 / LG01 / sentrux / deadcode adapters
//    already wear.
//
// CONTRACT — envelope shape consumed by gate.mjs:
//
//   {
//     "tool": "suite-duration",
//     "available": true | false,
//     "version": "1.0.0",
//     "mode": "enforce" | "advisory",
//     "command": "...",
//     "workdir": "...",
//     "iterations": [
//       {"index": 0, "wall_clock_seconds": 0.061, "coverage": {...}},
//       ...
//     ],
//     "duration_p95_seconds": 0.064,
//     "duration_median_seconds": 0.061,
//     "iteration_count": 5,
//     "violations": [],
//     "passed": true
//   }

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

export const SENSOR_VERSION = '1.0.0';

// Header tokens the parser maps to the four canonical coverage
// percentages. The mapping is permissive on the header phrasing (bun
// "% Lines" vs node "line %" vs vitest "Lines") and authoritative on
// the canonical key the rest of the adapter consumes.
const COVERAGE_COLUMN_TOKENS = {
  statements: ['stmts', 'statement'],
  branches: ['branch'],
  functions: ['func'],
  lines: ['line'],
};

/**
 * Parse a baseline JSON file and validate its shape. Returns the
 * parsed object on success or throws on missing/invalid fields. The
 * shape mirrors the schema pinned in ADR-0025 § Decision 3.
 */
export function loadBaseline(baselinePath, io = { readFile: readFileSync }) {
  const raw = io.readFile(baselinePath, 'utf8');
  const parsed = JSON.parse(raw);
  const required = [
    'suite_command',
    'workdir',
    'iteration_count',
    'duration_p95_seconds',
    'absolute_seconds_ceiling',
    'relative_delta_percent',
    'required_coverage_percent',
    'coverage_floor_metrics',
  ];
  for (const field of required) {
    if (!(field in parsed)) {
      throw new Error(`suite-duration baseline ${baselinePath} is missing field: ${field}`);
    }
  }
  if (!Array.isArray(parsed.coverage_floor_metrics) || parsed.coverage_floor_metrics.length === 0) {
    throw new Error(
      `suite-duration baseline ${baselinePath}: coverage_floor_metrics must be a non-empty array`,
    );
  }
  return parsed;
}

/**
 * Parse the suite's coverage output for the "all files" / "All files"
 * summary row and return the percentages it reports. Returns an
 * object whose keys are the canonical column names (statements,
 * branches, functions, lines). A column that the suite did NOT emit
 * is returned as `undefined` — NEVER assumed to be 100. This is the
 * EXP-04-flagged defect (1) the port fixes.
 */
export function parseCoverage(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { mode: 'missing-output', columns: {} };
  }
  const lines = text.split('\n');
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes('|') && /\b(line|stmt|statement|branch|func)\b/i.test(line)) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) {
    return { mode: 'missing-header', columns: {} };
  }
  const headerCells = splitRow(lines[headerIndex]).slice(1);
  let valueRow = null;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const row = lines[i];
    if (!row.includes('|')) {
      continue;
    }
    if (/^\s*(?:ℹ\s*)?all files\b/i.test(row)) {
      valueRow = row;
      break;
    }
  }
  if (!valueRow) {
    return { mode: 'missing-all-files-row', columns: {} };
  }
  const valueCells = splitRow(valueRow).slice(1);
  const columns = {};
  for (let i = 0; i < headerCells.length && i < valueCells.length; i += 1) {
    const headerToken = headerCells[i].toLowerCase();
    // Skip headers that are not percentage columns (e.g. node's
    // "uncovered lines" final column, which contains the word
    // "line" but is a list, not a percentage). Without this guard,
    // a coincidental token match overwrites a real percentage with
    // undefined and the no-silent-100% rule misfires on the wrong
    // metric.
    if (!headerToken.includes('%')) {
      continue;
    }
    const canonical = canonicalColumn(headerToken);
    if (!canonical) {
      continue;
    }
    const numeric = Number.parseFloat(valueCells[i]);
    columns[canonical] = Number.isFinite(numeric) ? numeric : undefined;
  }
  return { mode: 'parsed', columns };
}

function splitRow(row) {
  return row
    .replace(/^\s*ℹ\s*/, '')
    .split('|')
    .map((c) => c.trim());
}

function canonicalColumn(headerToken) {
  for (const [canonical, tokens] of Object.entries(COVERAGE_COLUMN_TOKENS)) {
    if (tokens.some((t) => headerToken.includes(t))) {
      return canonical;
    }
  }
  return null;
}

/**
 * Evaluate coverage against the baseline's required percent + the
 * explicit list of metrics that must be verified. Emits two distinct
 * violation kinds — `coverage_unverifiable` (column absent or
 * unparseable) and `coverage_below_floor` (column emitted but under
 * threshold) — so the adapter never silently treats a missing column
 * as 100. Both are fatal in BOTH advisory and enforce modes.
 */
export function evaluateCoverage(parsed, baseline) {
  const violations = [];
  for (const metric of baseline.coverage_floor_metrics) {
    const value = parsed.columns?.[metric];
    if (typeof value !== 'number') {
      violations.push({
        type: 'coverage_unverifiable',
        metric,
        message: `coverage metric "${metric}" is absent from suite output (parser state: ${parsed.mode}); the sensor refuses to assume 100% per ADR-0025`,
      });
      continue;
    }
    if (value < baseline.required_coverage_percent) {
      violations.push({
        type: 'coverage_below_floor',
        metric,
        value,
        required: baseline.required_coverage_percent,
        message: `coverage metric "${metric}" is ${value.toFixed(2)}%, required ${baseline.required_coverage_percent}%`,
      });
    }
  }
  return violations;
}

/**
 * Compute the p95 (interpolated) of a numeric array. Returns the
 * single value on a length-1 array and null on an empty array.
 */
export function computeP95(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 1) {
    return sorted[0];
  }
  const rank = 0.95 * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) {
    return sorted[lower];
  }
  const frac = rank - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * frac;
}

/**
 * Compute the median of a numeric array. Returns null on empty.
 */
export function computeMedian(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Evaluate the timing thresholds against the baseline using the
 * hybrid ceiling formula (ADR-0025 § Decision 4). Returns an array of
 * violation records. Advisory mode may downgrade these to a WARN; the
 * caller decides exit code per mode.
 */
export function evaluateTiming(observedP95, baseline) {
  const violations = [];
  if (typeof observedP95 !== 'number') {
    return violations;
  }
  const ratchet = baseline.duration_p95_seconds * (1 + baseline.relative_delta_percent / 100);
  const ceiling = Math.max(ratchet, baseline.absolute_seconds_ceiling);
  if (observedP95 > ceiling) {
    violations.push({
      type: 'timing_above_ceiling',
      observed_p95_seconds: observedP95,
      ratchet_seconds: ratchet,
      absolute_seconds_ceiling: baseline.absolute_seconds_ceiling,
      effective_ceiling_seconds: ceiling,
      message: `p95 wall-clock ${observedP95.toFixed(3)}s exceeds effective ceiling ${ceiling.toFixed(3)}s (=max(committed_p95 * ${1 + baseline.relative_delta_percent / 100}, absolute ${baseline.absolute_seconds_ceiling}s))`,
    });
  }
  return violations;
}

/**
 * Run the suite N times against the configured workdir, returning a
 * report of every iteration's wall-clock + coverage parse. The
 * adapter is decoupled from the spawn implementation via `runner` so
 * tests can inject deterministic timing/coverage without spawning a
 * child process.
 */
export function runIterations({ baseline, iterations, runner, now = () => performance.now() }) {
  const records = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = now();
    const { stdout, stderr, status } = runner({
      command: baseline.suite_command,
      cwd: baseline.workdir,
    });
    const elapsed = (now() - start) / 1000;
    const parsed = parseCoverage(`${stdout || ''}\n${stderr || ''}`);
    records.push({
      index: i,
      wall_clock_seconds: Number(elapsed.toFixed(3)),
      exit_status: status,
      coverage_parse_mode: parsed.mode,
      coverage_columns: parsed.columns,
    });
  }
  return records;
}

const DEFAULT_RUNNER = ({ command, cwd }) => {
  const run = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return { stdout: run.stdout, stderr: run.stderr, status: run.status };
};

/**
 * The canonical adapter entry point. Returns the report envelope plus
 * an exit-code recommendation derived from the operator's hard rules:
 *
 *  - coverage violations → exit non-zero in BOTH modes
 *  - timing violations  → exit non-zero in enforce mode, exit 0 (WARN
 *                         only) in advisory mode
 *  - suite-exit nonzero → exit non-zero in BOTH modes
 */
export function evaluate({
  mode,
  baseline,
  runner = DEFAULT_RUNNER,
  now = () => performance.now(),
}) {
  const wantIterations = mode === 'enforce' ? Math.max(baseline.iteration_count, 1) : 1;
  const records = runIterations({ baseline, iterations: wantIterations, runner, now });
  const wallClocks = records.map((r) => r.wall_clock_seconds);
  const p95 = computeP95(wallClocks);
  const median = computeMedian(wallClocks);

  const violations = [];
  for (const r of records) {
    if (r.exit_status !== 0) {
      violations.push({
        type: 'suite_command_failed',
        iteration: r.index,
        exit_status: r.exit_status,
        message: `suite command exited ${r.exit_status} on iteration ${r.index}`,
      });
    }
  }
  // Coverage: every iteration's coverage row must pass; we evaluate
  // the LAST iteration's parsed columns (every iteration is the same
  // suite; differing results would indicate non-determinism worth
  // surfacing in a future ADR).
  const last = records[records.length - 1];
  const parsedForCoverage = {
    mode: last?.coverage_parse_mode ?? 'missing-output',
    columns: last?.coverage_columns ?? {},
  };
  const coverageViolations = evaluateCoverage(parsedForCoverage, baseline);
  violations.push(...coverageViolations);
  const timingViolations = evaluateTiming(p95, baseline);
  violations.push(...timingViolations);

  const hasCoverageViolation = violations.some(
    (v) => v.type === 'coverage_below_floor' || v.type === 'coverage_unverifiable',
  );
  const hasSuiteFailure = violations.some((v) => v.type === 'suite_command_failed');
  const hasTimingViolation = violations.some((v) => v.type === 'timing_above_ceiling');

  // ADR-0025 § Decision 5: advisory mode keeps coverage + suite-failure
  // violations fatal. The advisory ramp only ever softens TIMING.
  let exitCode = 0;
  if (hasCoverageViolation || hasSuiteFailure) {
    exitCode = 1;
  } else if (hasTimingViolation && mode !== 'advisory') {
    exitCode = 1;
  }

  const envelope = {
    tool: 'suite-duration',
    available: !hasCoverageViolation && !hasSuiteFailure,
    version: SENSOR_VERSION,
    mode,
    command: baseline.suite_command,
    workdir: baseline.workdir,
    iterations: records.map((r) => ({
      index: r.index,
      wall_clock_seconds: r.wall_clock_seconds,
      coverage: r.coverage_columns,
    })),
    duration_p95_seconds: typeof p95 === 'number' ? Number(p95.toFixed(3)) : null,
    duration_median_seconds: typeof median === 'number' ? Number(median.toFixed(3)) : null,
    iteration_count: records.length,
    violations,
    passed: exitCode === 0 && violations.length === 0,
  };
  return { envelope, exitCode };
}

/**
 * Format a human-readable summary for the terminal. Agents read the
 * structured JSON envelope; humans see the summary.
 */
export function renderSummary(envelope) {
  const lines = [];
  const tag = `[${envelope.mode}]`;
  if (envelope.passed) {
    lines.push(`${tag} SUITE-DURATION: PASS`);
  } else {
    const hasCoverage = envelope.violations.some(
      (v) => v.type === 'coverage_below_floor' || v.type === 'coverage_unverifiable',
    );
    const hasTiming = envelope.violations.some((v) => v.type === 'timing_above_ceiling');
    const hasSuite = envelope.violations.some((v) => v.type === 'suite_command_failed');
    const status =
      hasCoverage || hasSuite
        ? 'FAIL'
        : hasTiming && envelope.mode === 'advisory'
          ? 'WARN-ONLY'
          : 'FAIL';
    lines.push(`${tag} SUITE-DURATION: ${status}`);
  }
  lines.push(
    `iterations: ${envelope.iteration_count}  p95: ${envelope.duration_p95_seconds}s  median: ${envelope.duration_median_seconds}s`,
  );
  for (const v of envelope.violations) {
    const prefix =
      v.type === 'timing_above_ceiling' && envelope.mode === 'advisory' ? 'WARN' : 'FAIL';
    lines.push(`${prefix}: ${v.message}`);
  }
  return lines.join('\n');
}

const HELP = `harness suite-duration — PF01 test-suite wall-clock sensor (ADR-0025)

Usage:
  node harness/sensors/suite_duration.mjs [--mode=enforce|advisory]
       [--baseline=PATH] [--report=PATH] [--quiet] [--json]

Modes:
  enforce  (default) — runs baseline.iteration_count iterations and
                       enforces the hybrid ceiling. Coverage <100% is
                       a HARD FAIL regardless of mode.
  advisory           — single-shot wall-clock; timing violations log
                       WARN and exit 0. Coverage violations remain
                       fatal.

Flags:
  --baseline=PATH    Path to the committed baseline file.
                     Default: harness/sensors/suite-duration-baseline.json
  --report=PATH      Write the JSON envelope to PATH (in addition to stdout).
  --json             Emit ONLY the JSON envelope (no summary).
  --quiet            Suppress the summary; envelope is still written.

Exit codes:
  0   PASS, or advisory-mode timing-only WARN.
  1   coverage failure (any mode), enforce-mode timing failure,
      or suite-command failure.
`;

export function parseArgs(argv) {
  const out = {
    mode: 'enforce',
    baselinePath: 'harness/sensors/suite-duration-baseline.json',
    reportPath: null,
    json: false,
    quiet: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      out.help = true;
    } else if (a === '--mode') {
      out.mode = argv[i + 1] ?? out.mode;
      i += 1;
    } else if (a.startsWith('--mode=')) {
      out.mode = a.slice('--mode='.length);
    } else if (a === '--advisory') {
      out.mode = 'advisory';
    } else if (a === '--enforce') {
      out.mode = 'enforce';
    } else if (a.startsWith('--baseline=')) {
      out.baselinePath = a.slice('--baseline='.length);
    } else if (a === '--baseline') {
      out.baselinePath = argv[i + 1] ?? out.baselinePath;
      i += 1;
    } else if (a.startsWith('--report=')) {
      out.reportPath = a.slice('--report='.length);
    } else if (a === '--report') {
      out.reportPath = argv[i + 1] ?? out.reportPath;
      i += 1;
    } else if (a === '--json') {
      out.json = true;
    } else if (a === '--quiet') {
      out.quiet = true;
    }
  }
  if (out.mode !== 'advisory' && out.mode !== 'enforce') {
    throw new Error(`invalid --mode "${out.mode}"; expected "advisory" or "enforce"`);
  }
  return out;
}

/**
 * Adapter entry point. Returns the exit code; the caller is
 * responsible for `process.exit`.
 */
export async function main(
  argv = process.argv.slice(2),
  io = {
    write: (s) => process.stdout.write(s),
    writeErr: (s) => process.stderr.write(s),
    readFile: readFileSync,
    writeFile: writeFileSync,
    exists: existsSync,
  },
  deps = { now: () => performance.now(), runner: DEFAULT_RUNNER },
) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    io.writeErr(`suite-duration: ${err.message}\n`);
    return 2;
  }
  if (opts.help) {
    io.write(HELP);
    return 0;
  }
  let baseline;
  try {
    baseline = loadBaseline(opts.baselinePath, { readFile: io.readFile });
  } catch (err) {
    io.writeErr(`suite-duration: failed to load baseline ${opts.baselinePath}: ${err.message}\n`);
    return 2;
  }
  if (!io.exists(baseline.workdir)) {
    io.writeErr(
      `suite-duration: baseline workdir "${baseline.workdir}" does not exist (run from repo root or fix the baseline path)\n`,
    );
    return 2;
  }
  const { envelope, exitCode } = evaluate({
    mode: opts.mode,
    baseline,
    runner: deps.runner,
    now: deps.now,
  });
  const payload = `${JSON.stringify(envelope, null, 2)}\n`;
  if (opts.reportPath) {
    io.writeFile(opts.reportPath, payload, 'utf8');
  }
  if (opts.json) {
    io.write(payload);
  } else {
    if (!opts.quiet) {
      io.write(`${renderSummary(envelope)}\n`);
    }
    io.write(payload);
  }
  return exitCode;
}

/* node:coverage disable */
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
      process.stderr.write(`suite-duration: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(2);
    });
}
/* node:coverage enable */

export const __testing__ = {
  COVERAGE_COLUMN_TOKENS,
  DEFAULT_RUNNER,
  HELP,
  splitRow,
  canonicalColumn,
};
