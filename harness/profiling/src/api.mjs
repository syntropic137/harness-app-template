// harness/profiling/src/api.mjs - backend API profile runner
// (bead create-harness-app-z41).
//
// Closes the EXP-11 backend gap: API latency p50/p95/p99 + throughput,
// regression detection through the shared gate, and a flamegraph/pprof
// path via Node `--cpu-prof` artifact collection.
//
// OpenTelemetry linkage (PROFILING-SLOT-DESIGN.md section 2): the runner
// mints one W3C trace id for the whole run and sends a `traceparent`
// header on every request, so the server-side OTEL HTTP instrumentation
// parents its spans under this run. The trace id is embedded in the
// artifact directory name (`<iso_key>--<trace_id>`), which is how a trace
// in VictoriaTraces becomes a profile on disk and vice versa.
//
// Flamegraph path: start the target with `node --cpu-prof
// --cpu-prof-dir=<dir>` (or `cargo flamegraph` / `py-spy record` for the
// other lanes), pass the same dir as --cpu-prof-dir, and the runner copies
// every *.cpuprofile produced during the run into the artifact directory.
// Open them in speedscope or Chrome DevTools Performance for the flame
// view. Optionally `--vm-url` snapshots `http.server.duration` quantiles
// from VictoriaMetrics next to the locally measured ones.

import { join } from 'node:path';
import { buildVerdict, gateSignals, renderGateReport } from './gate.mjs';
import {
  artifactDirName,
  generateSpanId,
  generateTraceId,
  isScriptEntry,
  makeNodeIo,
  parseArgs,
  runAsEntry,
  summarizeLatencies,
  traceparent,
  walkFiles,
} from './lib.mjs';

export const DEFAULT_ARTIFACT_ROOT = '.harness/artifacts/profile';
const DEFAULT_REQUESTS = 50;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_WARMUP = 5;
export const DEFAULT_VM_METRIC = 'http_server_duration_milliseconds_bucket';

function positiveInt(raw, fallback) {
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Fire `requests` GET requests at `url` with bounded concurrency, sending
 * a per-request traceparent under one run-level trace id. Returns wall
 * latencies (ms) for successful requests plus error count and span ids.
 */
export async function runLoad(io, url, { requests, concurrency, traceId }) {
  const latencies = [];
  const spanIds = [];
  let errors = 0;
  let next = 0;
  async function worker() {
    while (next < requests) {
      next += 1;
      const spanId = generateSpanId(io.randomBytes);
      spanIds.push(spanId);
      const started = io.now();
      try {
        const response = await io.fetch(url, {
          headers: { traceparent: traceparent(traceId, spanId) },
        });
        if (response.ok) {
          latencies.push(io.now() - started);
        } else {
          errors += 1;
        }
      } catch {
        errors += 1;
      }
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, requests); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return { latencies, errors, spanIds };
}

/** Best-effort VictoriaMetrics quantile snapshot; null when unreachable. */
export async function queryVmQuantiles(io, vmUrl, metric) {
  const quantiles = {};
  for (const q of [0.5, 0.95, 0.99]) {
    const query = `histogram_quantile(${q}, sum(rate(${metric}[5m])) by (le))`;
    const target = `${vmUrl.replace(/\/$/, '')}/api/v1/query?query=${encodeURIComponent(query)}`;
    try {
      const response = await io.fetch(target);
      quantiles[`p${q * 100}`] = response.ok ? await response.json() : { error: response.status };
    } catch (err) {
      return { error: String(err?.message ?? err) };
    }
  }
  return quantiles;
}

/** Copy *.cpuprofile artifacts captured during the run into `dir`. */
export function collectCpuProfiles(io, cpuProfDir, dir) {
  if (!io.fileExists(cpuProfDir)) {
    return [];
  }
  const copied = [];
  for (const profile of walkFiles(io, cpuProfDir, /\.cpuprofile$/)) {
    const name = profile.split('/').pop();
    io.copyFile(profile, join(dir, name));
    copied.push(name);
  }
  return copied;
}

export async function main(argv = process.argv.slice(2), io = makeNodeIo()) {
  const { flags, positional } = parseArgs(argv);
  const url = typeof flags.url === 'string' ? flags.url : positional[0];
  if (typeof url !== 'string' || url.length === 0) {
    io.writeErr(
      'usage: profile api --url=<http endpoint> [--requests=N] [--concurrency=N] ' +
        '[--warmup=N] [--cpu-prof-dir=DIR] [--vm-url=URL] [--vm-metric=NAME] ' +
        '[--baseline=PATH] [--budgets=PATH] [--update-baseline]\n',
    );
    return 64;
  }
  const requests = positiveInt(flags.requests, DEFAULT_REQUESTS);
  const concurrency = positiveInt(flags.concurrency, DEFAULT_CONCURRENCY);
  const warmup = flags.warmup === undefined ? DEFAULT_WARMUP : positiveInt(flags.warmup, 0);
  const artifactRoot =
    typeof flags['artifact-root'] === 'string' ? flags['artifact-root'] : DEFAULT_ARTIFACT_ROOT;

  const traceId = generateTraceId(io.randomBytes);
  const capturedAt = io.nowDate();
  const startedMs = io.now();

  if (warmup > 0) {
    await runLoad(io, url, { requests: warmup, concurrency, traceId });
  }
  const { latencies, errors, spanIds } = await runLoad(io, url, { requests, concurrency, traceId });
  const elapsedMs = io.now() - startedMs;
  if (latencies.length === 0) {
    io.writeErr(`profile api: all ${requests} request(s) to ${url} failed\n`);
    return 2;
  }

  const stats = summarizeLatencies(latencies);
  const signals = {
    'api.latency.p50': { value: stats.p50, unit: 'ms' },
    'api.latency.p95': { value: stats.p95, unit: 'ms' },
    'api.latency.p99': { value: stats.p99, unit: 'ms' },
    'api.latency.mean': { value: stats.mean, unit: 'ms' },
    'api.throughput.rps': {
      value: (latencies.length / Math.max(elapsedMs, 1)) * 1000,
      unit: 'rps',
    },
    'api.errors.count': { value: errors, unit: 'requests' },
  };

  let outcome;
  try {
    outcome = gateSignals(signals, io, {
      baselinePath: typeof flags.baseline === 'string' ? flags.baseline : undefined,
      budgetsPath: typeof flags.budgets === 'string' ? flags.budgets : undefined,
      updateBaseline: flags['update-baseline'] === true,
    });
  } catch (err) {
    io.writeErr(`profile api: ${err.message}\n`);
    return 2;
  }

  const dir = join(artifactRoot, artifactDirName(capturedAt, traceId));
  const artifacts = ['latency-summary.json', 'trace-correlation.json', 'verdict.json'];

  io.writeFile(
    join(dir, 'latency-summary.json'),
    `${JSON.stringify({ url, requests, concurrency, warmup, errors, elapsedMs, stats }, null, 2)}\n`,
  );
  io.writeFile(
    join(dir, 'trace-correlation.json'),
    `${JSON.stringify(
      {
        traceId,
        spanIdSample: spanIds.slice(0, 10),
        note:
          'Every request carried traceparent 00-<traceId>-<spanId>-01; query ' +
          'VictoriaTraces for traceId to pivot from this profile to the server spans.',
      },
      null,
      2,
    )}\n`,
  );

  if (typeof flags['vm-url'] === 'string') {
    const metric = typeof flags['vm-metric'] === 'string' ? flags['vm-metric'] : DEFAULT_VM_METRIC;
    const vm = await queryVmQuantiles(io, flags['vm-url'], metric);
    io.writeFile(
      join(dir, 'vm-quantiles.json'),
      `${JSON.stringify({ metric, quantiles: vm }, null, 2)}\n`,
    );
    artifacts.push('vm-quantiles.json');
  }

  if (typeof flags['cpu-prof-dir'] === 'string') {
    const copied = collectCpuProfiles(io, flags['cpu-prof-dir'], dir);
    artifacts.push(...copied);
    if (copied.length === 0) {
      io.write(
        `profile api: no *.cpuprofile found under ${flags['cpu-prof-dir']}; ` +
          'start the target with `node --cpu-prof --cpu-prof-dir=<dir>` to capture a flame profile\n',
      );
    }
  }

  const verdict = buildVerdict({
    mode: 'api',
    capturedAt: capturedAt.toISOString(),
    traceId,
    signals,
    evaluation: outcome.evaluation,
    artifacts,
  });
  io.writeFile(join(dir, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);

  for (const message of outcome.messages) {
    io.write(`${message}\n`);
  }
  io.write(renderGateReport(outcome.evaluation));
  io.write(`profile api: artifacts at ${dir}\n`);
  return outcome.exitCode;
}

/* node:coverage ignore next 3 */
if (isScriptEntry(import.meta.url)) {
  runAsEntry(main);
}
