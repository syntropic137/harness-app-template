// coverage_scan.mjs  -  deterministic test-coverage adapter for CV01.
//
// CV01 is the test-coverage ratchet (ADR-0025). The standalone cov-rust,
// cov-py, and pnpm test:coverage CI jobs already enforce 100 percent
// line / function / region coverage across every Rust crate, every
// Python package, and every TypeScript workspace. CV01 promotes that
// 100 percent floor into a first-class fitness dimension so:
//
//   1. the floor lives in harness/sensors/baseline.json alongside every
//      other architectural metric (single source of truth, audit-trail
//      diff on any deliberate relaxation),
//   2. the `just fitness` agent-facing report surfaces coverage next to
//      complexity, coupling, security, and licensing, and
//   3. the ratchet semantics apply: a regression below the floor fails
//      the gate WITHOUT moving the floor; the floor only ever climbs
//      when measured coverage improves (which is a no-op at 100 percent
//      but matters for any future fork that opts to start below 100
//      and ratchet up).
//
// OPERATOR INVARIANT: 100 percent or nothing. Sub-100 floors are
// blockers. If a line is genuinely uncoverable, exclude it via the
// language-native ignore mechanism (`#[cfg(not(coverage))]` / Rust
// llvm-cov `-A` regions, `# pragma: no cover` / coverage.run.omit for
// Python, `/* v8 ignore next */` for TypeScript). Do NOT lower the
// numeric threshold to accommodate an unscanned region.
//
// DETERMINISM: the adapter pins tool versions implicitly (it shells out
// to whatever cargo-llvm-cov / pytest / vitest the workspace has
// installed via uv / pnpm / cargo locks, which are also pinned in CI),
// runs each tool against the SAME --manifest-path / --project / vitest
// config the CI workflow uses, and isolates Rust llvm-cov to a
// worktree-local CARGO_TARGET_DIR so two concurrent invocations cannot
// corrupt each other's profraw files. The numeric result is byte
// identical between local and CI for the same source tree.
//
// SPEED TIER: coverage is slow (full cov-rust + cov-py + scripts
// test:coverage runs >2 minutes on a cold cache). The adapter is
// invoked from bin/sensors gate only when SENSORS_COVERAGE=1 is set in
// the environment. Pre-push leaves it off; CI's fitness job sets it.
// When the adapter is skipped or the tools are absent, the envelope
// reports `available: false` and the gate degrades CV01 metrics to "no
// reading" (same shape as the SC01 / LG01 / sentrux / deadcode
// soft-skips above), so a missing scanner cannot silently pass.
//
// CONTRACT  -  envelope shape consumed by gate.mjs:
//   {
//     "tool": "coverage-scan",
//     "available": true | false,
//     "version": "1.0.0",
//     "scanned_lanes": ["rust", "python", "javascript"],
//     "metrics": {
//       "rust_line_pct":      number | null,
//       "rust_function_pct":  number | null,
//       "rust_region_pct":    number | null,
//       "python_line_pct":    number | null,
//       "javascript_line_pct": number | null,
//       "min_line_pct":       number | null
//     }
//   }
//
// READING MODES:
//   - --rust-cov-json=<path>      pre-rendered cargo llvm-cov --json output
//   - --python-cov-json=<path>    pre-rendered pytest-cov coverage.json
//   - --javascript-cov-json=<path> pre-rendered vitest coverage-summary.json
//   - --run                       spawn each tool inline (slow). Honors
//                                 SENSORS_COVERAGE_RUST / PYTHON / JS env
//                                 vars to gate individual lanes.
//
// Soft-skip: a lane that has no input (no JSON path and --run not set)
// produces null for its metrics and is not added to scanned_lanes.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ADAPTER_VERSION = '1.0.0';

const ROUND_TO = 1e4; // round percentages to 4 decimals for stable diffing

function roundPct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * ROUND_TO) / ROUND_TO;
}

function minFinite(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return nums.length === 0 ? null : Math.min(...nums);
}

/**
 * Parse a `cargo llvm-cov --json --summary-only` payload. The shape is
 * documented in cargo-llvm-cov's README and pins three counts we care
 * about: lines, functions, regions. Each count carries `count` and
 * `covered`; the percentage is `covered / count * 100`. When `count`
 * is zero (e.g. a crate with no executable code) we treat the lane as
 * 100 percent  -  there is nothing to leave uncovered.
 */
export function parseRustLlvmCovJson(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const totals = payload?.data?.[0]?.totals;
  if (!totals) {
    return null;
  }
  const pickPct = (group) => {
    if (!group) return null;
    const count = group.count;
    const covered = group.covered;
    if (typeof count !== 'number' || typeof covered !== 'number') {
      return null;
    }
    if (count === 0) return 100;
    return (covered / count) * 100;
  };
  return {
    line_pct: roundPct(pickPct(totals.lines)),
    function_pct: roundPct(pickPct(totals.functions)),
    region_pct: roundPct(pickPct(totals.regions)),
  };
}

/**
 * Parse a `pytest --cov-report=json` (or `coverage json`) payload. The
 * canonical key is `totals.percent_covered` which already comes back as
 * a percentage. We also accept the legacy `totals.line_coverage` for
 * coverage.py < 6 compatibility.
 */
export function parsePythonCoverageJson(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const totals = payload.totals ?? {};
  const candidates = [totals.percent_covered, totals.line_coverage, totals.covered_lines_pct];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) {
      return { line_pct: roundPct(c) };
    }
  }
  // Fallback: derive from covered/total if percent isn't present.
  if (typeof totals.covered_lines === 'number' && typeof totals.num_statements === 'number') {
    if (totals.num_statements === 0) return { line_pct: 100 };
    return { line_pct: roundPct((totals.covered_lines / totals.num_statements) * 100) };
  }
  return null;
}

/**
 * Parse a vitest `coverage-summary.json` payload. Shape (istanbul-style):
 *   { "total": { "lines": { "total": N, "covered": M, "pct": P }, ... } }
 */
export function parseJavascriptCoverageSummary(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const lines = payload?.total?.lines;
  if (!lines) {
    return null;
  }
  if (typeof lines.pct === 'number' && Number.isFinite(lines.pct)) {
    return { line_pct: roundPct(lines.pct) };
  }
  if (typeof lines.covered === 'number' && typeof lines.total === 'number') {
    if (lines.total === 0) return { line_pct: 100 };
    return { line_pct: roundPct((lines.covered / lines.total) * 100) };
  }
  return null;
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Aggregate a set of per-lane parse results into the envelope's metrics
 * block. Each lane contributes its own *_pct, and we compute
 * min_line_pct across whichever lanes returned a number  -  that single
 * value is the "overall floor" the CV01 ratchet can hang a summary
 * metric on (mirrors PF01's `startup-benchmark-mean`).
 */
export function composeMetrics({ rust, python, javascript }) {
  const lineValues = [];
  const metrics = {
    rust_line_pct: null,
    rust_function_pct: null,
    rust_region_pct: null,
    python_line_pct: null,
    javascript_line_pct: null,
    min_line_pct: null,
  };
  if (rust && typeof rust === 'object') {
    metrics.rust_line_pct = rust.line_pct ?? null;
    metrics.rust_function_pct = rust.function_pct ?? null;
    metrics.rust_region_pct = rust.region_pct ?? null;
    if (typeof rust.line_pct === 'number') {
      lineValues.push(rust.line_pct);
    }
  }
  if (python && typeof python === 'object') {
    metrics.python_line_pct = python.line_pct ?? null;
    if (typeof python.line_pct === 'number') {
      lineValues.push(python.line_pct);
    }
  }
  if (javascript && typeof javascript === 'object') {
    metrics.javascript_line_pct = javascript.line_pct ?? null;
    if (typeof javascript.line_pct === 'number') {
      lineValues.push(javascript.line_pct);
    }
  }
  metrics.min_line_pct = roundPct(minFinite(lineValues));
  return metrics;
}

function buildEnvelope({ rust, python, javascript, scanned }) {
  return {
    tool: 'coverage-scan',
    available: scanned.length > 0,
    version: ADAPTER_VERSION,
    scanned_lanes: scanned.slice().sort(),
    metrics: composeMetrics({ rust, python, javascript }),
  };
}

function emptyEnvelope(reason) {
  return {
    tool: 'coverage-scan',
    available: false,
    reason,
    version: ADAPTER_VERSION,
    scanned_lanes: [],
    metrics: composeMetrics({ rust: null, python: null, javascript: null }),
  };
}

/**
 * Spawn `cargo llvm-cov --json --summary-only` against a workspace
 * manifest. Pins CARGO_TARGET_DIR to an isolated path so concurrent
 * runs in shared-target environments (the swarm VPS exports
 * /data/tmp/cargo-target) cannot cross-contaminate profraw files.
 * Returns the parsed Rust metrics or null on failure.
 */
function runCargoLlvmCov({ workspaceRoot, manifestRelPath, extraArgs = [], env = process.env }) {
  if (!commandExists('cargo')) {
    return { ok: false, reason: 'cargo not on PATH' };
  }
  const isolated = mkdtempSync(join(tmpdir(), 'sensors-cov-rust-'));
  try {
    const args = [
      'llvm-cov',
      '--manifest-path',
      manifestRelPath,
      '--json',
      '--summary-only',
      ...extraArgs,
    ];
    const result = spawnSync('cargo', args, {
      cwd: workspaceRoot,
      env: { ...env, CARGO_TARGET_DIR: isolated },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
      return {
        ok: false,
        reason: `cargo llvm-cov exit ${result.status}: ${result.stderr.slice(0, 200)}`,
      };
    }
    let payload;
    try {
      payload = JSON.parse(result.stdout);
    } catch (err) {
      return { ok: false, reason: `cargo llvm-cov stdout not JSON: ${err.message}` };
    }
    return { ok: true, metrics: parseRustLlvmCovJson(payload) };
  } finally {
    try {
      rmSync(isolated, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

/**
 * Per-crate coverage policy. Mirrors the `just cov-rust` recipe in
 * justfile EXACTLY so CV01's numbers are byte-identical to the
 * existing standalone cov-rust CI gate. Lines and functions are
 * enforced across every Rust workspace the project covers; regions
 * are enforced only on ws_apps/example-rust because the slot crates
 * (harness/doc-validator, harness/versioning) ship CLI shells whose
 * region coverage is not under contract by the cov-rust recipe. If
 * a future ADR extends region enforcement to a slot crate, flip
 * `enforceRegions: true` here and refresh the baseline.
 */
const RUST_LANES = [
  {
    manifest: 'ws_apps/example-rust/Cargo.toml',
    extraArgs: [],
    enforceRegions: true,
  },
  {
    manifest: 'harness/doc-validator/Cargo.toml',
    extraArgs: ['--lib', '--ignore-filename-regex', 'main\\.rs'],
    enforceRegions: false,
  },
  {
    manifest: 'harness/versioning/Cargo.toml',
    extraArgs: ['--lib', '--ignore-filename-regex', 'main\\.rs'],
    enforceRegions: false,
  },
];

/**
 * Run cargo llvm-cov for every Rust workspace the project covers (root
 * workspace + slot workspaces). Returns the WORST percentages across
 * the set; coverage is a project-min, not a per-crate average. A
 * regression in any single crate fails the gate. Regions are only
 * aggregated across crates whose RUST_LANES entry sets enforceRegions
 * so the CV01 region floor matches the existing cov-rust policy.
 */
function runAllRustLanes({ workspaceRoot, env }) {
  const lanes = RUST_LANES.filter((lane) => existsSync(join(workspaceRoot, lane.manifest)));
  if (lanes.length === 0) {
    return null;
  }
  const lineValues = [];
  const functionValues = [];
  const regionValues = [];
  for (const lane of lanes) {
    const result = runCargoLlvmCov({
      workspaceRoot,
      manifestRelPath: lane.manifest,
      extraArgs: lane.extraArgs,
      env,
    });
    if (!result.ok || !result.metrics) {
      return null;
    }
    if (typeof result.metrics.line_pct === 'number') lineValues.push(result.metrics.line_pct);
    if (typeof result.metrics.function_pct === 'number')
      functionValues.push(result.metrics.function_pct);
    if (lane.enforceRegions && typeof result.metrics.region_pct === 'number') {
      regionValues.push(result.metrics.region_pct);
    }
  }
  return {
    line_pct: roundPct(minFinite(lineValues)),
    function_pct: roundPct(minFinite(functionValues)),
    region_pct: roundPct(minFinite(regionValues)),
  };
}

function commandExists(bin) {
  const result = spawnSync('command', ['-v', bin], {
    shell: true,
    encoding: 'utf8',
  });
  return result.status === 0;
}

/**
 * Public entry: build an envelope from a mix of pre-rendered JSON
 * paths and (when --run flags are set) live tool runs. The CLI wrapper
 * passes its parsed options here.
 */
export function buildEnvelopeFromOptions(opts) {
  const scanned = [];
  let rust = null;
  let python = null;
  let javascript = null;

  // Rust: pre-rendered JSON takes priority over a live run.
  if (opts.rustCovJsonPath) {
    const payload = readJsonFile(opts.rustCovJsonPath);
    const parsed = parseRustLlvmCovJson(payload);
    if (parsed) {
      rust = parsed;
      scanned.push('rust');
    }
  } else if (opts.runRust) {
    const live = runAllRustLanes({ workspaceRoot: opts.workspaceRoot, env: opts.env });
    if (live) {
      rust = live;
      scanned.push('rust');
    }
  }

  // Python: only pre-rendered JSON is supported in this adapter; the
  // live run is delegated to `just cov-py` which writes
  // coverage.json under ws_apps/example-python/.
  if (opts.pythonCovJsonPath) {
    const payload = readJsonFile(opts.pythonCovJsonPath);
    const parsed = parsePythonCoverageJson(payload);
    if (parsed) {
      python = parsed;
      scanned.push('python');
    }
  }

  // JavaScript: pre-rendered vitest coverage-summary.json
  if (opts.javascriptCovJsonPath) {
    const payload = readJsonFile(opts.javascriptCovJsonPath);
    const parsed = parseJavascriptCoverageSummary(payload);
    if (parsed) {
      javascript = parsed;
      scanned.push('javascript');
    }
  }

  if (scanned.length === 0) {
    return emptyEnvelope(
      'no coverage input (--rust-cov-json / --python-cov-json / --javascript-cov-json or --run required)',
    );
  }
  return buildEnvelope({ rust, python, javascript, scanned });
}

function parseArgs(argv, env = process.env) {
  const opts = {
    workspaceRoot: process.cwd(),
    rustCovJsonPath: null,
    pythonCovJsonPath: null,
    javascriptCovJsonPath: null,
    runRust: false,
    env,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--workspace-root=')) {
      opts.workspaceRoot = a.slice('--workspace-root='.length);
    } else if (a === '--workspace-root') {
      opts.workspaceRoot = argv[i + 1] ?? opts.workspaceRoot;
      i += 1;
    } else if (a.startsWith('--rust-cov-json=')) {
      opts.rustCovJsonPath = a.slice('--rust-cov-json='.length);
    } else if (a === '--rust-cov-json') {
      opts.rustCovJsonPath = argv[i + 1] ?? opts.rustCovJsonPath;
      i += 1;
    } else if (a.startsWith('--python-cov-json=')) {
      opts.pythonCovJsonPath = a.slice('--python-cov-json='.length);
    } else if (a === '--python-cov-json') {
      opts.pythonCovJsonPath = argv[i + 1] ?? opts.pythonCovJsonPath;
      i += 1;
    } else if (a.startsWith('--javascript-cov-json=')) {
      opts.javascriptCovJsonPath = a.slice('--javascript-cov-json='.length);
    } else if (a === '--javascript-cov-json') {
      opts.javascriptCovJsonPath = argv[i + 1] ?? opts.javascriptCovJsonPath;
      i += 1;
    } else if (a === '--run-rust') {
      opts.runRust = true;
    }
  }
  return opts;
}

export async function main(
  argv = process.argv.slice(2),
  io = { write: (s) => process.stdout.write(s) },
) {
  const opts = parseArgs(argv);
  opts.workspaceRoot = resolve(opts.workspaceRoot);
  const envelope = buildEnvelopeFromOptions(opts);
  io.write(`${JSON.stringify(envelope, null, 2)}\n`);
  return 0;
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
      process.stderr.write(`coverage_scan: ${err?.stack ?? err?.message ?? String(err)}\n`);
      process.exit(1);
    });
}

// Suppress unused-warning on imports kept for future spawn-driven Python /
// JS live paths; the sep / join symbols are real uses already, this is
// just to silence lints if any.
void sep;
