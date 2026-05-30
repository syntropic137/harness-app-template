// harness/perf/gate.mjs — startup-time fitness gate (bead n48.13).
//
// Mirrors harness/sensors/gate.mjs in shape but compares runtime
// performance against a committed baseline rather than coupling metrics.
//
// Reads a hyperfine JSON document on stdin (the output of
// `hyperfine --export-json …`) and compares the mean wall-clock time
// against a persisted baseline.  Fails the gate when the current mean
// is more than (1 + tolerance) × baseline.mean — default tolerance 25%.
// Noise tolerance is configurable per benchmark via the `--tolerance`
// flag; CI environments with high variance can crank it up.
//
// Discipline (mirrors n48.4):
//   - First run: no baseline exists → write current as the baseline and
//     exit 0 with a "baseline created" message.
//   - Subsequent runs: compare. Exit non-zero on any benchmark whose
//     mean exceeded the per-benchmark allowed ceiling.
//   - The baseline is never auto-updated on regression; the only way
//     to change the floor is `gate --update-baseline`, which is a
//     deliberate act recorded in git.
//
// Preservation-first: the bench script (bench.sh) and the baseline
// file (baseline.json) are additive. This gate does not modify the
// sensors slot, the cruiser/ts-morph adapters, or any pre-existing
// pre-push hook.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TOLERANCE = 0.25;

/**
 * Extract the comparable baseline shape from a hyperfine results
 * document.  Keys benchmarks by their `command` string so multiple
 * bench commands (e.g. cold-start vs warm-start) can coexist.
 */
export function extractBaselineMetrics(hyperfine) {
  const out = {};
  for (const r of hyperfine?.results ?? []) {
    if (typeof r?.command !== 'string' || r.command.length === 0) {
      continue;
    }
    out[r.command] = {
      mean: typeof r.mean === 'number' ? r.mean : null,
      stddev: typeof r.stddev === 'number' ? r.stddev : null,
      median: typeof r.median === 'number' ? r.median : null,
    };
  }
  return { benchmarks: out };
}

/**
 * Compare current hyperfine results against a baseline shape.  For each
 * baseline benchmark whose `mean` is numeric and present in the current
 * run: a regression is when `current.mean > baseline.mean * (1 + tolerance)`.
 *
 * New benchmarks (absent from baseline) are NOT regressions — they're new
 * targets that haven't been measured against a floor yet.  Removed
 * benchmarks (in baseline, absent in current) are also not regressions;
 * they were renamed or retired.
 */
export function compareBaseline(baseline, current, tolerance = DEFAULT_TOLERANCE) {
  const cur = extractBaselineMetrics(current);
  const regressions = [];
  const baseB = baseline?.benchmarks ?? {};
  const curB = cur.benchmarks;
  let comparedBenchmarks = 0;
  for (const [name, base] of Object.entries(baseB)) {
    const c = curB[name];
    if (!c) {
      continue;
    }
    comparedBenchmarks += 1;
    if (typeof base.mean !== 'number' || typeof c.mean !== 'number') {
      continue;
    }
    const ceiling = base.mean * (1 + tolerance);
    if (c.mean > ceiling) {
      regressions.push({
        benchmark: name,
        metric: 'mean',
        baseline: base.mean,
        current: c.mean,
        ceiling,
        toleranceUsed: tolerance,
        delta: c.mean - base.mean,
        deltaPct: (c.mean - base.mean) / base.mean,
      });
    }
  }
  const newBenchmarks = Object.keys(curB).filter((n) => !(n in baseB));
  const removedBenchmarks = Object.keys(baseB).filter((n) => !(n in curB));
  return {
    ok: regressions.length === 0,
    regressions,
    summary: { comparedBenchmarks, newBenchmarks, removedBenchmarks, tolerance },
  };
}

function fmtSec(n) {
  if (n === null || n === undefined) {
    return '—';
  }
  return `${n.toFixed(3)}s`;
}

function fmtPct(n) {
  if (n === null || n === undefined) {
    return '—';
  }
  return `${(n * 100).toFixed(1)}%`;
}

/** Render a human-readable diff for the operator. */
export function renderReport(comparison) {
  const lines = [];
  lines.push(comparison.ok ? 'perf gate: PASS' : 'perf gate: FAIL');
  const { comparedBenchmarks, newBenchmarks, removedBenchmarks, tolerance } = comparison.summary;
  lines.push(
    `compared ${comparedBenchmarks} benchmark(s) at tolerance ${fmtPct(tolerance)}; ` +
      `${newBenchmarks.length} new, ${removedBenchmarks.length} removed.`,
  );
  if (newBenchmarks.length > 0) {
    lines.push(`  new: ${newBenchmarks.join(', ')}`);
  }
  if (removedBenchmarks.length > 0) {
    lines.push(`  removed: ${removedBenchmarks.join(', ')}`);
  }
  if (comparison.regressions.length > 0) {
    lines.push('');
    lines.push('regressions:');
    for (const r of comparison.regressions) {
      lines.push(
        `  ${r.benchmark}  mean: ${fmtSec(r.baseline)} → ${fmtSec(r.current)}  ` +
          `(+${fmtPct(r.deltaPct)})  ceiling=${fmtSec(r.ceiling)}`,
      );
    }
    lines.push('');
    lines.push(
      'If the regression is intentional, update the baseline deliberately: ' +
        '`just perf gate --update-baseline` and commit the resulting ' +
        'harness/perf/baseline.json as part of the same change.',
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
  let baselinePath = 'harness/perf/baseline.json';
  let tolerance = DEFAULT_TOLERANCE;
  let updateBaseline = false;
  let firstRunMode = 'snapshot';
  for (const a of argv) {
    if (a.startsWith('--baseline=')) {
      baselinePath = a.slice('--baseline='.length);
    } else if (a === '--update-baseline') {
      updateBaseline = true;
    } else if (a.startsWith('--tolerance=')) {
      const parsed = Number.parseFloat(a.slice('--tolerance='.length));
      if (Number.isFinite(parsed) && parsed >= 0) {
        tolerance = parsed;
      }
    } else if (a.startsWith('--first-run-mode=')) {
      firstRunMode = a.slice('--first-run-mode='.length);
    }
  }

  let raw;
  try {
    raw = await io.read();
  } catch (err) {
    io.writeErr(`perf gate: failed to read stdin (${err.message})\n`);
    return 2;
  }
  if (raw.trim().length === 0) {
    io.writeErr('perf gate: empty stdin — pipe hyperfine JSON in\n');
    return 2;
  }
  let current;
  try {
    current = JSON.parse(raw);
  } catch (err) {
    io.writeErr(`perf gate: stdin is not valid JSON (${err.message})\n`);
    return 2;
  }

  const newBaseline = extractBaselineMetrics(current);

  if (updateBaseline) {
    io.writeFile(baselinePath, `${JSON.stringify(newBaseline, null, 2)}\n`);
    io.write(`perf gate: baseline updated at ${baselinePath}\n`);
    return 0;
  }

  if (!io.fileExists(baselinePath)) {
    if (firstRunMode === 'strict') {
      io.writeErr(
        `perf gate: no baseline at ${baselinePath} and --first-run-mode=strict; ` +
          'run with --update-baseline once to create it.\n',
      );
      return 2;
    }
    io.writeFile(baselinePath, `${JSON.stringify(newBaseline, null, 2)}\n`);
    io.write(
      `perf gate: baseline created at ${baselinePath} (first run; ` +
        `${Object.keys(newBaseline.benchmarks).length} benchmark(s) recorded).\n`,
    );
    return 0;
  }

  let baseline;
  try {
    baseline = JSON.parse(io.readFile(baselinePath));
  } catch (err) {
    io.writeErr(`perf gate: failed to read baseline at ${baselinePath} (${err.message})\n`);
    return 2;
  }

  const comparison = compareBaseline(baseline, current, tolerance);
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
      process.stderr.write(`perf gate: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(1);
    });
}
