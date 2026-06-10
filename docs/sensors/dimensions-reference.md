---
name: "Fitness dimensions reference"
description: "Agent-facing catalog of every architectural-fitness dimension and metric enforced by harness/sensors/gate.mjs: code (MT01/MD01/ST01/SC01/LG01/AC01/PF01/AV01/CV01), per-metric direction and committed floor, speed tier (pre-commit/pre-push/CI), how an agent moves each metric, the upward-ratchet + atomic-baseline + EPSILON semantics, the sensor-determinism meta-guard, the just fitness surface, and the step-by-step recipe for adding a new dimension."
---

# Fitness dimensions reference

> This page is the agent-facing catalog of every architectural-fitness
> dimension and metric the template enforces. It is the single source
> of truth for: which codes exist, what each measures, the committed
> floor an agent must not regress, the tier (pre-commit / pre-push /
> CI) the metric fires at, and how to improve it. Companion docs:
> [`closed-loop.md`](./closed-loop.md) explains the producer-consumer
> loop; [`fitness-timing-and-placement.md`](./fitness-timing-and-placement.md)
> records the wall-clock budgets and tier rationale;
> [`coverage-and-gate.md`](./coverage-and-gate.md) covers the per-app
> coverage policy and the baseline-update flow.

## TL;DR for a coding agent

1. Run `just fitness --quick --format=summary` (read-only, instant) to
   see the one-line floor summary. The same line prints from the
   `fitness-summary` pre-commit hook on every commit, so you cannot
   miss it.
2. Run `just fitness` (full live report, ~108 s) when you need the
   per-metric headroom table. The report is READ-ONLY. It does not
   mutate `baseline.json` or change gating behavior.
3. The hard gate is `just sensors gate`. It writes `baseline.json`
   atomically when a metric improves (`tightenings`) and exits non-zero
   when any enforced metric regresses by more than `EPSILON = 1e-6`.
4. The committed floor lives at [`harness/sensors/baseline.json`](../../harness/sensors/baseline.json).
   Every floor in this doc is read from that file. If the doc and the
   file disagree, the file wins.
5. The agent contract for consuming the gate verdict is in
   [`closed-loop.md` §"The agent contract"](./closed-loop.md#the-agent-contract).

## The nine-dimension model

The template implements the APSS APS-V1-0002 architecture-fitness
contract. There are nine dimensions; seven are enforced and two are
advisory by design.

| Code | Name                    | Enforcement | Default        | Promotion status |
|------|-------------------------|-------------|----------------|------------------|
| MT01 | Maintainability         | enforced    | default-enabled | active          |
| MD01 | Modularity and Coupling | enforced    | default-enabled | active          |
| ST01 | Structural Integrity    | enforced    | default-enabled | active          |
| SC01 | Security                | enforced    | default-enabled | active          |
| LG01 | Legality                | enforced    | default-enabled | active          |
| AC01 | Accessibility           | advisory    | opt-in          | incubating      |
| PF01 | Performance             | enforced    | default-enabled | active          |
| AV01 | Availability            | advisory    | opt-in          | incubating      |
| CV01 | Test Coverage           | enforced    | default-enabled | active          |

The seven enforced dimensions can fail the gate (exit non-zero). The
two advisory dimensions surface in the report under the `[advisory]`
header and are counted in `advisoryRegressions` but never block. They
stay advisory by design because the template ships no rendered
frontend (AC01) and no running service (AV01); a consumer fork that
ships either writes its own adapter (axe-core / pa11y for AC01, a
chaos-engineering hook or SLO breach counter for AV01).

`DIMENSION_ORDER` in [`harness/sensors/gate.mjs`](../../harness/sensors/gate.mjs)
is the canonical ordering used in every report:
`MT01, MD01, ST01, SC01, LG01, AC01, PF01, AV01, CV01`.

## Speed tiers

Three feedback points, three discipline rules. The rationale lives in
[`fitness-timing-and-placement.md`](./fitness-timing-and-placement.md);
the table below is the mapping for an agent.

| Tier        | Budget          | Where it fires                       | What runs there                                              |
|-------------|-----------------|--------------------------------------|--------------------------------------------------------------|
| pre-commit  | < 2 s per gate  | `lefthook` `pre-commit` (parallel)   | `cx-gate` (MT01 fast subset), `fitness-summary` (READ-ONLY), `doc-validator`, `doc-validator-apss`, `secret-scan`, formatters, UBS staged scan. |
| pre-push    | 2 - 30 s        | `lefthook` `pre-push` (parallel)     | `perf-gate` (PF01 startup-benchmark-mean authority), `cov-ts` / `cov-rust` / `cov-py`, `typecheck-affected`, `test-affected`, `dep-audit-lockfile`, `versioning-release-check`, `doc-validator` (full). |
| CI ONLY     | > 30 s          | `.github/workflows/test.yml`         | Full `harness/sensors/bin/sensors gate` (~108 s; the canonical ratchet authority for every dimension). `dep-audit` CVE audit. |

The full ratchet was moved to CI-only in ADR-0020 because the
~108 s wall-clock dependency-cruiser pass + `.topology/` regeneration
race with `pnpm turbo run typecheck` / `pnpm test:coverage` in a
parallel pre-push, producing spurious folder-instability regressions.
Operators can still invoke the full gate locally with
`just sensors gate`; CI is the authority.

The `cx-gate` pre-commit shortcut covers MT01's three local-complexity
metrics (`max-cognitive`, `max-cyclomatic`, `high-cognitive-fn-count`)
without paying the full ~108 s. The `perf-gate` pre-push hook is the
PF01 startup-benchmark authority (it owns the absolute tolerance
window); the gate-level `startup-benchmark-mean` metric is the same
reading replayed through the ratchet. The `suite-duration` PF01
sensor is the authoritative enforcer of its own ceiling (3.0 s
absolute / 25 % relative) per ADR-0025; the gate-level
`suite-duration-p95-seconds` metric is observational
(`fail_on_regression: false`) because gate-level `EPSILON = 1e-6` would
convert normal wall-clock jitter into false failures.

## Per-dimension catalog

Every floor below is read directly from
[`harness/sensors/baseline.json`](../../harness/sensors/baseline.json).
"max" = smaller-is-better (gate fails when current > floor + EPSILON);
"min" = larger-is-better (gate fails when current < floor - EPSILON).
"obs." in the `fail_on_regression` column means the metric is
observational at the gate (no fail); a `null` floor means the metric
has no reading yet on this template clone and the gate skips it until
a reading lands.

### MT01 Maintainability (9 metrics, enforced)

Catches function-level rot (peak complexity, spread of moderately
complex functions, Halstead volume, sentrux structural signals,
orphan exports). The pre-commit `cx-gate` shortcut covers
`max-cognitive`, `max-cyclomatic`, and `high-cognitive-fn-count`
locally; the rest run in the full CI gate.

| Metric ID                  | Direction | Floor                  | fail_on_reg | Source                                                                                  |
|----------------------------|-----------|------------------------|-------------|-----------------------------------------------------------------------------------------|
| `max-cognitive`            | max       | 8                      | true        | APSS `functions.json` OR `harness/sensors/complexity.mjs`                                |
| `max-cyclomatic`           | max       | 6                      | true        | APSS `functions.json` OR `harness/sensors/complexity.mjs`                                |
| `max-halstead-volume`      | max       | null (no reading yet)  | true        | APSS `functions.json` `metrics.halstead.volume`                                          |
| `high-cognitive-fn-count`  | max       | 1                      | true        | aggregate `workspace.high_cognitive_count` (sum of fns >= cognitive 5)                   |
| `sentrux-quality-signal`   | min       | 0.6800640271325795     | true        | `.sentrux/baseline.json` `quality_signal` (geometric mean of 5 sub-scores)               |
| `sentrux-god-file-count`   | max       | 0                      | true        | `.sentrux/baseline.json` `god_file_count`                                                |
| `sentrux-hotspot-count`    | max       | 0                      | true        | `.sentrux/baseline.json` `hotspot_count`                                                 |
| `sentrux-complex-fn-count` | max       | 9                      | true        | `.sentrux/baseline.json` `complex_fn_count` (52-language tree-sitter overlay)            |
| `unused-export-count`      | max       | 14                     | true        | `harness/sensors/deadcode_scan.mjs` (pure-source scoped grep; see ADR-0024)              |

**How an agent improves MT01:**

- `max-cognitive` / `max-cyclomatic`: identify the worst-offending
  function from the gate's regression diff, refactor it to reduce
  branching depth. Both metrics watch the PEAK, so one ugly function
  pins the floor.
- `high-cognitive-fn-count`: watches the SPREAD. Catches the
  death-by-a-thousand-cuts pattern where a refactor splits one ugly
  function into several moderately-complex ones, an AI-coding
  regression mode the peak metric reads as an improvement.
- `unused-export-count`: remove the orphan export, or wire a real call
  site. The detector is a deterministic scoped grep with no
  `node_modules` / `npx` / network dependency.
- `sentrux-*`: the sentrux composite signals tighten as the project's
  god-file / hotspot / complexity signals fall; address the underlying
  files sentrux flagged in `.sentrux/baseline.json`.

**What trips it:** adding nested branching, splitting one big
function into several moderately-complex helpers, exporting symbols
without a call site, growing files into god-files, introducing
hotspots sentrux can detect cross-language.

### MD01 Modularity and Coupling (5 metrics, enforced)

Per-module fan-out, Martin main-sequence distance, instability range,
and sentrux's cross-module coupling and import-depth signals.

| Metric ID                          | Direction | Floor               | fail_on_reg | Source                                                                              |
|------------------------------------|-----------|---------------------|-------------|-------------------------------------------------------------------------------------|
| `max-fan-out`                      | max       | 2                   | true        | APSS `coupling.json` OR aggregate workspace modules (dep-cruiser fallback)          |
| `max-main-sequence-distance`       | max       | 1                   | true        | APSS `coupling.json` OR aggregate workspace modules                                  |
| `instability-out-of-range-count`   | max       | 4                   | true        | aggregate workspace modules where I < 0.1 OR I > 0.9                                 |
| `sentrux-coupling-score`           | max       | 0.19008264462809918 | true        | `.sentrux/baseline.json` `coupling_score`                                            |
| `sentrux-max-depth`                | max       | 3                   | true        | `.sentrux/baseline.json` `max_depth` (import / call-graph nesting depth)             |

**How an agent improves MD01:**

- `max-fan-out`: find the workspace module that imports the most
  outward deps and refactor by introducing a facade module, moving
  helpers inward, or splitting the consumer into smaller modules with
  narrower import surfaces.
- `max-main-sequence-distance`: the gate diff names the regressing
  folder and metric; reduce that folder's distance from the Martin
  main sequence by lowering instability if it is highly abstract, or
  by raising abstractness if it is concrete and unstable.
- `instability-out-of-range-count`: every module the gate counts is
  living in the `I < 0.1` or `I > 0.9` tail; either restructure or, if
  the module is by-design (a pure-leaf utility, an entry-point), the
  count is the price the floor pins.
- `sentrux-coupling-score` / `sentrux-max-depth`: the gate reads these
  from `.sentrux/baseline.json`; address the cross-module imports and
  the deepest import/call paths sentrux flagged.

**What trips it:** adding cross-package imports, deepening call
chains, introducing a new module that lives in the I < 0.1 or I > 0.9
tail without rebalancing existing ones.

### ST01 Structural Integrity (2 metrics, enforced)

Cyclic dependencies. Zero tolerance: any cycle fails the gate.

| Metric ID                    | Direction | Floor | fail_on_reg | Source                                                                          |
|------------------------------|-----------|-------|-------------|---------------------------------------------------------------------------------|
| `circular-dependency-edges`  | max       | 0     | true        | aggregate `workspace.circular_edges` (dependency-cruiser circular flag)         |
| `sentrux-cycle-count`        | max       | 0     | true        | `.sentrux/baseline.json` `cycle_count` (52-language tree-sitter SCC detector)   |

**How an agent improves ST01:** the gate diff names the offending
folder; break the cycle by introducing a downward-only edge, moving
the shared type to a third module both sides depend on, or inverting
the dependency direction. Each cycle of length N contributes N edges
to `circular-dependency-edges`. The two metrics jointly enforce ST01:
dep-cruiser covers JS/TS, sentrux lights up across all 52 supported
languages.

**What trips it:** importing a sibling module that already imports
back, introducing a "utils" module that imports from a feature module
that imports the utils.

### SC01 Security (1 metric, enforced)

Critical-severity findings from the Ultimate Bug Scanner (UBS) over a
stable list of template-owned source paths. The gate fails on any
critical pattern.

| Metric ID                | Direction | Floor | fail_on_reg | Source                                                                              |
|--------------------------|-----------|-------|-------------|-------------------------------------------------------------------------------------|
| `critical-finding-count` | max       | 0     | true        | `ubs --report-json` `totals.critical` (template-owned source paths)                  |

**How an agent improves SC01:** UBS prints the file, line, and
suggested fix for every critical finding. Read the suggested fix, fix
the root cause (not the symptom), re-run `ubs <file>` until exit 0
locally. See `~/CLAUDE.md` "UBS Quick Reference" for the workflow.

**What trips it:** introducing one of UBS's critical patterns (null
safety, XSS / injection, async/await footguns, memory leaks) in
template-owned source.

### LG01 Legality (1 metric, enforced)

Installed packages whose declared license is missing or outside the
OSI-permissive allowlist (MIT, ISC, Apache-2.0, BSD-2/3-Clause,
MPL-2.0, CC0-1.0). Walks every `node_modules` root that exists on disk.

| Metric ID              | Direction | Floor | fail_on_reg | Source                                              |
|------------------------|-----------|-------|-------------|-----------------------------------------------------|
| `denied-license-count` | max       | 0     | true        | `harness/sensors/license_scan.mjs` `denied_count`   |

**How an agent improves LG01:** the gate diff names the offending
package; either remove the dep, swap it for an allowlisted
alternative, or extend the allowlist in `license_scan.mjs` only after
a deliberate review (the diff is the audit trail).

**What trips it:** `pnpm add`-ing a package whose license is missing
or GPL-style copyleft.

### AC01 Accessibility (1 metric, advisory by design)

| Metric ID                          | Direction | Floor | fail_on_reg | Source                                                          |
|------------------------------------|-----------|-------|-------------|-----------------------------------------------------------------|
| `accessibility-violation-count`    | max       | null  | true        | advisory-by-design (no rendered frontend in a static template)  |

Stays advisory + opt-in until a consumer fork ships a rendered
frontend and writes its own adapter (axe-core / pa11y over the
rendered output, scoped to the fork's `ws_apps/<frontend>` path).
Advisory regressions surface in the report but do not fail the gate.

### PF01 Performance (4 metrics, enforced + observational)

Startup wall-clock plus test-suite duration. PF01 has TWO authorities:
the per-sensor hard ceiling (the adapter itself enforces its
absolute / relative tolerance window), and the gate-level ratchet
(an additional floor on the same reading).

| Metric ID                          | Direction | Floor               | fail_on_reg | Source                                                                                                                                                       |
|------------------------------------|-----------|---------------------|-------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `startup-benchmark-mean`           | max       | null                | true        | `harness/perf/baseline.json` `benchmarks.[*].mean` (hyperfine). The pre-push `perf-gate` hook owns the tolerance window; the gate ratchets the same reading. |
| `startup-benchmark-count`          | min       | 0                   | true        | `harness/perf/baseline.json` `benchmarks`. A removed bench is a coverage regression; floor of 0 is acceptable until hyperfine has produced a real measurement. |
| `suite-duration-p95-seconds`       | max       | null                | obs.        | `harness/sensors/suite_duration.mjs` envelope `duration_p95_seconds`. Observational at the gate because EPSILON = 1e-6 would convert wall-clock jitter into false failures. |
| `suite-duration-iteration-count`   | min       | 5                   | true        | `harness/sensors/suite_duration.mjs` envelope `iteration_count`. Floor pins the iteration count; a silent drop is a fake speedup, mirroring `startup-benchmark-count`. |

**Suite-duration authority split (ADR-0025).** The
`suite_duration.mjs` adapter is the AUTHORITATIVE enforcer: it owns
the hybrid ceiling
(`absolute_seconds_ceiling` + `relative_delta_percent` against the
floor in [`harness/sensors/suite-duration-baseline.json`](../../harness/sensors/suite-duration-baseline.json),
defaults 3.0 s / 25 %) plus the HARD coverage-coupling rule
(suite must produce a 100 % coverage envelope or the adapter exits
non-zero). The gate sees `null` / no-reading in that case and the
cycle fails at the adapter step before `suite-duration-p95-seconds` is
ever evaluated.

**How an agent improves PF01:**

- `startup-benchmark-mean`: profile the entrypoint, remove
  synchronous I/O on the critical path, lazy-load modules, shrink
  imports. Run `harness/perf/bench.sh | node harness/perf/gate.mjs`
  locally to confirm.
- `startup-benchmark-count`: never remove a committed benchmark
  without an audit-trail update to the floor.
- `suite-duration-p95-seconds`: make tests faster by parallelising,
  cutting redundant fixtures, or trimming integration smoke that
  unit can already cover. Coverage must stay at 100 %; the adapter
  enforces.
- `suite-duration-iteration-count`: never silently drop iterations.
  Five is the committed floor.

**What trips it:** synchronous fs in startup paths, a slow new
integration test added without parallelisation, dropping iterations
to fake a speedup.

### AV01 Availability (1 metric, advisory by design)

| Metric ID                     | Direction | Floor | fail_on_reg | Source                                                       |
|-------------------------------|-----------|-------|-------------|--------------------------------------------------------------|
| `availability-failure-count`  | max       | null  | true        | advisory-by-design (no running service in a static template) |

Stays advisory + opt-in until a consumer fork ships a real service
and writes its own adapter (chaos-engineering hook, SLO breach
counter, paired with the observability-stack slot).

### CV01 Test Coverage (6 metrics, enforced)

Polyglot coverage. The operator invariant is 100 % or nothing; if a
line is genuinely uncoverable, exclude it via `cfg(coverage)` /
`llvm-cov ignore` regions rather than lowering the floor. The CV01
ratchet authority is ADR-0025-coverage-ratchet.md.

| Metric ID                       | Direction | Floor | fail_on_reg | Source                                                                                  |
|---------------------------------|-----------|-------|-------------|-----------------------------------------------------------------------------------------|
| `rust-line-coverage-pct`        | min       | 100   | true        | `harness/sensors/coverage_scan.mjs` (cargo-llvm-cov `--json --summary-only`)            |
| `rust-function-coverage-pct`    | min       | 100   | true        | same; catches "helper compiled but never invoked" cases inlined past line coverage      |
| `rust-region-coverage-pct`      | min       | 100   | true        | same; catches "branch arm never exercised" cases that line coverage of 100 masks         |
| `python-line-coverage-pct`      | min       | 100   | true        | `harness/sensors/coverage_scan.mjs` (pytest-cov `--cov-report=json` `totals.percent_covered`) |
| `javascript-line-coverage-pct`  | min       | 100   | true        | `harness/sensors/coverage_scan.mjs` (vitest v8 `coverage-summary.json` `total.lines.pct`) |
| `min-line-coverage-pct`         | min       | 100   | true        | `min(rust_line_pct, python_line_pct, javascript_line_pct)` (project-wide MIN per lane)   |

`min-line-coverage-pct` is the single overall-fitness number an agent
should watch; a regression in any lane drops it.

**How an agent improves CV01:** add the missing test, or exclude the
genuinely-uncoverable line via the language's ignore mechanism
(`#[cfg(coverage)]`, `# pragma: no cover`, `/* v8 ignore */`). Never
lower the floor below 100. The CI fitness job pre-renders the JSON
coverage envelopes (Python pytest-cov, JS vitest summary) and passes
them via the `SENSORS_COVERAGE_*_JSON` env contract; the Rust lane
runs cargo-llvm-cov live under a pinned `CARGO_TARGET_DIR`.

**What trips it:** new uncovered lines, dropping a test file, a
language adapter going offline (the gate reads null and the metric
shows `no adapter wired`).

## Per-folder Martin readings (the second ratchet layer)

In parallel to the 9-dimension metric floors, the gate keeps a
per-folder floor on the raw Martin instability `I` and main-sequence
distance `D` for every workspace folder it sees. Those floors live in
[`harness/sensors/baseline.json`](../../harness/sensors/baseline.json)
under `folders.*` and they auto-tighten when a folder improves, fail
when a folder regresses, and emit `new (no baseline floor yet)` when a
new folder appears. The current committed folder floors include:

- `ws_apps/example-typescript/src`: I = 0.25, D = 0.25
- `ws_packages/telemetry/src`: I = 0, D = 0
- `ws_apps/example-typescript`: I = 1, D = 1
- `ws_packages/telemetry`: I = 0, D = 0

(Folders with `null` floors are deferred until a real reading lands.)

The gate diff format for a folder regression is exactly:

```text
ws_apps/example-typescript/src  I: 0.250 -> 0.333  (+0.083)
```

That line names the workspace folder, the Martin metric, the baseline,
the current value, and the delta. Mechanically actionable per
[`closed-loop.md` §"The agent contract"](./closed-loop.md#the-agent-contract).

## How `just fitness` works (the agent feedback surface)

`just fitness` is the agent-facing READ-ONLY report. It NEVER mutates
`baseline.json` and NEVER changes gating behavior. Four modes:

```sh
just fitness                            # full live report (~108 s)
just fitness --quick                    # floor-only, instant (reads baseline.json)
just fitness --quick --format=summary   # one-line summary (used by pre-commit)
just fitness --format=json              # structured payload for automation
```

The `fitness-summary` pre-commit hook always prints the one-line
summary, so an agent sees the floor on every commit without having to
remember to run anything. The full live report is the canonical surface
when an agent needs the per-metric headroom table.

Status taxonomy in the report:

- `[ OK ] PASS`: comfortable headroom against the floor; safe to ship.
- `[NEAR] AT-RISK`: at or within ~10 % of the floor; the next regression
  on that metric will trip the ratchet. Refactor before committing.
- `[FAIL]`: already below the floor; `just sensors gate` will reject
  the commit. Fix the code so the metric returns at or below the
  floor, or, if the change is intentional, run
  `just sensors gate --update-baseline` to relax the floor as a
  reviewable, audit-trailed edit to `harness/sensors/baseline.json`.
- `[ -- ] SKIP`: no reading or no floor for that metric (typically
  because `--quick` skipped the live scan or the adapter is not present
  in this environment).

The ratchet authority remains `just sensors gate` (local single-shot)
and the `fitness` GitHub Actions job (canonical CI ratchet).

## How the upward ratchet, fail-on-regression, and atomic baseline work

The gate is a monotonic ratchet:

1. **First run (no baseline).** `baseline.json` does not exist; the
   gate writes the current report as the baseline and exits 0 with a
   "baseline created" message. The new floor is committed.
2. **Subsequent runs.** Compare each metric against its floor:
   - **IMPROVEMENT** (current is direction-aware better than baseline,
     or baseline was `null` while current is a real number): the floor
     AUTO-TIGHTENS to the new value. The baseline is rewritten with
     the tightened floor. Exit 0. The report names what tightened in a
     `RATCHET: floor tightened ...` block.
   - **NO CHANGE** within `EPSILON = 1e-6`: no write, no churn, exit 0.
   - **REGRESSION** (current is direction-aware worse than baseline,
     beyond `EPSILON`): the floor does NOT move; the run prints a
     per-folder + per-dimension diff and exits non-zero with the
     `VERDICT: FAIL sensors gate` line.
3. **Escape hatches:**
   - `just sensors gate --update-baseline`: deliberate, reviewable
     RELAX. Writes the current report as the new baseline regardless
     of regression. Use only when an intentional refactor justifies
     loosening the floor; the resulting `baseline.json` diff is the
     audit trail.
   - `just sensors gate --no-ratchet` (or `RATCHET=off`): pure
     comparator. Useful for replay / CI dry-run / debug sessions
     where you do not want the side effect of rewriting the baseline.

**Atomic baseline write.** When the floor tightens, the gate writes
`baseline.json` atomically: a temp file `baseline.json.tmp-<ts>-<rand>`
is written first, then `renameSync` swaps it into place. A crash
between write and rename leaves the previous baseline intact (the
temp is cleaned up on the next run). This guarantees a partial write
can never poison the floor.

**Direction semantics:** `max` (smaller-is-better) improves when
`current < baseline - EPSILON`; `min` (larger-is-better) improves
when `current > baseline + EPSILON`. Regression is the inverse.

## The sensor-determinism meta-guard (PR #30)

Three sensor PRs in a row passed locally and failed CI because the
sensor emitted a different value local vs CI. The class of bug: a
fitness metric whose value depends on hidden environment state (knip's
resolution of an entry-point map, a wall-clock measurement, a
`CARGO_TARGET_DIR` layout) instead of on the source tree only. A
ratchet floor on a non-deterministic metric fails open or closed at
random, which is worse than no floor at all.

[`harness/sensors/tests/determinism.test.mjs`](../../harness/sensors/tests/determinism.test.mjs)
is the meta-guard that prevents the class from recurring. For every
sensor that `gate.mjs` consumes, it runs the sensor TWICE in a single
clean invocation against an identical input and asserts the two emitted
metric envelopes are byte-identical. Any sensor whose value varies
between two consecutive runs fails the test with a message that names
the sensor and shows both values. Coverage:

- `deadcode_scan.runDeadcodeScan` (MT01 `unused-export-count`)
- `license_scan.scanLicenses` (LG01 `denied-license-count`)
- `coverage_scan.buildEnvelopeFromOptions` (CV01 `*_line_pct` + `min_line_pct`)
- `abstractness.analyzeFiles` (MD01 main-sequence distance)
- `complexity.analyzeFiles` (MT01 `max-cognitive` + spread)
- `apss_topology.analyzeFromTopology` (MT01 / MD01 / ST01 APSS readings)
- `aggregate.aggregate` (downstream Martin per-folder)
- `sentrux_scan.runSentrux` (soft-skip)
- `suite_duration.evaluate` (mocked I/O; clock injected)

Sensors that are fundamentally clock-bound (suite-duration) are
tested with an injected `runner` + `now()` so the pure-aggregation
core is byte-deterministic. If a future refactor of the same core
ever introduces a `Date.now()` / `Math.random()` / non-stable
iteration order, the meta-guard catches it before the new sensor can
land.

**Implication for the agent:** when you add a new sensor (next
section), you MUST add it to `determinism.test.mjs` or the
sensor-of-sensors meta-guard will fail. The two-run byte-equality
check is the protection against the third local-pass / CI-fail
debugging session.

## How to add a new dimension or metric

The recipe below is the pattern PR #28 (CV01), PR #29 (PF01
suite-duration), PR #27 (MT01 dead-code), and PR #25 (LG01 + SC01)
followed. Use it for any new sensor.

1. **Write an ADR.** New dimension or new metric is a load-bearing
   architectural decision. Drop a file under
   [`docs/adrs/`](../adrs/) named `ADR-NNNN-<kebab-title>.md`.
   Required APSS shape:
   - YAML front matter with `name:`, `description:`, `status:`
     (`proposed` / `accepted` / `deprecated` / `superseded`).
   - Markers: `**Date:**`, `**Category:**`, `## Context`,
     `## Decision`, `## Consequences`. The Rust doc-validator enforces
     these.
   - Add a row to [`docs/adrs/README.md`](../adrs/README.md)
     `## Index` table.
2. **Author the sensor.** Add a `*_scan.mjs` (or equivalent) under
   [`harness/sensors/`](../../harness/sensors/). The sensor MUST be
   deterministic: same input -> same output, no `Date.now()` /
   `Math.random()` / iteration-order dependence on environment.
3. **Wire the sensor into the gate.** Edit
   [`harness/sensors/gate.mjs`](../../harness/sensors/gate.mjs):
   - If the dimension is new: add the code to `DIMENSION_ORDER`, add
     a `DIMENSIONS[CODE]` entry with `name`, `promotion_status`,
     `enforcement`, `default`.
   - Add the metric to `FITNESS_METRICS[CODE]` with `id`, `name`,
     `objective`, `source`, `direction`, `default_threshold`,
     `fail_on_regression`, and a `value(report, options)` function.
   - Choose `direction`: `max` (smaller-is-better) or `min`
     (larger-is-better).
   - Choose `fail_on_regression`: `true` for hard-enforce; `false`
     for observational (used for noisy wall-clock signals like
     `suite-duration-p95-seconds`).
4. **Add to the sensor-of-sensors meta-guard.** Edit
   [`harness/sensors/tests/determinism.test.mjs`](../../harness/sensors/tests/determinism.test.mjs)
   to run the new sensor twice and assert byte-identity. Without
   this, a future regression that makes the sensor non-deterministic
   slips through.
5. **Decide the speed tier.** Match the discipline rule in
   [`fitness-timing-and-placement.md`](./fitness-timing-and-placement.md):
   - Instant (< 2 s): wire to `lefthook.yml` `pre-commit`.
   - Medium (2-30 s): wire to `lefthook.yml` `pre-push`.
   - Slow (> 30 s): leave in the CI `fitness` job at
     [`.github/workflows/test.yml`](../../.github/workflows/test.yml)
     and document the local invocation
     (`just sensors gate` or a per-sensor recipe).
6. **Generate the initial floor.** Run `just sensors gate` once. The
   first run writes the current reading to `baseline.json`. Commit
   the `baseline.json` diff in the same change as the sensor.
7. **Add a row to this reference.** Update the per-dimension catalog
   in this file with the new metric's row (ID, direction, floor,
   `fail_on_regression`, source) and the "How an agent improves it /
   what trips it" prose. Keep the floor values verbatim from
   `baseline.json`.
8. **Cross-reference the ADR from the gate.** The ADR usually lives
   in the metric's `objective` string (e.g.
   `"... See ADR-0024-dead-code-ratchet.md."`), so an agent reading
   the gate report can navigate to the decision.
9. **Run the gates.** Confirm:
   - `just sensors gate` exits 0 (no regression; baseline created or
     auto-tightened).
   - `just fitness --quick --format=summary` reports the new floor.
   - `node --test harness/sensors/tests/determinism.test.mjs` passes.
   - `harness/doc-validator/bin/doc-validator .` validates the ADR
     and any new cross-references.
   - The pre-commit and pre-push hooks pass for a sample commit.

The pattern is composable: a new dimension is the same recipe plus
the `DIMENSIONS` and `DIMENSION_ORDER` edits in step 3.

## Cross-references

- [`closed-loop.md`](./closed-loop.md): producer -> consumer -> merge -> enforce; the agent contract.
- [`coverage-and-gate.md`](./coverage-and-gate.md): per-app coverage policy and the baseline-update flow.
- [`fitness-timing-and-placement.md`](./fitness-timing-and-placement.md): per-gate wall-clock budgets and tier rationale.
- [`harness/sensors/baseline.json`](../../harness/sensors/baseline.json): the committed floor (source of truth for every number in this doc).
- [`harness/sensors/gate.mjs`](../../harness/sensors/gate.mjs): `DIMENSION_ORDER`, `DIMENSIONS`, `FITNESS_METRICS`, `EPSILON`, ratchet logic, `atomicWriteFile`, `renderReport`.
- [`harness/sensors/aggregate.mjs`](../../harness/sensors/aggregate.mjs): the aggregator that produces the report `gate.mjs` consumes.
- [`harness/sensors/fitness_report.mjs`](../../harness/sensors/fitness_report.mjs): the READ-ONLY `just fitness` report engine.
- [`harness/sensors/tests/determinism.test.mjs`](../../harness/sensors/tests/determinism.test.mjs): the sensor-of-sensors meta-guard (PR #30).
- [ADR-0017](../adrs/ADR-0017-sensors-v03-apss-canonical.md): sensors v0.3, APSS canonical, sentrux preserved.
- [ADR-0018](../adrs/ADR-0018-apss-v1-1-0-augmentation.md): APSS v1.1.0 integration (augment, never replace).
- [ADR-0019](../adrs/ADR-0019-closed-loop-architectural-quality.md): closed-loop architectural quality.
- [ADR-0020](../adrs/ADR-0020-architectural-fitness-ratchet.md): the upward ratchet contract.
- [ADR-0021](../adrs/ADR-0021-formatter-slot.md): formatter slot.
- [ADR-0023](../adrs/ADR-0023-dependency-audit.md): polyglot dependency / supply-chain audit (LG01 + SC01 inputs).
- [ADR-0024](../adrs/ADR-0024-dead-code-ratchet.md): the MT01 `unused-export-count` ratchet.
- [ADR-0025-coverage-ratchet](../adrs/ADR-0025-coverage-ratchet.md): the CV01 ratchet.
- [ADR-0025-suite-duration-sensor-pf01](../adrs/ADR-0025-suite-duration-sensor-pf01.md): the PF01 suite-duration adapter as authoritative enforcer.
