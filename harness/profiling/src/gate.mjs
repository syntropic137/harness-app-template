// harness/profiling/src/gate.mjs - generalized per-signal perf gate
// (bead create-harness-app-z41).
//
// Generalizes harness/perf/gate.mjs (startup-only, hyperfine-shaped) into
// a signal-shaped gate every profiling runner shares. A signal is a named
// scalar reading, for example:
//
//   "startup.example-typescript-start.mean": {"value": 0.42, "unit": "s"}
//   "api.latency.p99":                      {"value": 180.1, "unit": "ms"}
//   "ui.vitals.lcp":                        {"value": 1240,  "unit": "ms"}
//
// ADVISORY BY DEFAULT: a regression against baseline.json is reported but
// never fails the run unless harness/profiling/budgets.toml opts that
// signal into gating (`gate = true`) or sets an absolute `budget` ceiling.
// This mirrors the ratchet discipline of harness/perf/gate.mjs and
// harness/sensors/gate.mjs: the baseline floor only moves via an explicit
// --update-baseline, which is a reviewable git edit.
//
// harness/perf/gate.mjs stays untouched (preservation-first); the startup
// runner converts its hyperfine document into signals and feeds them here.

import { DEFAULT_TOLERANCE, loadBudgets } from './budgets.mjs';
import { isScriptEntry, makeNodeIo, runAsEntry } from './lib.mjs';

export const DEFAULT_BASELINE_PATH = 'harness/profiling/baseline.json';
export const DEFAULT_BUDGETS_PATH = 'harness/profiling/budgets.toml';

/** Coerce a signals map so each entry is {value, unit}. */
export function normalizeSignals(signals) {
  const out = {};
  for (const [name, entry] of Object.entries(signals ?? {})) {
    if (typeof entry === 'number') {
      out[name] = { value: entry, unit: null };
    } else if (
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.value === 'number' &&
      Number.isFinite(entry.value)
    ) {
      out[name] = { value: entry.value, unit: typeof entry.unit === 'string' ? entry.unit : null };
    }
  }
  return out;
}

function evaluateOne(name, reading, baselineEntry, budget) {
  const tolerance = budget?.tolerance ?? DEFAULT_TOLERANCE;
  const direction = budget?.direction ?? 'lower';
  const gated = budget?.gate === true;
  const result = {
    signal: name,
    value: reading.value,
    unit: reading.unit,
    baseline: typeof baselineEntry?.value === 'number' ? baselineEntry.value : null,
    tolerance,
    direction,
    budget: typeof budget?.budget === 'number' ? budget.budget : null,
    ceiling: null,
    gated,
    status: 'pass',
  };

  if (result.budget !== null) {
    const overBudget =
      direction === 'lower' ? reading.value > result.budget : reading.value < result.budget;
    if (overBudget) {
      result.status = 'fail-budget';
      return result;
    }
  }

  if (result.baseline === null) {
    result.status = 'new';
    return result;
  }

  result.ceiling =
    direction === 'lower' ? result.baseline * (1 + tolerance) : result.baseline * (1 - tolerance);
  const regressed =
    direction === 'lower' ? reading.value > result.ceiling : reading.value < result.ceiling;
  if (regressed) {
    result.status = gated ? 'fail-regression' : 'advisory-regression';
  }
  return result;
}

/**
 * Evaluate current signals against the baseline and budgets.
 * ok is false only when a GATED check failed (status fail-*); advisory
 * regressions keep ok true by design.
 */
export function evaluateSignals(currentSignals, baseline, budgets) {
  const signals = normalizeSignals(currentSignals);
  const baseSignals = baseline?.signals ?? {};
  const budgetSignals = budgets?.signals ?? {};
  const results = Object.entries(signals).map(([name, reading]) =>
    evaluateOne(name, reading, baseSignals[name], budgetSignals[name]),
  );
  const failures = results.filter((r) => r.status.startsWith('fail'));
  const advisories = results.filter((r) => r.status === 'advisory-regression');
  return {
    ok: failures.length === 0,
    results,
    summary: {
      evaluated: results.length,
      failures: failures.length,
      advisories: advisories.length,
      newSignals: results.filter((r) => r.status === 'new').map((r) => r.signal),
    },
  };
}

/** Snapshot the current signals as the new baseline document. */
export function toBaseline(currentSignals) {
  return { signals: normalizeSignals(currentSignals) };
}

function fmt(value, unit) {
  if (value === null || value === undefined) {
    return 'n/a';
  }
  const rendered = Number.isInteger(value) ? String(value) : value.toFixed(3);
  return unit ? `${rendered}${unit}` : rendered;
}

const STATUS_LABEL = {
  pass: '[ OK ] PASS',
  new: '[ -- ] NEW (no baseline yet)',
  'advisory-regression': '[WARN] ADVISORY regression',
  'fail-regression': '[FAIL] gated regression',
  'fail-budget': '[FAIL] over budget',
};

/** Human-readable gate report, one line per signal. */
export function renderGateReport(evaluation) {
  const lines = [];
  lines.push(evaluation.ok ? 'profiling gate: PASS' : 'profiling gate: FAIL');
  const { evaluated, failures, advisories, newSignals } = evaluation.summary;
  lines.push(
    `evaluated ${evaluated} signal(s); ${failures} gated failure(s), ` +
      `${advisories} advisory regression(s), ${newSignals.length} new.`,
  );
  for (const r of evaluation.results) {
    const bounds = [];
    if (r.ceiling !== null) {
      bounds.push(`ceiling ${fmt(r.ceiling, r.unit)}`);
    }
    if (r.budget !== null) {
      bounds.push(`budget ${fmt(r.budget, r.unit)}`);
    }
    const baselinePart = r.baseline === null ? '' : ` (baseline ${fmt(r.baseline, r.unit)})`;
    const boundsPart = bounds.length > 0 ? ` [${bounds.join(', ')}]` : '';
    lines.push(
      `  ${STATUS_LABEL[r.status]}  ${r.signal} = ${fmt(r.value, r.unit)}${baselinePart}${boundsPart}`,
    );
  }
  if (!evaluation.ok) {
    lines.push('');
    lines.push(
      'If the regression is intentional, move the floor deliberately: ' +
        '`just profile gate --update-baseline` (signals on stdin) and commit ' +
        'harness/profiling/baseline.json in the same change. Budgets live in ' +
        'harness/profiling/budgets.toml.',
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Build the verdict.json document a runner persists per artifact dir. */
export function buildVerdict({ mode, capturedAt, traceId, signals, evaluation, artifacts }) {
  return {
    schemaVersion: '1.0',
    slot: 'profiling',
    mode,
    capturedAt,
    traceId: traceId ?? null,
    advisory: evaluation.ok,
    signals: normalizeSignals(signals),
    gate: evaluation,
    artifacts: artifacts ?? [],
  };
}

/**
 * Shared post-run flow for every runner: load baseline + budgets, evaluate,
 * persist baseline on first run (snapshot mode) or on --update-baseline,
 * and return {evaluation, exitCode, messages}.
 */
export function gateSignals(signals, io, opts = {}) {
  const baselinePath = opts.baselinePath ?? DEFAULT_BASELINE_PATH;
  const budgetsPath = opts.budgetsPath ?? DEFAULT_BUDGETS_PATH;
  const messages = [];

  let budgets = { signals: {} };
  if (io.fileExists(budgetsPath)) {
    budgets = loadBudgets(io.readFile(budgetsPath));
  }

  if (opts.updateBaseline === true) {
    io.writeFile(baselinePath, `${JSON.stringify(toBaseline(signals), null, 2)}\n`);
    messages.push(`profiling gate: baseline updated at ${baselinePath}`);
    return {
      evaluation: evaluateSignals(signals, toBaseline(signals), budgets),
      exitCode: 0,
      messages,
    };
  }

  let baseline = { signals: {} };
  if (io.fileExists(baselinePath)) {
    baseline = JSON.parse(io.readFile(baselinePath));
  } else {
    io.writeFile(baselinePath, `${JSON.stringify(toBaseline(signals), null, 2)}\n`);
    messages.push(
      `profiling gate: baseline created at ${baselinePath} (first run; ` +
        `${Object.keys(normalizeSignals(signals)).length} signal(s) recorded).`,
    );
  }

  const evaluation = evaluateSignals(signals, baseline, budgets);
  return { evaluation, exitCode: evaluation.ok ? 0 : 1, messages };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * CLI: `profile gate [--baseline=path] [--budgets=path] [--update-baseline]`
 * Reads a JSON document on stdin: either a bare signals map or a verdict
 * document with a top-level `signals` key.
 */
export async function main(
  argv = process.argv.slice(2),
  io = { ...makeNodeIo(), read: readStdin },
) {
  let baselinePath = DEFAULT_BASELINE_PATH;
  let budgetsPath = DEFAULT_BUDGETS_PATH;
  let updateBaseline = false;
  for (const a of argv) {
    if (a.startsWith('--baseline=')) {
      baselinePath = a.slice('--baseline='.length);
    } else if (a.startsWith('--budgets=')) {
      budgetsPath = a.slice('--budgets='.length);
    } else if (a === '--update-baseline') {
      updateBaseline = true;
    }
  }

  let raw;
  try {
    raw = await io.read();
  } catch (err) {
    io.writeErr(`profiling gate: failed to read stdin (${err.message})\n`);
    return 2;
  }
  if (raw.trim().length === 0) {
    io.writeErr('profiling gate: empty stdin; pipe a signals JSON document in\n');
    return 2;
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    io.writeErr(`profiling gate: stdin is not valid JSON (${err.message})\n`);
    return 2;
  }
  const signals = doc?.signals ?? doc;

  let outcome;
  try {
    outcome = gateSignals(signals, io, { baselinePath, budgetsPath, updateBaseline });
  } catch (err) {
    io.writeErr(`profiling gate: ${err.message}\n`);
    return 2;
  }
  for (const message of outcome.messages) {
    io.write(`${message}\n`);
  }
  io.write(renderGateReport(outcome.evaluation));
  return outcome.exitCode;
}

/* node:coverage ignore next 3 */
if (isScriptEntry(import.meta.url)) {
  runAsEntry(main);
}
