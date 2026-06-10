// harness/profiling/src/lib.mjs - shared helpers for the profiling slot
// (bead create-harness-app-z41).
//
// Pure functions live here so every runner (startup/api/ui) and the gate
// share one implementation of percentiles, trace-id generation, and the
// artifact-directory naming convention that links a profile run back to
// its OpenTelemetry trace (design: experiments/PROFILING-SLOT-DESIGN.md
// in the lab repo; gap evidence: EXP-11).

import { randomBytes as nodeRandomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/**
 * Nearest-rank percentile over an UNSORTED list of numbers.
 * p is a fraction in (0, 1]; an empty list yields null.
 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index];
}

/** Summary stats for a latency sample, all in the sample's own unit. */
export function summarizeLatencies(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { count: 0, p50: null, p95: null, p99: null, mean: null, min: null, max: null };
  }
  const sum = values.reduce((acc, v) => acc + v, 0);
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    mean: sum / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

/** 16-byte lowercase hex trace id (W3C trace-context shape). */
export function generateTraceId(randomBytes = nodeRandomBytes) {
  return randomBytes(16).toString('hex');
}

/** 8-byte lowercase hex span id (W3C trace-context shape). */
export function generateSpanId(randomBytes = nodeRandomBytes) {
  return randomBytes(8).toString('hex');
}

/**
 * W3C traceparent header value. Sampled flag is always 01 so the
 * receiving OTEL SDK exports the server-side spans for this run.
 */
export function traceparent(traceId, spanId) {
  return `00-${traceId}-${spanId}-01`;
}

/** Compact UTC stamp used in artifact directory names: 20260611T012345Z. */
export function isoKey(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Artifact directory name: `<iso_key>--<trace_id>`. The trace id in the
 * directory name is the span-to-profile correlation path: query
 * VictoriaTraces for the trace id and the matching profile artifacts are
 * the directory that carries it (PROFILING-SLOT-DESIGN.md section 2).
 */
export function artifactDirName(date, traceId) {
  return `${isoKey(date)}--${traceId}`;
}

/** Default IO bundle for runner mains; tests inject a stub instead. */
export function makeNodeIo() {
  return {
    write: (s) => process.stdout.write(s),
    writeErr: (s) => process.stderr.write(s),
    readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, s) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, s);
    },
    fileExists: (p) => existsSync(p),
    listDir: (p) => readdirSync(p),
    statSize: (p) => statSync(p).size,
    isDirectory: (p) => statSync(p).isDirectory(),
    copyFile: (src, dest) => {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    },
    readFileBytes: (p) => readFileSync(p),
    gzipSize: (buf) => gzipSync(buf).length,
    fetch: (...args) => globalThis.fetch(...args),
    now: () => Date.now(),
    nowDate: () => new Date(),
    randomBytes: nodeRandomBytes,
    env: process.env,
  };
}

/**
 * Recursively list files under root whose name matches `pattern`,
 * via the injected io (listDir/isDirectory). Returns full paths.
 */
export function walkFiles(io, root, pattern) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const name of io.listDir(dir)) {
      const full = join(dir, name);
      if (io.isDirectory(full)) {
        stack.push(full);
      } else if (pattern.test(name)) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

/**
 * True when the module at metaUrl is the process entrypoint. Resolves
 * symlinks on both sides, mirroring the fix in harness/perf/gate.mjs
 * (worktree bin/ dispatchers exec real paths, callers may pass links).
 */
export function isScriptEntry(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

/** Run an async main() and adopt its return value as the exit code. */
export function runAsEntry(mainFn) {
  mainFn()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`profile: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(1);
    });
}

/** Parse `--key=value` / bare `--flag` argv into {flags, positional}. */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq === -1) {
        flags[arg.slice(2)] = true;
      } else {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}
