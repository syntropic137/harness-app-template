// harness/profiling/src/startup.mjs - startup-time profile runner
// (bead create-harness-app-z41).
//
// Re-exposes the existing hyperfine bench (harness/perf/bench.sh, EXP-11
// confirmed it exists but was not on the justfile front door) through the
// profiling slot: runs the bench, converts the hyperfine document into
// `startup.<command>.mean` signals, evaluates them through the shared
// generalized gate, and persists a verdict artifact directory.
//
// harness/perf/bench.sh and harness/perf/gate.mjs stay untouched; this is
// the additive migration path from PROFILING-SLOT-DESIGN.md section 5.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildVerdict, gateSignals, renderGateReport } from './gate.mjs';
import {
  artifactDirName,
  generateTraceId,
  isScriptEntry,
  makeNodeIo,
  parseArgs,
  runAsEntry,
} from './lib.mjs';

export const DEFAULT_BENCH_PATH = 'harness/perf/bench.sh';
export const DEFAULT_ARTIFACT_ROOT = '.harness/artifacts/profile';

/** Convert a hyperfine export-json document into profiling signals. */
export function hyperfineToSignals(hyperfine) {
  const signals = {};
  for (const r of hyperfine?.results ?? []) {
    if (typeof r?.command !== 'string' || r.command.length === 0 || typeof r.mean !== 'number') {
      continue;
    }
    signals[`startup.${r.command}.mean`] = { value: r.mean, unit: 's' };
  }
  return signals;
}

function defaultRunBench(benchPath) {
  const result = spawnSync('bash', [benchPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return { status: result.status, stdout: result.stdout ?? '' };
}

export async function main(
  argv = process.argv.slice(2),
  io = { ...makeNodeIo(), runBench: defaultRunBench },
) {
  const { flags } = parseArgs(argv);
  const benchPath = typeof flags.bench === 'string' ? flags.bench : DEFAULT_BENCH_PATH;
  const artifactRoot =
    typeof flags['artifact-root'] === 'string' ? flags['artifact-root'] : DEFAULT_ARTIFACT_ROOT;

  const bench = io.runBench(benchPath);
  if (bench.status !== 0) {
    io.writeErr(`profile startup: bench ${benchPath} exited ${bench.status}\n`);
    return 2;
  }
  let hyperfine;
  try {
    hyperfine = JSON.parse(bench.stdout);
  } catch (err) {
    io.writeErr(`profile startup: bench output is not valid JSON (${err.message})\n`);
    return 2;
  }
  if (hyperfine?.available === false) {
    io.write(`profile startup: skipped (${hyperfine.reason ?? 'bench unavailable'})\n`);
    return 0;
  }

  const signals = hyperfineToSignals(hyperfine);
  if (Object.keys(signals).length === 0) {
    io.writeErr('profile startup: bench produced no usable benchmarks\n');
    return 2;
  }

  let outcome;
  try {
    outcome = gateSignals(signals, io, {
      baselinePath: typeof flags.baseline === 'string' ? flags.baseline : undefined,
      budgetsPath: typeof flags.budgets === 'string' ? flags.budgets : undefined,
      updateBaseline: flags['update-baseline'] === true,
    });
  } catch (err) {
    io.writeErr(`profile startup: ${err.message}\n`);
    return 2;
  }

  const capturedAt = io.nowDate();
  const traceId = generateTraceId(io.randomBytes);
  const dir = join(artifactRoot, artifactDirName(capturedAt, traceId));
  const verdict = buildVerdict({
    mode: 'startup',
    capturedAt: capturedAt.toISOString(),
    traceId,
    signals,
    evaluation: outcome.evaluation,
    artifacts: ['hyperfine.json', 'verdict.json'],
  });
  io.writeFile(join(dir, 'hyperfine.json'), `${JSON.stringify(hyperfine, null, 2)}\n`);
  io.writeFile(join(dir, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);

  for (const message of outcome.messages) {
    io.write(`${message}\n`);
  }
  io.write(renderGateReport(outcome.evaluation));
  io.write(`profile startup: artifacts at ${dir}\n`);
  return outcome.exitCode;
}

/* node:coverage ignore next 3 */
if (isScriptEntry(import.meta.url)) {
  runAsEntry(main);
}
