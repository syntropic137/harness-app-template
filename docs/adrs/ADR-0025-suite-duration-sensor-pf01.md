---
name: "Test-suite duration sensor under PF01 — hybrid ceiling + ratchet with hard coverage coupling"
description: "Extend the PF01 (Performance) dimension with a test-suite wall-clock sensor that gates on a hybrid absolute ceiling + relative regression delta against a committed baseline, with coverage <100% as a hard precondition in both advisory and enforce modes. Wires through the ADR-0020 direction-aware ratchet (no new dimension)."
status: accepted
---

<!--
ADR-0025 — extends ADR-0019 / ADR-0020 / ADR-0024 with a new PF01 reading.
Sensors slot only. Placement (lefthook, CI) is owned by the integration
lane and unchanged; this ADR pins the metric IDs, the baseline schema,
the coverage-coupling rule, and the multi-iteration measurement
contract. The validated design was produced in
syntropic137/fitness-timing-lab (EXP-01..EXP-04) and ported here, NOT
copied wholesale: the prototype's two coverage-coupling defects
(silent-100% fallback, advisory-mode coverage softening) are fixed in
the port and re-proven against a real regression demo.
-->

# ADR-0025: Test-suite duration sensor under PF01 — hybrid ceiling + ratchet with hard coverage coupling

**Date:** 2026-06-10
**Category:** sensors slot (harness/sensors/suite_duration.mjs, harness/sensors/suite-duration-baseline.json, FITNESS_METRICS.PF01)
**Supersedes:** none (extends [ADR-0019](./ADR-0019-closed-loop-architectural-quality.md), [ADR-0020](./ADR-0020-architectural-fitness-ratchet.md), and follows the [ADR-0024](./ADR-0024-dead-code-ratchet.md) shape for adding a new reading to an existing dimension)
**Next review:** 2026-12-10

## Context

The PF01 dimension watches *startup* wall-clock today via two metrics
sourced from `harness/perf/baseline.json` and produced by a hyperfine
runner (`startup-benchmark-mean`, direction `max`; `startup-benchmark-count`,
direction `min`). That covers cold-start latency but not the other
dominant wall-clock signal that gates AI-coding workflows: the
**test-suite duration**.

Test-suite duration matters for the same operational reasons startup
time matters — but it also has a failure mode startup-time gating
*cannot* have: a suite can be sped up by **dropping coverage**
(skipping tests, sharding cases out of the gated lane, deleting an
assertion that pulled a branch into the trace). The literature
acknowledges the trade ([Fowler, *Test Coverage*][fowler-cov];
[Fowler, *The Practical Test Pyramid*][fowler-pyramid]) but no tool we
surveyed gates against it.

The validated design lives in
[`syntropic137/fitness-timing-lab`][lab]:

- [`EXP-01`][exp01] (NoblePrairie / Claude, RainyBay) — prior-art and
  theory: confirmed (a) absolute ceilings and committed-baseline
  ratchets coexist deliberately (size-limit + bundlewatch on the
  absolute side, betterer on the ratchet side); (b) baselines belong
  in the repo, never a CI cache, so every floor change is a
  code-review event; (c) the coverage-coupling rule is a real
  un-tooled gap — *the highest-leverage idea in the sensor*; (d) the
  full-suite ~10-minute rule (XP / Fowler / Humble–Farley) is the
  closest thing to a canonical numeric threshold.
- [`EXP-02`][exp02] (PlumGrove / Codex) — runnable prototype proving
  the hybrid gate works end-to-end against a real Bun test suite.
- [`EXP-03`][exp03] (PeachRobin / Gemini) — six-tool survey
  converging on a hybrid-pattern recommendation (committed baseline
  for the delta, hardcoded ceiling for the absolute floor).
- [`EXP-04`][exp04] (RainyBay, cross-review) — found **two real
  defects** in the EXP-02 prototype that this port MUST fix: a silent
  fallback to 100% coverage when the column is absent
  (`suite-performance-sensor.mjs:220-228`), and advisory mode lumping
  coverage violations into the same WARN-and-exit-0 bucket as timing
  misses (`:111-124`).
- [`FRICTION.md`][friction] — friction record from all four lab
  agents, including the documented Agent Mail lock model the port
  inherits.

The lab's verdict was **GO with adjustments**, and the operator's
brief makes those adjustments mandatory: the port must fix both
prototype defects, must re-prove the coverage coupling against a
**real** regression (delete a test → covered line goes uncovered),
must hard-fail coverage misses in both modes, and must take its
duration reading from a multi-iteration measurement (p95 / median-of-5)
in enforce mode rather than the prototype's single-shot wall-clock.

The deferred decision the lab left open — *should the new reading
extend PF01 or stand up as its own fitness dimension?* — is resolved
in this ADR.

## Decision

Six related decisions, all accepted:

1. **Extend PF01, do not add a new dimension.** Test-suite wall-clock
   is performance; PF01's `name: 'Performance'`, `promotion_status:
   active`, `enforcement: enforced`, `default: default-enabled` is
   exactly the posture the new reading needs. Reusing PF01 means the
   ADR-0020 direction-aware ratchet wires through for free (no new
   ratchet code; no new entry in `DIMENSION_ORDER`; no per-dimension
   narrative to write across `slot-contracts.md`, doc-validator
   hooks, or the `gap-analysis/02-decisions-adr.md` lineage). The
   established adapter-diversity-inside-a-dimension pattern from
   ADR-0024 (MT01 grew an `unused-export-count` reading alongside its
   existing APSS / sentrux / complexity readings) applies verbatim.
   Rejected alternatives are catalogued in the "Alternatives
   considered" section below.

2. **Two new FITNESS_METRICS entries under PF01.** The shape mirrors
   the existing PF01 pair exactly (a mean-direction-max metric + a
   count-direction-min guard against silent erosion):

   | Metric ID | Direction | Source | Rationale |
   |---|---|---|---|
   | `suite-duration-p95-seconds` | `max` (smaller-is-better) | `harness/sensors/suite-duration-baseline.json#duration_p95_seconds` | The wall-clock floor. p95 (or median-of-5; the adapter records both) over the iterations measured in enforce mode. Auto-tightens via the ADR-0020 ratchet on improvement; never widens on regression. |
   | `suite-duration-iteration-count` | `min` (larger-is-better) | `harness/sensors/suite-duration-baseline.json#iteration_count` | Floor is the snapshotted iteration count. A drop fails the gate — the exact pattern `startup-benchmark-count` uses to refuse a "speedup" that was bought by silently dropping iterations. Mirrors that metric's rationale verbatim. |

   Both metrics use the existing `null`-degradation contract: if the
   adapter is offline or the baseline file is unreadable, the reader
   returns `null` and the metric reports as no-reading (NOT a false
   zero). This is the same shape SC01, LG01, and the existing PF01
   metrics already wear.

3. **A new committed baseline file: `harness/sensors/suite-duration-baseline.json`.**
   Pinned schema:

   ```json
   {
     "schema_version": "1.0.0",
     "standard": "APS-V1-0002",
     "suite_command": "bun test --coverage",
     "workdir": "ws_apps/example-suite",
     "iteration_count": 5,
     "duration_p95_seconds": 0.30,
     "duration_median_seconds": 0.28,
     "absolute_seconds_ceiling": 3,
     "relative_delta_percent": 25,
     "required_coverage_percent": 100,
     "coverage_floor_metrics": ["statements", "branches", "functions", "lines"],
     "notes": "Committed baseline for the suite-duration PF01 metric per ADR-0025."
   }
   ```

   The file lives in the repo (NOT a CI artifact store) so every
   change to the floor is a code-review event — the discipline
   `.betterer.results` and `.size-limit.json` are also built around
   ([EXP-01][exp01] F3). The `iteration_count = 5` matches AndroidX
   Macrobenchmark's default ([EXP-01][exp01] H7); the
   `relative_delta_percent = 25` matches size-limit's "current + 25%"
   headroom rule ([EXP-01][exp01] F2, [EXP-03][exp03] hybrid
   recommendation). The `coverage_floor_metrics` array is **the
   explicit list** the adapter must verify; no member of that list is
   ever assumed to be 100 if the suite's coverage output does not
   actually emit it (see Decision 5 below).

4. **The hybrid gate: BOTH an absolute ceiling AND a relative delta.**
   The sensor fails on timing iff:

   ```
   duration_observed > max(committed_p95 * (1 + relative_delta_percent/100),
                           absolute_seconds_ceiling)
   ```

   The `max(…)` floor protects against a suite that is so fast 25%
   is meaningless; the `absolute_seconds_ceiling` is the
   Google-style budget that catches catastrophic regressions
   regardless of where the baseline sits ([EXP-03][exp03]). Both
   thresholds come from the committed baseline; neither is hardcoded
   into the adapter.

5. **Coverage <100% is a HARD precondition in BOTH advisory and
   enforce modes.** The two non-negotiable rules the EXP-04
   cross-review flagged as defects in the prototype, and that the
   operator brief makes mandatory in the port:

   - **No silent-100% fallback.** If any metric listed in
     `coverage_floor_metrics` is absent from the test suite's
     coverage output OR cannot be parsed, the adapter emits a
     `coverage_unverifiable` violation and exits non-zero. The
     prototype's `:220-228` fallback-to-100 path is removed; the
     port treats "no column emitted" as a hard fail, NEVER as an
     assumed 100.
   - **Advisory mode never softens coverage.** Advisory mode may
     downgrade a *timing* miss to a `WARN` and exit 0 (the
     advisory→enforce maturity path per [ADR-0020][adr20] § "advisory
     by default, enforce by explicit flag" lineage), but a coverage
     miss is FATAL regardless of mode. The advisory→enforce ramp
     applies to **timing only**.

6. **Enforce mode = median-of-5 / p95-of-5 iterations; advisory mode
   may be single-shot.** Wall-clock noise on CI hardware is large
   enough that single-shot enforcement would flake the gate — the
   benchmarking tradition (AndroidX Macrobenchmark, BenchmarkDotNet,
   ChromePerf catapult — [EXP-01][exp01] H7) settled this question
   decades ago. The adapter runs the suite N times (N = baseline's
   `iteration_count`, default 5), records every iteration's
   wall-clock, and emits both the median and the p95 in the report.
   The PF01 reader uses the p95; the adapter's own gate may use the
   median if a fork prefers; the contract is `iteration_count >=
   baseline_iteration_count` AND `duration_p95 <= ceiling`. Advisory
   mode is permitted to short-circuit at iteration 1 (the prototype's
   single-shot shape) to keep developer feedback fast.

Concretely, the new files added under this ADR:

- `harness/sensors/suite_duration.mjs` — the adapter. Spawns the
  configured suite command N times, parses coverage from the
  emitted output without any silent fallback, computes p95 and
  median, emits the structured report, and exits 0 / non-zero per
  the modes above.
- `harness/sensors/suite-duration-baseline.json` — the committed
  baseline file with the schema pinned in Decision 3.
- `harness/sensors/tests/suite-duration.test.mjs` — the proof. The
  adapter's own test suite is held to 100% coverage (operator hard
  rule); genuinely unreachable lines are marked with `/* v8 ignore */`
  comments at the call site (NEVER a lowered threshold).
- `harness/sensors/bin/sensors suite-duration` — wrapper recipe
  invocation parallel to `harness/sensors/bin/sensors gate` (the
  composed-binary entrypoint the task-runner slot exposes).

And the edits to existing files:

- `harness/sensors/gate.mjs` — add two entries to `FITNESS_METRICS.PF01`
  (the IDs in Decision 2). Both reader functions follow the same
  `(_report, options) => ...` shape as `perfBenchmarkMeans`, returning
  `null` when the adapter envelope is missing.
- `harness/sensors/baseline.json` — add the two metrics to
  `dimensions.PF01.metrics` with their schema (name, objective,
  source, direction, `default_threshold`, `baseline: null` until the
  first ratchet run pins it, `fail_on_regression: true`).
- `justfile` — a `just sensors suite-duration` recipe that invokes
  `harness/sensors/bin/sensors suite-duration` with advisory as the
  default for local use.

Deliberate non-choices:

- **No change to ADR-0020's ratchet code path.** The two new metrics
  declare `direction: max` and `direction: min`. The ratchet at
  `gate.mjs#ratchetBaseline` reads `direction` from `FITNESS_METRICS`
  and acts on it; no new code path is required. The improvement-side
  rewrite of `baseline.json` happens automatically; the regression
  side fails the gate without widening the floor; `--update-baseline`
  remains the only deliberate-relax escape hatch.
- **No new dimension in `DIMENSION_ORDER`.** Adding PF02 / QA01 / TS01
  would force edits to `DIMENSION_ORDER`, `baseline.json`'s
  `dimensions` taxonomy, `slot-contracts.md`, the doc-validator
  enforcement table, and every per-dimension narrative in
  `docs/gap-analysis/`. PF01 already exists with the right posture;
  reuse it.
- **No change to the placement decisions in [ADR-0019][adr19] §
  Decision (1) or [ADR-0020][adr20] § "No change to lefthook.yml or
  the CI workflow".** The new metric runs at the **CI tier** (per
  ADR-0024's same placement reasoning — wall-clock + race grounds).
  The pre-push tier sees only the read-only summary line through
  `just fitness --quick --format=summary`. Local-loop authors can
  invoke `just sensors suite-duration --advisory` for fast feedback
  without paying the median-of-5 cost.
- **No coupling to a specific test framework.** The `suite_command`
  field is configurable; the prototype targets `bun test --coverage`
  but the parser is structured so a consumer fork that runs
  `pytest --cov` or `cargo test -- --nocapture` writes its own
  coverage-emit pair and the adapter parses it. The shape, not the
  string, is the contract.
- **No commit of `harness/sensors/suite-duration-report.json`.**
  Like `.topology/metrics/*.json` ([ADR-0019][adr19] § Deliberate
  non-choices), the per-run report is regenerable from source. The
  committed file is the **baseline** (the floor), not the report.

## Consequences

- **What this enables.** Test-suite wall-clock joins startup-time
  under the same monotonic ratchet ([ADR-0020][adr20]). The
  coverage-coupling gap [EXP-01][exp01] H5 found in the literature is
  now closed mechanically: a PR that speeds the suite up by dropping
  coverage cannot land — the timing improvement is invisible to the
  ratchet (the adapter exits non-zero before the gate reads the
  improved number) and the gate fails. The audit trail is the
  committed `harness/sensors/suite-duration-baseline.json` diff:
  every floor change is a code-review event.
- **What this constrains.** A consumer fork that does not run a
  test suite at all (a pure docs / config repo) writes
  `iteration_count: 0` in its baseline; the adapter exits 0 with a
  `no-suite-configured` no-reading, the PF01 reader returns `null`,
  and the gate sees the same `apssAvailable: false` shape it already
  handles. The default value of `iteration_count: 5` in the schema
  pins the operator-mandated multi-iteration measurement for
  template consumers that *do* run tests. Forks that legitimately
  need more iterations (high-variance hardware, large suites) bump
  the count; forks that want fewer pay the determinism cost
  explicitly.
- **Per-cycle cost.** Multi-iteration measurement costs
  `iteration_count * single_suite_wall_clock`. At the template's
  default (5 iterations × the example suite at ~60 ms each) the
  total is sub-second; at a consumer-fork scale (5 iterations × a
  60-second real suite) the total is 5 minutes, which is why the
  metric runs at the **CI tier** ([ADR-0024][adr24] placement
  rationale). Local-loop authors who want fast feedback use the
  advisory-single-shot mode.
- **Preservation audit.** No removals.
  (1) PF01's existing `startup-benchmark-mean` and
      `startup-benchmark-count` metrics are unchanged.
  (2) `harness/perf/baseline.json` is unchanged; the new
      `harness/sensors/suite-duration-baseline.json` is a sibling,
      not a replacement.
  (3) `harness/sensors/gate.mjs#ratchetBaseline` is unchanged; the
      new metrics declare `direction` and the ratchet just consumes
      them.
  (4) `harness/sensors/baseline.json` schema is unchanged; new
      metrics nest under `dimensions.PF01.metrics`.
  (5) `DIMENSION_ORDER` is unchanged.
  (6) The advisory→enforce maturity ramp for *timing* is unchanged
      from the ADR-0020 lineage; the coverage-coupling rule is the
      one new ramp constraint and applies above (not within) the
      timing ramp.

## Details

### Direction semantics for the new metrics

Per [ADR-0020][adr20] § Direction semantics, the ratchet acts on
each metric's declared `direction` field:

- `suite-duration-p95-seconds` carries `direction: max`. Improvement
  is `current < baseline - EPSILON`; the ratchet rewrites
  `harness/sensors/suite-duration-baseline.json#duration_p95_seconds`
  to the new (tighter) p95. Regression is `current > baseline +
  EPSILON`; the gate exits non-zero and the floor is NOT widened.
- `suite-duration-iteration-count` carries `direction: min`.
  Improvement is `current > baseline + EPSILON`; the ratchet rewrites
  the baseline's `iteration_count` upward. A drop is a regression
  (someone silently lowered the iteration count to fake a speedup);
  the gate fails.

The same `null`-baseline-meets-real-number tightening path
[ADR-0020][adr20] documents applies here: a fork that has never run
the sensor sees `baseline: null` in `harness/sensors/baseline.json`'s
PF01 entries; the first passing run pins them.

### How the coverage-coupling rule is enforced — the precondition shape

The coverage-coupling rule is enforced *inside* the dedicated
`harness/sensors/suite_duration.mjs` adapter as a HARD precondition,
NOT as a separate `FITNESS_METRICS` entry. The PF01 reader
contract is identical to `perfBenchmarkMeans`: return a real number
when the adapter envelope exists and is valid; return `null` when
the envelope is missing or `available: false`. The adapter's own
exit code is the primary enforcer (same shape `startup-benchmark-mean`
delegates to `harness/perf/gate.mjs`).

This means the gate sees one of three states for the timing reading:

| Adapter state | Adapter exit | PF01 reader return | Gate outcome |
|---|---|---|---|
| Timing PASS + coverage 100% | 0 | the p95 number | PASS; ratchet may tighten |
| Timing PASS + coverage <100% OR `coverage_unverifiable` | non-zero in BOTH modes | `null` (no envelope) | Adapter's own exit code fails the cycle BEFORE the gate runs |
| Timing FAIL + coverage 100%, advisory mode | 0 (warn) | the p95 number | PASS at the gate; the WARN line is on the agent's TTY |
| Timing FAIL + coverage 100%, enforce mode | non-zero | the p95 number | Gate evaluates the regression against the floor and fails |

The crucial row is the second: a coverage miss is detectable *only*
by the adapter (the gate cannot see "the suite did not emit a
`branches` column"). The adapter's non-zero exit IS the gate's
coverage-failure signal. This is why the rule is HARD in both modes
and CANNOT be downgraded by `--advisory`.

### Why "no silent-100% fallback" is load-bearing

The EXP-02 prototype (`prototype/suite-performance-sensor.mjs:220-228`)
falls back to 100 for every coverage metric when the bun coverage
table cannot be located; the report carries `coverageMode:
"missing-coverage-line"` but the gate logic at `:86-90` only checks
the percentages, never the mode. The EXP-04 cross-review names this
"the exact failure the hard rule was meant to prevent" — if
`bun test --coverage`'s output format ever drifts, the prototype
reports 100% and passes silently.

The port fixes this by reading each metric in
`coverage_floor_metrics` from the parser's output **independently**,
treating any absent / unparseable column as a `coverage_unverifiable`
violation:

```
for metric in baseline.coverage_floor_metrics:
    if metric not in parsed_columns:
        violations.push({type: 'coverage_unverifiable', metric})
    elif parsed_columns[metric] < baseline.required_coverage_percent:
        violations.push({type: 'coverage_below_floor', metric, value: parsed_columns[metric]})
```

Both violation types HARD-FAIL the adapter regardless of mode. The
adapter NEVER reads `parsed_columns[metric] || 100`.

### Why advisory mode keeps coverage violations fatal

The advisory→enforce maturity ramp ([ADR-0020][adr20] lineage,
[EXP-01][exp01] H4 negative result on SRE / [EXP-03][exp03] hybrid
recommendation) is a **timing** ramp. The premise is that timing is
noisy enough on early CI runs that an immediate hard gate would
flake the build; teams want a few weeks of WARN-mode telemetry
before turning the enforcement up. None of those reasons apply to
coverage: coverage is a deterministic property of the test suite,
the floor is fixed at 100%, and a drop is always a real change
(someone deleted, skipped, or sharded a test out). There is no noise
to absorb. Letting advisory mode soften the coverage rule would
defeat the entire reason the coupling exists.

### Re-proving the coupling against a REAL regression

EXP-02's third run demoed the coupling by setting
`required_coverage_percent: 101`, which is unsatisfiable. The gate
plumbing was proven, but the sensor's refusal to be tricked by a
*real* coverage drop was not. The port's test plan (see
`harness/sensors/tests/suite-duration.test.mjs`, added by the
implementation lane) will exercise the real path:

1. Run the fixture suite with full coverage; confirm pass.
2. Delete an `expect(...)` assertion in the fixture that pulled a
   covered branch into the trace.
3. Re-run; confirm the adapter exits non-zero with a
   `coverage_below_floor` violation citing the dropped column
   (`branches` or `lines`, depending on which assertion is removed).
4. Repeat in `--advisory` mode; confirm the adapter STILL exits
   non-zero.
5. Restore the assertion; confirm pass again.

The PR body MUST include the verbatim output of all three runs (the
operator brief's "demonstrate the coverage-coupling failing against
a real regression" requirement). Reviewers can re-run the demo
trivially by `git checkout` of the regression commit.

### Why median-of-5 / p95-of-5 is the cheapest defensible mitigation

Single-shot wall-clock plus a 25% headroom band ([EXP-01][exp01] F2)
is acceptable for advisory mode — the developer is looking at the
output, the WARN is informational, and the cost of running the
suite five times locally is real. For enforce mode, the noise floor
of CI hardware (shared runners, neighbor tenants, cache warmth
variance) is large enough that single-shot enforcement would flake;
the benchmarking tradition's median-of-5 / p95-of-5 default
([EXP-01][exp01] H7) is the documented mitigation. 5 is the
smallest count that gives a defensible percentile estimate and a
median tiebreak; the schema's `iteration_count` field is per-fork
configurable for hardware that needs more.

### How the metric IDs map to the report envelope

The adapter writes its envelope to a tempfile; the
`harness/sensors/bin/sensors gate` wrapper passes
`--suite-duration=<path>` to `gate.mjs` (mirroring the
`--deadcode=<path>`, `--licenses=<path>`, `--sentrux=<path>` flags
the existing adapters already use). The envelope shape:

```json
{
  "tool": "suite-duration",
  "available": true,
  "mode": "enforce",
  "command": "bun test --coverage",
  "workdir": "ws_apps/example-suite",
  "iterations": [
    {"index": 0, "wall_clock_seconds": 0.061, "coverage": {"statements": 100, "branches": 100, "functions": 100, "lines": 100}},
    {"index": 1, "wall_clock_seconds": 0.058, "coverage": {"statements": 100, "branches": 100, "functions": 100, "lines": 100}},
    {"index": 2, "wall_clock_seconds": 0.064, "coverage": {"statements": 100, "branches": 100, "functions": 100, "lines": 100}},
    {"index": 3, "wall_clock_seconds": 0.057, "coverage": {"statements": 100, "branches": 100, "functions": 100, "lines": 100}},
    {"index": 4, "wall_clock_seconds": 0.063, "coverage": {"statements": 100, "branches": 100, "functions": 100, "lines": 100}}
  ],
  "duration_p95_seconds": 0.064,
  "duration_median_seconds": 0.061,
  "iteration_count": 5,
  "violations": [],
  "passed": true
}
```

`available: false` (with no `iterations` array) is the no-reading
shape the PF01 reader sees as `null`.

### Slot contract compatibility

- `harness.manifest.json#slots.sensors.implementation` — append "PF01
  watches startup wall-clock AND test-suite wall-clock per ADR-0025."
- `harness.manifest.json#slots.hooks` — unchanged; the pre-push
  `just fitness --quick --format=summary` line picks up the new
  metric reading via the read-only summary.
- `harness.manifest.json#slots.task-runner` — `just sensors
  suite-duration` and `just sensors gate` compose the adapter +
  gate; the recipe is unchanged in shape.
- `harness.manifest.json#slots.agent-plugins` — cross-link this ADR
  from `CLAUDE.md` / `AGENTS.md` so any agent reading the project's
  context learns "PF01 watches BOTH startup-time and suite-duration;
  the suite-duration sensor has a HARD coverage precondition that
  even advisory mode cannot soften."

### Alternatives considered

- **Stand up a new dimension (PF02 / QA01 / TS01).** Catalogued in
  Decision (1). Rejected: splits one signal (performance) across two
  taxonomy boxes; forces edits to `DIMENSION_ORDER`,
  `baseline.json` dimensions taxonomy, slot contracts, and per-dimension
  narrative across many docs; contradicts the
  adapter-diversity-inside-a-dimension pattern ADR-0024 established.
- **Make the coverage coupling a separate FITNESS_METRICS entry.**
  Rejected: a coverage column dropping below 100% would surface as a
  PF01 metric regression, but the *cause* (the test suite literally
  did not emit a column) is invisible to the gate-level reader. The
  precondition shape inside the adapter (Decision 5) is the only
  shape that catches `coverage_unverifiable`.
- **Source the floor from a CI artifact store (size-limit GitHub
  Action shape, [EXP-03][exp03]) rather than a committed file.**
  Rejected: contradicts the EXP-01 F3 / EXP-03 hybrid recommendation
  (every floor change should be a code-review event); doubles the
  CI cost by requiring the suite to run twice (PR + base); reads as
  "we don't trust agents to land baseline changes" when in fact the
  ratchet's `--update-baseline` escape hatch is exactly the audited
  channel for that.
- **Bake the absolute ceiling into the adapter as a hardcoded
  constant (`absolute_seconds_ceiling = 3` everywhere).** Rejected:
  fork-hostile. A consumer with a real 60-second test suite would
  have to fork the adapter to change the ceiling. The committed
  baseline file is the right surface; the ADR pins the default but
  not the value.
- **Single-shot wall-clock in enforce mode (the prototype's shape).**
  Rejected: the benchmarking tradition settled the noise question;
  flaking the gate on CI variance would undermine the ratchet's
  credibility and trigger the `--update-baseline` escape hatch
  whenever a flake fires (defeating the whole point of the ratchet).
- **Skip the coverage-coupling rule and accept the
  "literature-acknowledged but un-tooled" gap.** Rejected: the
  operator's brief makes the rule mandatory; the EXP-01 finding
  identifies it as the highest-leverage idea in the sensor; the
  prototype's defects (EXP-04) show exactly why a *partial* version
  of the rule is worse than none — it gives false confidence.

### Test plan (and how the change is verified)

`harness/sensors/tests/suite-duration.test.mjs` (new) — pinned cases:

- `parseCoverage: returns explicit columns; never falls back to 100` —
  the EXP-04 defect (1) regression test. Feeds a coverage output
  missing the `branches` column and asserts the parser returns
  `{branches: undefined}`, NOT `{branches: 100}`.
- `evaluateCoverage: missing column emits coverage_unverifiable
  violation` — proves the absent-column path hard-fails.
- `evaluateCoverage: column below floor emits coverage_below_floor
  violation` — proves the real-regression path hard-fails.
- `evaluateCoverage: violation is fatal in advisory mode` — the
  EXP-04 defect (2) regression test. Asserts advisory mode exits
  non-zero on a coverage violation even though a sibling timing
  violation in the same run would have been downgraded to WARN.
- `runIterations: enforce mode runs N iterations; advisory mode may
  short-circuit at 1` — proves the multi-iteration contract.
- `runIterations: emits both median and p95` — proves the report
  envelope shape (Decision 6 + envelope schema above).
- `gateThresholds: hybrid ceiling = max(p95 * 1.25, absolute_ceiling)` —
  proves Decision 4.
- `gateThresholds: improvement triggers ratchet on
  duration_p95_seconds (direction max)` — end-to-end ratchet
  tightening for the timing metric.
- `gateThresholds: iteration_count drop is a regression (direction
  min)` — proves the silent-erosion guard.
- `endToEnd: real coverage regression (deleted assertion) hard-fails
  in both modes` — the operator's "re-prove against a real
  regression" demo, captured as a test that performs the
  delete-the-assertion / re-run / restore-the-assertion sequence
  against the fixture suite.
- `endToEnd: sensor code itself is 100% covered` — operator hard
  rule (4); CI asserts the adapter's own coverage via the standard
  workspace coverage gate.

The PR body (Decision 5 + 6 demos) will carry the verbatim adapter
output of: (a) a pass run; (b) the deleted-assertion fail run in
enforce mode; (c) the SAME deleted-assertion run in advisory mode
showing the coverage violation is STILL fatal.

### Backlinks

Code, docs, and manifests that should reference this ADR when the
sensor and the ADR land in the same PR:

- `harness/sensors/suite_duration.mjs` — header comment cites
  ADR-0025 + ADR-0020 + ADR-0019 lineage.
- `harness/sensors/suite-duration-baseline.json` — first line of
  `notes` cites ADR-0025.
- `harness/sensors/tests/suite-duration.test.mjs` — the proof.
- `harness/sensors/gate.mjs` — header comment cites ADR-0025
  alongside the existing ADR-0017 / ADR-0019 / ADR-0020 lineage; the
  two new `FITNESS_METRICS.PF01` entries carry inline ADR pointers.
- `harness/sensors/baseline.json` — `dimensions.PF01.metrics` gains
  two entries; the `objective` field on each cites ADR-0025.
- `harness.manifest.json#slots.sensors.implementation` — append
  "PF01 watches startup wall-clock AND test-suite wall-clock per
  ADR-0025."
- `AGENTS.md` (and its `CLAUDE.md` / `.codex` / `.gemini` symlinks)
  — short note: "PF01 watches startup-time AND test-suite duration.
  Suite duration has a HARD coverage precondition that advisory
  mode does not soften. See ADR-0025."
- `docs/sensors/coverage-and-gate.md` — update to describe the new
  metric pair + the coverage-coupling rule.
- `docs/sensors/closed-loop.md` — append the new metric pair to the
  PF01 row of the dimensions table.
- `docs/sensors/fitness-timing-and-placement.md` — note that
  suite-duration runs at the CI tier (same rationale as ADR-0024).

### Sources

- [ADR-0006 — Sensors](./ADR-0006-sensors.md) — the original sensors
  slot; preserved.
- [ADR-0017 — Sensors v0.3 — APSS canonical, sentrux preserved](./ADR-0017-sensors-v03-apss-canonical.md)
  — the shim-seam decision; preserved.
- [ADR-0018 — APSS v1.1.0 integration — augment, never replace](./ADR-0018-apss-v1-1-0-augmentation.md)
  — the routing-via-shim decision; preserved.
- [ADR-0019 — Closed-loop architectural quality](./ADR-0019-closed-loop-architectural-quality.md)
  — the closed-loop framing this metric joins.
- [ADR-0020 — Architectural-fitness ratchet](./ADR-0020-architectural-fitness-ratchet.md)
  — the direction-aware ratchet this metric pair plugs into.
- [ADR-0024 — Dead-Code Ratchet](./ADR-0024-dead-code-ratchet.md)
  — the most recent precedent for adding a new reading to an
  existing dimension; shape borrowed verbatim.
- [`syntropic137/fitness-timing-lab`][lab] — the validated design
  this ADR ports. Specifically:
  - [`experiments/EXP-01-prior-art.md`][exp01] — prior-art and
    theory; F2 (size-limit headroom rule), F3
    (commit-the-baseline), H5 (coverage-coupling gap), H7
    (statistical baselining), F4 (negative result on SLO
    advisory→enforce literature → cite ADR-0020 instead).
  - [`experiments/EXP-02-prototype.md`][exp02] — the runnable
    prototype.
  - [`experiments/EXP-03-tooling-survey.md`][exp03] — the six-tool
    survey converging on the hybrid pattern.
  - [`experiments/EXP-04-cross-review.md`][exp04] — the verdict +
    the two defect callouts this port fixes.
  - [`FRICTION.md`][friction] — lab agents' friction record.
  - [`prototype/suite-performance-sensor.mjs`][proto] — the
    proof-of-mechanism prototype. The port preserves the
    measurement shape and fixes `:220-228` (silent-100% fallback)
    and `:111-124` (advisory mode softening coverage).
- [Fowler, *Continuous Integration*][fowler-ci] — the XP
  ten-minute-build rule the absolute ceiling defaults around.
- [Fowler, *Test Coverage*][fowler-cov] — the
  "100%-coverage-is-suspicious" caution. This sensor's coupling
  enforces a 100% *floor*, not a target — the distinction matters:
  forks that legitimately ship at 80% coverage configure the floor
  to 80%; the sensor enforces "the floor you committed to," not "a
  universal 100% rule".
- [Fowler, *The Practical Test Pyramid*][fowler-pyramid] — the
  speed/coverage reconciliation via tiered pipelines; informs the
  multi-iteration measurement contract.
- [Ottinger & Langr, *FIRST*][first] — the per-test threshold
  ("a test that takes a second or more is impossibly slow")
  motivating the `absolute_seconds_ceiling` default range.
- [Ford, Parsons & Kua, *Building Evolutionary Architectures*][ea] —
  the fitness-function taxonomy (atomic / triggered / dynamic /
  automated) the metric pair occupies.
- [size-limit][size-limit] — the "current + 25%" headroom rule the
  `relative_delta_percent` default mirrors.
- [betterer][betterer] — the committed-ratchet pattern; same shape
  as ADR-0020 and `.betterer.results`.
- [AndroidX Macrobenchmark][androidx] — the iterations=5 default
  the multi-iteration measurement matches.

### When to re-evaluate

- A consumer fork reports that a 5-minute CI wall-clock cost (5
  iterations × ~60s suite) is too expensive. Re-evaluate whether the
  baseline's `iteration_count` should default lower for large
  suites, or whether the enforce-mode tier should add an
  every-N-th-commit cadence option.
- A test framework emerges whose coverage output cannot be parsed
  by the current adapter (a binary format, a remote-only reporter).
  Extend the parser; the shape is decoupled enough that the
  `coverage_floor_metrics` array can grow.
- The 25% relative-delta default produces too many flake-driven
  failures on shared CI runners with high neighbor-tenant variance.
  Re-evaluate the headroom; the schema is per-fork configurable, so
  the change is a baseline edit, not an ADR change.
- The literature-acknowledged-but-un-tooled coverage-coupling gap
  closes upstream (a future betterer / size-limit feature, a Jest /
  Vitest plugin). Re-evaluate whether the in-tree adapter should
  delegate, or whether the operator-mandated rule justifies keeping
  the in-tree implementation as the authoritative gate.
- The PF01 dimension grows a third reading (e.g., end-to-end
  journey duration). The dimension-vs-adapter decision (1) holds:
  add another adapter under PF01, do not split.

[lab]: https://github.com/syntropic137/fitness-timing-lab
[exp01]: https://github.com/syntropic137/fitness-timing-lab/blob/main/experiments/EXP-01-prior-art.md
[exp02]: https://github.com/syntropic137/fitness-timing-lab/blob/main/experiments/EXP-02-prototype.md
[exp03]: https://github.com/syntropic137/fitness-timing-lab/blob/main/experiments/EXP-03-tooling-survey.md
[exp04]: https://github.com/syntropic137/fitness-timing-lab/blob/main/experiments/EXP-04-cross-review.md
[friction]: https://github.com/syntropic137/fitness-timing-lab/blob/main/FRICTION.md
[proto]: https://github.com/syntropic137/fitness-timing-lab/blob/main/prototype/suite-performance-sensor.mjs
[adr19]: ./ADR-0019-closed-loop-architectural-quality.md
[adr20]: ./ADR-0020-architectural-fitness-ratchet.md
[adr24]: ./ADR-0024-dead-code-ratchet.md
[fowler-ci]: https://martinfowler.com/articles/continuousIntegration.html
[fowler-cov]: https://martinfowler.com/bliki/TestCoverage.html
[fowler-pyramid]: https://martinfowler.com/articles/practical-test-pyramid.html
[first]: https://agileinaflash.blogspot.com/2009/02/first.html
[ea]: https://www.oreilly.com/library/view/building-evolutionary-architectures/9781491986356/
[size-limit]: https://github.com/ai/size-limit
[betterer]: https://github.com/phenomnomnominal/betterer
[androidx]: https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview
