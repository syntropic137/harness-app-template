---
name: "Test Coverage Ratchet"
description: "Promote the existing 100 percent line/function/region test-coverage gates (cov-rust, cov-py, pnpm test:coverage) into a first-class CV01 fitness dimension so the floor lives in baseline.json next to every other architectural metric, surfaces in the just fitness report, and fails the sensors gate on regression without moving the floor."
status: accepted
---

# ADR-0025: Test Coverage Ratchet

**Date:** 2026-06-10
**Category:** Slot (sensors)
**Supersedes:** none (extends [ADR-0013](./ADR-0013-coverage-enforcement.md), [ADR-0019](./ADR-0019-closed-loop-architectural-quality.md), and [ADR-0020](./ADR-0020-architectural-fitness-ratchet.md) with a new dimension reading)
**Next review:** 2026-12-10

## Context

The repo already enforces 100 percent line, function, and region
coverage on every Rust crate (`just cov-rust` via cargo-llvm-cov),
every uv-managed Python package (`just cov-py` via
`pytest --cov-fail-under=100`), and every TypeScript workspace
(`pnpm test:coverage` via vitest with
`thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 }`).
Those checks fail the corresponding CI lane the moment any number
drops below 100, and they have caught many regressions.

What they do NOT do:

1. Live in `harness/sensors/baseline.json`. Coverage was the only
   slot-wide invariant whose floor was implicit in tool flags rather
   than in the central baseline file. Every other architectural
   metric (complexity, coupling, cycles, security, licensing,
   performance) has a committed floor that the ratchet enforces.
2. Surface in the agent-facing `just fitness` report. Coding agents
   reading the report could see headroom on MT01 / MD01 / etc. but
   no signal at all on test coverage. A regression there would only
   appear when CI ran the standalone coverage lane.
3. Audit-trail relaxations. Lowering a `--cov-fail-under` flag from
   100 to 99 was a one-line edit in `justfile` or `pyproject.toml`
   with no central history. A lowered floor on baseline.json is a
   reviewable audit-trail diff.

CV01 fixes all three by treating coverage as a ratcheting fitness
dimension on the same contract every other dimension follows.

## Decision

Add a new fitness dimension **CV01 (Test Coverage)** to
`harness/sensors/gate.mjs`, with the following shape:

```
CV01 = {
  enforcement: 'enforced',
  promotion_status: 'active',
  default: 'default-enabled',
  metrics: {
    rust-line-coverage-pct      (direction=min, floor=100),
    rust-function-coverage-pct  (direction=min, floor=100),
    rust-region-coverage-pct    (direction=min, floor=100),
    python-line-coverage-pct    (direction=min, floor=100),
    javascript-line-coverage-pct (direction=min, floor=100),
    min-line-coverage-pct       (direction=min, floor=100),
  }
}
```

`direction=min` (larger-is-better) means the ratchet only ever
tightens UPWARD. A regression below the committed floor fails the
gate without moving the floor; an improvement auto-tightens the
floor to the new value. At a floor of 100 the tighten is a no-op,
but the shape matters for any future fork that opts to start below
100 and ratchet up.

The metric numbers come from a new adapter
`harness/sensors/coverage_scan.mjs` that emits a soft-skip envelope:

```json
{
  "tool": "coverage-scan",
  "available": true,
  "version": "1.0.0",
  "scanned_lanes": ["rust", "python", "javascript"],
  "metrics": {
    "rust_line_pct": 100,
    "rust_function_pct": 100,
    "rust_region_pct": 100,
    "python_line_pct": 100,
    "javascript_line_pct": 100,
    "min_line_pct": 100
  }
}
```

The gate consumes the envelope via a new `--coverage=<path>` flag,
mirroring the existing `--sentrux=<path>` / `--deadcode=<path>`
wiring. Soft-skip (envelope reports `available: false`) degrades
every CV01 metric to "no reading" so a missing scanner cannot
silently pass.

### Operator invariant: 100 percent or nothing

The committed floor is 100 percent per metric. If a line is
genuinely uncoverable, exclude it via the language-native ignore
mechanism, never by lowering the numeric threshold:

- **Rust:** `#[cfg(not(coverage))]` to gate code out of coverage
  builds, or cargo-llvm-cov `--ignore-filename-regex` to drop a
  whole file (the cov-rust recipe already uses this for `main.rs`
  CLI shells whose region coverage is not under contract).
- **Python:** `# pragma: no cover` on a line, branch, or block, or
  `[tool.coverage.run] omit = [...]` for a whole module.
- **TypeScript:** `/* v8 ignore next */` comments for the v8
  provider.

The principle: an exclusion is a reviewable, named decision about
WHAT is uncoverable. A lowered numeric threshold is a structural
weakening that future regressions can hide behind. The first form
keeps the contract honest; the second corrodes it.

### Determinism

CV01 numbers MUST be byte-identical local versus CI. The adapter
guarantees this by:

1. **Pinning tool versions implicitly.** It shells out to
   cargo-llvm-cov, pytest-cov, and vitest, all of which are pinned
   by the workspace `Cargo.lock`, `uv.lock`, and `pnpm-lock.yaml`.
2. **Running the same commands as `just cov-rust` / `just cov-py`
   / vitest configs.** The RUST_LANES table in
   `coverage_scan.mjs` mirrors the cov-rust recipe EXACTLY (lines
   and functions enforced on every crate; regions enforced only on
   `ws_apps/example-rust` because the slot crates ship CLI shells
   whose region coverage is not under contract).
3. **Isolating `CARGO_TARGET_DIR`.** Concurrent cargo-llvm-cov
   runs in a shared target directory corrupt each other's profraw
   files. The adapter pins
   `CARGO_TARGET_DIR=<workspace>/target/coverage-isolated` per run
   so two worktrees or two CI matrices cannot cross-contaminate.

### Speed tier

Coverage is slow. A full polyglot run is greater than two minutes
on a cold cache (cargo build of three crates plus pytest plus four
vitest projects). To stay within pre-push budgets the adapter is
invoked from `bin/sensors gate` only when `SENSORS_COVERAGE=1` is
set in the environment. Pre-push leaves it off; the CI `fitness`
job sets it. Local agents can opt in with
`SENSORS_COVERAGE=1 just sensors gate` when they want a refresh.

## Consequences

### Positive

- Single source of truth for the coverage floor in baseline.json.
  Every relaxation is a reviewable diff against a committed file
  instead of a one-line tool-flag edit.
- Coverage joins the agent-facing `just fitness` report next to
  complexity, coupling, security, and licensing.
- The same ratchet that protects every other dimension now
  protects coverage: regressions fail the gate without moving the
  floor; improvements tighten it.
- Determinism is enforced by an explicit RUST_LANES table that
  mirrors the existing cov-rust recipe; future drift between the
  adapter and the recipe is a one-line config check, not a
  re-derivation.

### Negative

- One more JSON envelope shape to maintain (`coverage-scan`).
  Mitigated by following the same contract every other adapter
  emits.
- The fitness gate now depends on three coverage tools being
  installed in CI (cargo-llvm-cov, pytest-cov, vitest). Mitigated
  by the soft-skip envelope (`available: false`) which lets the
  gate degrade cleanly rather than fail closed on a missing
  scanner.

### Neutral / mitigations

- For the initial commit the JavaScript lane reads the root
  `scripts/` vitest project only. The per-app vitest configs
  (`ws_apps/example-typescript`, `harness/stack`, `harness/inspector`)
  are still enforced at 100 percent by their own thresholds in the
  standalone `scripts` CI job. A future extension can run all four
  vitest projects with `--coverage.reporter=json-summary` and take
  the project-min; the adapter's `composeMetrics` shape already
  supports a min-across-lanes value.

## Implementation notes

- New file: `harness/sensors/coverage_scan.mjs` (the adapter).
- New file: `harness/sensors/tests/coverage.test.mjs` (20 unit + integration tests).
- Modified: `harness/sensors/gate.mjs` (CV01 dimension, metrics,
  reader, CLI flag, fitness options threading).
- Modified: `harness/sensors/baseline.json` (CV01 block with floor
  100 per metric).
- Modified: `harness/sensors/fitness_report.mjs` (CV01 in
  DIMENSION_ORDER, --coverage path option).
- Modified: `.github/workflows/test.yml` (fitness job installs
  cargo-llvm-cov, runs pytest-cov plus vitest with json-summary,
  sets `SENSORS_COVERAGE` env vars, isolates CARGO_TARGET_DIR).
- Modified: `scripts/tests/sensors-apss-fitness.test.ts` (asserts
  updated to reflect 9 dimensions and 7 enforced dimensions).

## Related

- [ADR-0013: Coverage Enforcement](./ADR-0013-coverage-enforcement.md)
- [ADR-0019: Closed-Loop Architectural Quality](./ADR-0019-closed-loop-architectural-quality.md)
- [ADR-0020: Architectural Fitness Ratchet](./ADR-0020-architectural-fitness-ratchet.md)
- [ADR-0024: Dead-Code Ratchet](./ADR-0024-dead-code-ratchet.md)
