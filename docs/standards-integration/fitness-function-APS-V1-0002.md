# Fitness Functions: harness/sensors gate vs. APSS APS-V1-0002

> **Status:** research and proposal. **Do not** change the working sensors
> gate based on this document. Treat the recommendation below as the
> opening position for an ADR (the next, separate, deliberate step).
>
> **Tracking bead:** `create-harness-app-q9w` (in_progress).

## 0. TL;DR

* The harness already implements a `fitness.toml`-shaped gate in
  [`harness/sensors/gate.mjs`](../../harness/sensors/gate.mjs) and a
  baseline in [`harness/sensors/baseline.json`](../../harness/sensors/baseline.json)
  that self-declares `standard = "APS-V1-0002"` and `schema_version = "1.0.0"`.
  All 8 dimensions are present.
* The standard (APSS [PR 63](https://github.com/AgentParadise/agent-paradise-standards-system/pull/63),
  branch `apss_fitness-standard`) marks **only MT01 and MD01 active**.
  The other 6 are `incubating` and **must** downgrade `error`-severity rules
  to `warning` (spec §3.4, error code `INCUBATING_DIMENSION_ERROR_DOWNGRADED`,
  §12).
* The harness manifest in `gate.mjs` declares **6** of the 8 dimensions
  `active + enforced` (MT01, MD01, ST01, SC01, LG01, PF01). Only AC01 and
  AV01 are advisory.
* Strict adoption of the standard would therefore **downgrade 4
  enforced harness dimensions to advisory-only** (ST01, SC01, LG01, PF01)
  and trip the standard's `PROMOTION_REQUIREMENT_UNMET` diagnostic on the
  same 4. This is the operator's central decision.
* Gaps to formally conform: a `fitness.toml` rule registry, a
  `fitness-exceptions.toml` per-entity ratchet with issue references, a
  `fitness-report.json` matching the §7 shape, and three published JSON
  Schemas (config, exceptions, report). The producer artifacts
  (`functions.json`, `modules.json`, `coupling.json`) are already
  consumed; their schemas are owned by APS-V1-0001, not by us.
* Recommended stance: **adopt the standard's vocabulary and artifact
  contracts; keep the harness enforcement posture; record the divergence
  in an ADR and upstream a promotion proposal for ST01/SC01/LG01/PF01
  via R1 to R5 (§3.3) backed by the harness adapters.** Tradeoffs in §6.

## 1. Sources

Primary (the standard, branch `apss_fitness-standard` on PR 63):

* [`docs/01_spec.md`](https://github.com/AgentParadise/agent-paradise-standards-system/blob/apss_fitness-standard/standards/v1/APS-V1-0002-architecture-fitness/docs/01_spec.md)
  (1063 lines, normative).
* [`docs/02_metrics-catalog.md`](https://github.com/AgentParadise/agent-paradise-standards-system/blob/apss_fitness-standard/standards/v1/APS-V1-0002-architecture-fitness/docs/02_metrics-catalog.md)
  (703 lines, normative reference).
* [`schemas/fitness-config.schema.json`](https://github.com/AgentParadise/agent-paradise-standards-system/blob/apss_fitness-standard/standards/v1/APS-V1-0002-architecture-fitness/schemas/fitness-config.schema.json)
  (251 lines, Draft 2020-12).
* [`schemas/fitness-exceptions.schema.json`](https://github.com/AgentParadise/agent-paradise-standards-system/blob/apss_fitness-standard/standards/v1/APS-V1-0002-architecture-fitness/schemas/fitness-exceptions.schema.json).
* [`schemas/fitness-report.schema.json`](https://github.com/AgentParadise/agent-paradise-standards-system/blob/apss_fitness-standard/standards/v1/APS-V1-0002-architecture-fitness/schemas/fitness-report.schema.json).
* [`examples/fitness.toml`](https://github.com/AgentParadise/agent-paradise-standards-system/blob/apss_fitness-standard/standards/v1/APS-V1-0002-architecture-fitness/examples/fitness.toml),
  [`examples/fitness-exceptions.toml`](https://github.com/AgentParadise/agent-paradise-standards-system/blob/apss_fitness-standard/standards/v1/APS-V1-0002-architecture-fitness/examples/fitness-exceptions.toml),
  [`examples/fitness-report.json`](https://github.com/AgentParadise/agent-paradise-standards-system/blob/apss_fitness-standard/standards/v1/APS-V1-0002-architecture-fitness/examples/fitness-report.json).
* Sibling schemas owned by APS-V1-0001 (the measurement layer this
  standard composes with): [`functions.schema.json`](https://github.com/AgentParadise/agent-paradise-standards-system/blob/apss_fitness-standard/standards/v1/APS-V1-0001-code-topology/schemas/functions.schema.json),
  [`modules.schema.json`](https://github.com/AgentParadise/agent-paradise-standards-system/blob/apss_fitness-standard/standards/v1/APS-V1-0001-code-topology/schemas/modules.schema.json),
  [`coupling.schema.json`](https://github.com/AgentParadise/agent-paradise-standards-system/blob/apss_fitness-standard/standards/v1/APS-V1-0001-code-topology/schemas/coupling.schema.json).

Secondary (the harness implementation in this repo):

* [`harness/sensors/gate.mjs`](../../harness/sensors/gate.mjs):
  `DIMENSION_ORDER`, `DIMENSIONS`, and `FITNESS_METRICS` at
  `gate.mjs:35-268`; `extractApssFitnessBaseline` at `gate.mjs:407-436`;
  `compareFitnessBaseline` at `gate.mjs:497-594`; `compareBaseline`
  back-compat wrapper at `gate.mjs:601-621`.
* [`harness/sensors/baseline.json`](../../harness/sensors/baseline.json):
  the committed floor.
* [`harness/sensors/apss_topology.mjs`](../../harness/sensors/apss_topology.mjs):
  the APSS adapter that consumes `.topology/metrics/*.json`.
* [`harness/sensors/README.md`](../../harness/sensors/README.md).
* [`docs/adrs/ADR-0006-sensors.md`](../adrs/ADR-0006-sensors.md) (slot pick).
* [`docs/adrs/ADR-0017-sensors-v03-apss-canonical.md`](../adrs/ADR-0017-sensors-v03-apss-canonical.md)
  (APSS canonical, sentrux preserved).
* [`docs/harness-engineering/references/thoughtworks-architectural-fitness-function.md`](../harness-engineering/references/thoughtworks-architectural-fitness-function.md)
  (Ford et al. lineage reference).

Methodological lineage cited by the standard and inherited here: Ford,
Parsons, Kua (2017) *Building Evolutionary Architectures*; McCabe (1976);
SonarSource cognitive complexity (2017); Halstead (1977); Martin (1994,
2003); Chidamber and Kemerer (1994); ArchUnit FreezingArchRule ratchet
pattern; dependency-cruiser rule model.

## 2. The standard at a glance

APS-V1-0002 promotes EXP-V1-0003 to official status. It defines:

1. **A dimensional governance model** with 8 dimensions (§3.1). Each
   dimension is identified by a 4-character code, owned by a substandard,
   and carries two orthogonal classifications: `status` (`active`,
   `incubating`, `deprecated`) and `default` (`default-enabled` or
   `opt-in`).
2. **Five promotion requirements R1 to R5** (§3.3): objective metric,
   computable algorithm, JSON Schema, recommended defaults with
   citations, non-stub reference implementation. A dimension that misses
   any requirement is `incubating`.
3. **Lifecycle semantics** (§3.4): rules on `incubating` dimensions run
   advisory-only; configured `error` severities are silently downgraded
   to `warning` with an `INCUBATING_DIMENSION_ERROR_DOWNGRADED`
   diagnostic emitted per rule. `incubating` dimensions cannot cause
   exit code 1.
4. **Three artifact contracts**, each with a published JSON Schema in
   `schemas/`:
    * `fitness.toml` rule registry (`fitness-config.schema.json`, §4).
    * `fitness-exceptions.toml` per-entity ratchet (`fitness-exceptions.schema.json`,
      §5). Every exception **must** carry an `issue` field; absence
      yields `MISSING_ISSUE_REF`.
    * `fitness-report.json` per-dimension and composite report
      (`fitness-report.schema.json`, §7).
5. **Producer artifact contracts** owned upstream by APS-V1-0001:
   `.topology/metrics/functions.json`, `modules.json`, `coupling.json`
   with the three published schemas listed in §1. The fitness standard
   composes with the topology standard via the schemas, not via private
   shapes.
6. **A system-level fitness function** (§6): a weighted composite of
   per-dimension scores in `[0.0, 1.0]`, with `min_score` (default
   `0.7`), a fail-on-below-threshold exit, weights that must sum to
   `1.0`, and per-dimension trend deltas. Only `active` dimensions
   contribute by default; `include_incubating = true` lets `incubating`
   dimensions count toward the composite (but still cannot cause exit
   code 1).
7. **Per-dimension scoring** (§6.2):
   `dimension_score = 1.0 - (unexcepted_violations / total_entities_evaluated)`.
8. **Exit codes** (§8.7): `0` clean, `1` any error severity or composite
   below `min_score`, `2` warnings only.
9. **An adapter contract** (§9) for the anti-corruption layer between
   external scanners (cargo-audit, cargo-deny, axe-core, k6, etc.) and
   the rule engine.

Per Appendix D the standard's own implementation status is:

| Dim  | Status     | Producer / Blocker (per Appendix D)                                                                                                                                  |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MT01 | active     | APSS `functions.json` (LANG01-rust); reference crate `architecture-fitness-mt01`.                                                                                    |
| MD01 | active     | APSS `coupling.json` (LANG01-rust); reference crate `architecture-fitness-md01`.                                                                                     |
| ST01 | incubating | structural patterns ready; CK metrics blocked on a class-level analyzer; no `structural-rule` schema; substandard crate is a stub.                                   |
| SC01 | incubating | adapter framework declared but not invoked; `builtin:cargo-audit` not implemented; no `adapter-output.schema.json`; stub crate.                                      |
| LG01 | incubating | adapter framework not implemented; `builtin:cargo-deny` not implemented; stub crate.                                                                                 |
| AC01 | incubating | adapter framework not implemented; no normalizer; stub crate.                                                                                                        |
| PF01 | incubating | adapter framework not implemented; no normalizer; stub crate; project-specific defaults (no universal citation).                                                     |
| AV01 | incubating | adapter framework not implemented; no normalizer; stub crate; project-specific SLO targets.                                                                          |

Key reading: APSS does not say "ST01 / SC01 / LG01 / PF01 are
unmeasurable." It says **the APSS reference implementation has not yet
satisfied R1 to R5 for those dimensions**. R2 explicitly allows "a
registered adapter with an implemented normalizer" as the producer, not
only a native APSS standard. This is the lever the harness can use (§6).

## 3. What the harness already conforms to

The harness sensors slot is in fact a working fitness-function gate
predating the standard's formalization. Concrete conformance points:

### 3.1 Dimensional registry

`harness/sensors/gate.mjs:33-92` declares all 8 dimensions in
`DIMENSION_ORDER` with the same 4-character codes the standard uses
(MT01, MD01, ST01, SC01, LG01, AC01, PF01, AV01). Each dimension records
a `name`, `promotion_status`, `enforcement`, and `default`, matching the
field set in APSS §3.1 and §7.3.

### 3.2 Metric catalog

`harness/sensors/gate.mjs:94-268` declares a per-dimension metric set
with `id`, `name`, `objective`, `source` (the artifact path or adapter
identifier), `direction` (`max` or `min`), `default_threshold`, and a
`value(report, options)` extractor. The metric set covers:

* **MT01:** `max-cognitive`, `max-cyclomatic`, `max-halstead-volume`.
  Defaults `15`, `10`, `1000` align with APSS §1.1 to §1.5 of the
  metrics catalog and with the sample `fitness.toml` (lines 40-71).
* **MD01:** `max-fan-out` (Ce), `max-main-sequence-distance` (Martin D),
  `instability-out-of-range-count`. Defaults `20`, `0.7`, and the
  `[0.1, 0.9]` instability window match §2 of the metrics catalog.
* **ST01:** `circular-dependency-edges` from `workspace.circular_edges`
  in the aggregate report.
* **SC01:** `critical-finding-count` from `ubs --report-json`
  (`totals.critical`).
* **LG01:** `denied-license-count` from `harness/sensors/license_scan.mjs`.
* **AC01, AV01:** `null`-emitting advisory metrics with explicit
  "advisory-by-design" documentation tied to the static-template fact.
* **PF01:** `startup-benchmark-mean` and `startup-benchmark-count` from
  `harness/perf/baseline.json`.

### 3.3 Baseline and ratchet

[`baseline.json`](../../harness/sensors/baseline.json) self-declares
`standard: "APS-V1-0002"`, `schema_version: "1.0.0"`, and a per-dimension
metric floor with `direction`, `default_threshold`, `baseline`, and
`fail_on_regression`. The floor is a ratchet (write-once on first run;
subsequent updates require an explicit `gate --update-baseline` flag and
a deliberate commit). This is the same semantic intent as the APSS
ratchet (§5.3), at coarser granularity (per metric instead of per
entity-and-rule).

### 3.4 Incubating downgrade diagnostic

`harness/sensors/gate.mjs:559-569` already emits the
`INCUBATING_DIMENSION_ERROR_DOWNGRADED` diagnostic, exactly the error
code APSS prescribes in §12. The harness's enforced-vs-advisory split
inside the report (`gate.mjs:572-583`) tracks `rules_evaluated`,
`rules_failed`, `rules_warned`, `rules_missing_baseline`, mirroring the
APSS dimension result fields in §7.3.

### 3.5 APSS topology consumption

`harness/sensors/apss_topology.mjs` reads three APSS-canonical artifacts
(`modules.json`, `functions.json`, `coupling.json`) when present. Tier 1
flat coupling fields (`afferent_coupling`, `efferent_coupling`,
`instability`, `abstractness`, `distance_from_main_sequence`) are
hoisted into a per-module `.apss` sub-object so legacy
dependency-cruiser readings remain available as fallback. This is the
exact composition APSS §1.3 describes (APS-V1-0001 measures; APS-V1-0002
asserts). The adapter design rationale lives in
[ADR-0017](../adrs/ADR-0017-sensors-v03-apss-canonical.md).

### 3.6 Human-readable report

`harness/sensors/gate.mjs:628-720` renders a per-dimension summary that
groups by `[ENFORCED]` and `[advisory]` and prints per-metric
`baseline -> current (+delta)` lines. This is roughly the §6.4 tradeoff
view of the standard, minus the composite score and the bar chart.

### 3.7 Conformance summary table

| Standard area                                                  | Harness state    | Reference                                                                                                                              |
| -------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 8-dimension registry with 4-character codes                    | Conforms         | `gate.mjs:33-92`                                                                                                                       |
| Per-dimension metric catalog with objectives and defaults      | Conforms         | `gate.mjs:94-268`                                                                                                                      |
| APSS topology consumption (`functions.json`, `coupling.json`)  | Conforms         | `apss_topology.mjs`                                                                                                                    |
| Ratchet semantics (write-once floor, explicit update flag)     | Conforms in spirit; per-metric not per-entity | `gate.mjs:443-495`, `baseline.json`                                                                                                    |
| `INCUBATING_DIMENSION_ERROR_DOWNGRADED` diagnostic             | Conforms (emitted on advisory regressions) | `gate.mjs:559-569`                                                                                                                     |
| Per-dimension `runtime_status`, `promotion_status`, `enforcement` fields | Conforms        | `gate.mjs:572-583`                                                                                                                     |
| Tradeoff-visible report                                        | Conforms in spirit; text only, no composite | `gate.mjs:651-680`                                                                                                                     |
| `fitness.toml` rule registry                                   | **Missing**      | rule catalog is hardcoded in JS                                                                                                        |
| `fitness-exceptions.toml` with `issue` field                   | **Missing**      | exceptions are the baseline floor itself                                                                                               |
| `fitness-report.json` matching §7                              | **Missing**      | only the human renderer is implemented                                                                                                 |
| Three JSON Schemas (config, exceptions, report)                | **Missing**      |                                                                                                                                        |
| System-level composite score in `[0.0, 1.0]` with `min_score`  | **Missing**      | gate is regression-detect, not composite-threshold                                                                                     |
| Per-dimension `score = 1 - violations/total`                   | **Missing**      | gate counts regressions per metric, not violations per entity                                                                          |
| Adapter registration contract (`[[adapters]]`)                 | **Missing**      | adapters are hardcoded in `bin/sensors`                                                                                                |

## 4. Concrete gaps to formally adopt the standard

Listed cheapest-first. None require ripping out the working gate; all
are additive.

### 4.1 Publish `fitness.toml` and validate against the schema

* Write `fitness.toml` at the repository root by emitting from the
  `FITNESS_METRICS` table in `gate.mjs`. Treat the JS catalog as the
  source of truth for now; the TOML is a generated mirror until §4.5
  flips the polarity.
* Validate `fitness.toml` against
  [`fitness-config.schema.json`](https://github.com/AgentParadise/agent-paradise-standards-system/blob/apss_fitness-standard/standards/v1/APS-V1-0002-architecture-fitness/schemas/fitness-config.schema.json)
  on every gate run. A divergent TOML is a build failure.

### 4.2 Publish `fitness-exceptions.toml` with issue references

* Introduce a per-entity exception layer above the per-metric baseline.
  When a single function or module is the only thing keeping a metric
  above its `default_threshold`, allow an explicit per-entity exception
  with a mandatory GitHub issue reference (per §5.2). The current
  baseline-floor model continues to work; exceptions tighten it.
* Pull the existing per-dimension write-once floor into APSS terms by
  treating the floor's `baseline` as the metric-level budget that an
  exception can specialize per entity.

### 4.3 Emit `fitness-report.json` matching §7

* Add `harness/sensors/report.mjs` (or extend `gate.mjs`) to emit
  `fitness-report.json` alongside the existing human renderer. The
  required fields are all already computed inside `compareFitnessBaseline`;
  the work is structural.
* Validate the report against
  [`fitness-report.schema.json`](https://github.com/AgentParadise/agent-paradise-standards-system/blob/apss_fitness-standard/standards/v1/APS-V1-0002-architecture-fitness/schemas/fitness-report.schema.json)
  before writing.

### 4.4 Vendor or pin the three APS-V1-0002 schemas

* Vendor under `harness/sensors/schemas/` (or fetch on bootstrap and
  cache). Pin to a specific APSS commit so a schema bump is a deliberate
  bead, not a silent CI break.
* Wire schema validation into `bin/sensors` so a malformed config or a
  malformed report aborts the run with a precise error message rather
  than a downstream gate-evaluation crash.

### 4.5 Move the rule catalog from JS to TOML

* Once §4.1 and §4.3 are stable, flip the source of truth: keep
  `gate.mjs` as the evaluator, but load the rule catalog from
  `fitness.toml`. The JS extractors (`value(report, options)`) become a
  registry keyed by `rule.id` rather than the rule definitions
  themselves. This is the change that makes the dimensions
  user-configurable in consumer forks without editing JS.

### 4.6 Add system-level composite scoring (§6)

* Implement `dimension_score = 1.0 - (unexcepted_violations / total_entities_evaluated)`
  per §6.2. For metric-based regression gates this is straightforward:
  each evaluated metric is one "entity" and a regression is the one
  violation.
* Wire `[system_fitness]` with `enabled = true`, `min_score = 0.7` by
  default (matching the §6.1 example), and the §6.4 dimension weights
  per consumer fork.
* Add the composite fail to the gate's exit-code policy (§8.7): exit
  `1` if score below `min_score` or any active-dimension error; exit
  `2` if warnings only and composite passing.

### 4.7 Make the producer artifacts a hard input contract

* The harness already consumes `.topology/metrics/{functions,modules,coupling}.json`.
  The standard treats these as the canonical R2/R3 inputs for MT01 and
  MD01 (Appendix D rows). What is missing here:
    * The harness does not require the artifacts. They are best-effort.
      For full conformance the artifacts should be required when any
      MT01 or MD01 rule is enabled.
    * The harness validates the artifacts at the field level only
      (numeric or null). It should also validate them against the three
      APS-V1-0001 schemas published under
      `standards/v1/APS-V1-0001-code-topology/schemas/`.
* Producing these artifacts in the harness's polyglot workspace is a
  separate ADR (the lab decision in ADR-0017 keeps APSS canonical but
  defers the production wiring); §4.7 is the schema-validation half
  only.

### 4.8 Adapter contract (`[[adapters]]`)

* SC01, LG01, PF01 have adapters already (UBS, `license_scan.mjs`,
  hyperfine). Wrap them as §9.3 adapter registrations so a consumer
  fork can swap or extend without editing `bin/sensors`. The wrapping is
  ergonomic, not load-bearing for conformance: the standard's adapter
  contract is informative for the rule engine. The harness already
  satisfies the underlying contract (normalize tool output into the §9.2
  wrapped-artifact format).

## 5. The key tension: enforcement posture

The harness `gate.mjs` declares **6 of 8** dimensions `active + enforced`:

| Code | Harness `promotion_status` | Harness `enforcement` | APSS Appendix D `status` |
| ---- | -------------------------- | --------------------- | ------------------------ |
| MT01 | `active`                   | `enforced`            | **active**               |
| MD01 | `active`                   | `enforced`            | **active**               |
| ST01 | `active`                   | `enforced`            | incubating               |
| SC01 | `active`                   | `enforced`            | incubating               |
| LG01 | `active`                   | `enforced`            | incubating               |
| AC01 | `incubating`               | `advisory`            | incubating               |
| PF01 | `active`                   | `enforced`            | incubating               |
| AV01 | `incubating`               | `advisory`            | incubating               |

Strict adoption of the standard fires two normative errors at the
harness's current manifest (per §12):

1. **`PROMOTION_REQUIREMENT_UNMET`** on ST01, SC01, LG01, PF01: those
   dimensions are declared `active` but Appendix D row records them as
   `incubating` and at least one of R1 to R5 unmet. The standard says
   divergence from Appendix D must produce this error.
2. **`INCUBATING_DIMENSION_ERROR_DOWNGRADED`** on every `error`-severity
   rule under those 4 dimensions: per §3.4 the severities silently
   downgrade to `warning` at evaluation time. The harness rules **cannot
   cause exit code 1** under those 4 dimensions.

The net effect: strict adoption removes hard enforcement for 4
dimensions that the harness today catches with real adapters:

* **ST01 circular-dependency-edges** (dep-cruiser circular detection)
  would become a warning.
* **SC01 critical-finding-count** (UBS critical scan) would become a
  warning.
* **LG01 denied-license-count** (OSI-permissive allowlist scan) would
  become a warning.
* **PF01 startup-benchmark-mean / count** (hyperfine baselines) would
  become a warning.

This is the central asymmetry. The standard's `incubating` rating for
those 4 dimensions reflects the **APSS reference implementation's**
state, not the universe of possible implementations. R2 explicitly
admits "a registered adapter with an implemented normalizer" as a valid
producer. The harness has those normalizers. The standard's Appendix D
column "Producer / Blocker" reads, for example, "Requires (a) adapter
runner in engine, (b) `builtin:cargo-audit` normalizer, (c)
adapter-output schema". The harness has the equivalent in the language
the slot already runs in.

So the operator is being asked to choose between three positions:

1. **Strict APSS adoption.** Mirror Appendix D verbatim; downgrade
   ST01/SC01/LG01/PF01 to advisory in the harness manifest. Gate exit
   code 1 only on MT01 and MD01.
2. **Local manifest override with documented divergence.** Keep the
   harness's enforced 6 of 8 posture. Document the divergence in an
   ADR. Accept that `PROMOTION_REQUIREMENT_UNMET` and the downgrade
   diagnostics will fire under any APSS-native validator pointed at our
   `fitness.toml`. Submit an R1 to R5 disclosure to APSS to promote the
   4 dimensions upstream.
3. **Hybrid: adopt vocabulary and shape; keep enforcement.** Same as
   (2) for the enforcement decision, but additionally adopt every
   APSS-native artifact (fitness.toml, fitness-exceptions.toml,
   fitness-report.json, the three schemas, composite scoring). The
   divergence is then localized to the per-dimension manifest fields
   only, not to the whole framework.

### 5.1 Tradeoffs

| Concern                                  | (1) Strict                                                                                | (2) Local override                                                                                            | (3) Hybrid (vocab + enforcement preserved)                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Real enforcement coverage on day 1       | 2 of 8 dimensions hard-gate                                                              | 6 of 8 dimensions hard-gate                                                                                  | 6 of 8 dimensions hard-gate                                                                                        |
| APSS-native validator green on day 1     | Yes                                                                                       | No (`PROMOTION_REQUIREMENT_UNMET` on 4 dimensions)                                                            | No (same diagnostics as (2))                                                                                        |
| Bug-class coverage today                 | Lose circular-dep, UBS critical, license-deny, perf-regression as hard fails              | Keep all four as hard fails                                                                                  | Keep all four as hard fails                                                                                        |
| Operator decision cost on day 1          | Low (mirror Appendix D)                                                                  | Medium (ADR + upstream R1 to R5 PRs over time)                                                                | Higher (ADR + schemas + report emission + composite, in addition to the upstream PRs)                                |
| Decision can be flipped later            | Yes (re-enable as APSS promotes upstream)                                                 | Yes                                                                                                          | Yes                                                                                                                |
| Risk that an APSS bump will silently     | Low (already mirroring)                                                                  | Medium (Appendix D shape can shift)                                                                          | Low (validating against pinned schemas catches the shift)                                                          |
|   change our gate                        |                                                                                           |                                                                                                              |                                                                                                                    |
| Reads as governance theater to a reviewer who diffs Appendix D against `baseline.json` | No (matches)                                            | Maybe (mismatch without disclosure)                                                                          | No (mismatch is disclosed in an ADR and a `harness_appendix_d_divergence.md`)                                       |

### 5.2 Recommendation

**Stance (3): hybrid. Keep the gate's enforcement posture; adopt the
APSS vocabulary, artifact shapes, schemas, and composite scoring; record
the manifest divergence in an ADR; file an R1 to R5 disclosure upstream
for ST01, SC01, LG01, PF01.**

Reasoning:

* The harness already has working adapters for the 4 contested
  dimensions. Downgrading them to warnings would lose four classes of
  real bugs that the gate catches today (circular deps, UBS critical
  findings, denied licenses, startup regressions). The standard's own
  rationale for `incubating` (§3.3) is "a dimension that cannot
  objectively compute and enforce its metrics offers governance theater,
  not governance." The harness *does* compute and enforce them. Treating
  the harness as `incubating` for those 4 would be a worse fit to the
  spirit of §3.3 than the divergence is.
* Adopting the artifact contracts (fitness.toml, fitness-exceptions.toml,
  fitness-report.json) and validating against the three published
  schemas converts the harness from "a JS gate with opinions" into "an
  APSS-shaped artifact emitter." That is the §3.5.6 lever: an emitted
  fitness-report.json that any APSS-native consumer can read. The
  manifest divergence is then visible *in* the artifact (the report
  records each dimension's `promotion_status` and `enforcement`), not
  hidden behind the gate.
* Upstreaming the R1 to R5 disclosure for the 4 dimensions is the only
  path that closes the divergence properly. The harness can be the
  reference implementation that retires Appendix D's "stub crate" rows.

Out of scope for this proposal:

* Renaming or removing any harness adapter.
* Changing default thresholds. (`gate.mjs` defaults already match the
  standard's industry citations: McCabe 10, SonarSource 15, Martin D
  0.7, instability window [0.1, 0.9], Ce 20.)
* Producing `.topology/metrics/*.json` from inside the harness; the
  measurement layer is APS-V1-0001 and is its own decision.

## 6. Roadmap to formal conformance (proposed)

The order below is the shortest path that never demotes the working
gate.

1. **Vendor and pin the three APS-V1-0002 schemas plus the three
   APS-V1-0001 schemas** under `harness/sensors/schemas/` at a pinned
   APSS commit. Bead suggestion: `create-harness-app-q9w.1`.
2. **Emit `fitness.toml`** by serializing the current `FITNESS_METRICS`
   table. Validate against the config schema on every gate run. The TOML
   is generated; the JS remains source of truth. Bead suggestion:
   `create-harness-app-q9w.2`.
3. **Emit `fitness-report.json`** alongside the human renderer, matching
   §7 fields. Validate against the report schema. Bead suggestion:
   `create-harness-app-q9w.3`.
4. **Write the divergence ADR** (`ADR-NNNN-fitness-functions-aps-v1-0002.md`)
   that records stance (3): adopt the vocabulary, hold the enforcement
   posture, file upstream. Backlink ADR-0006 and ADR-0017. Bead
   suggestion: `create-harness-app-q9w.4`.
5. **File the R1 to R5 disclosure upstream** against PR 63 (or its
   successor) for ST01, SC01, LG01, PF01, citing the harness adapters
   as the producer (R2) and the pinned schemas (R3). Bead suggestion:
   `create-harness-app-q9w.5`.
6. **Introduce per-entity `fitness-exceptions.toml`** with mandatory
   `issue` fields. Keep the per-metric baseline floor as the project-wide
   budget; exceptions specialize it. Bead suggestion:
   `create-harness-app-q9w.6`.
7. **Flip the source of truth** for the rule catalog from JS to TOML
   (rule definitions in TOML; JS extractors keyed by `rule.id`). Bead
   suggestion: `create-harness-app-q9w.7`.
8. **Add system-level composite scoring (§6)** with `min_score = 0.7`
   default, weights from `[system_fitness.weights]`, per-dimension
   tradeoff view, and trend deltas from the previous committed report.
   Bead suggestion: `create-harness-app-q9w.8`.

None of these are blocking until the operator approves the stance.
The deliverable of this bead is the analysis and the recommendation.
The harness's working gate is unchanged.

## 7. Appendix: dimension-by-dimension R1 to R5 disclosure draft

This is the disclosure the harness would submit upstream if the
operator approves stance (3). It is *not* a normative document; it is
the input to an APSS ADR that would re-promote the 4 dimensions.

| Dim  | R1 metric         | R2 producer (harness adapter)                      | R3 schema (pinned)                                                         | R4 default + citation                                              | R5 reference impl path                                                                                                    |
| ---- | ----------------- | -------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| ST01 | circular-edge count over workspace sources | dependency-cruiser (`bin/sensors`, `aggregate.mjs`) | adapter-output (TBD; harness can publish under `harness/sensors/schemas/`) | `0`; ArchUnit / dep-cruiser community default                      | `harness/sensors/gate.mjs:179-191`                                                                                        |
| SC01 | critical CVSS finding count                | UBS (`ubs --report-json totals.critical`)         | adapter-output (TBD; same)                                                  | `0`; CVSS v3 critical threshold per APSS §3 of the metrics catalog | `harness/sensors/gate.mjs:194-204`, `ubsCriticalCount` at `gate.mjs:297-321`                                              |
| LG01 | denied-license count over installed packages | `harness/sensors/license_scan.mjs` OSI-permissive allowlist | adapter-output (TBD; same)                                                  | `0`; FSF / OSI / SPDX permissive categories                        | `harness/sensors/gate.mjs:207-217`, `licenseDeniedCount` at `gate.mjs:330-351`                                            |
| PF01 | startup benchmark mean and benchmark count | hyperfine baseline (`harness/perf/baseline.json`) | adapter-output (TBD; same)                                                  | per-project; ADR-driven                                            | `harness/sensors/gate.mjs:233-253`, `perfBenchmarkMeans` at `gate.mjs:360-375`                                            |

The R4 row for PF01 is the spot where APSS Appendix D's "no universal
citation" objection holds. The proposed APSS framing is: per-project
defaults are admissible when the substandard declares its defaults
via an ADR (the same escape hatch APSS already uses for AV01).

## 8. Open questions for the operator

* Does the harness adopt stance (3), or hold for an updated APSS
  Appendix D row that promotes ST01/SC01/LG01/PF01 first? (The R1 to
  R5 disclosure is symmetric work either way; the difference is
  whether the ADR or the upstream PR lands first.)
* Should the per-metric baseline floor in `baseline.json` survive once
  per-entity `fitness-exceptions.toml` exists, or should the floor
  collapse to per-entity exceptions? Recommendation in §4.2: keep both.
  The floor is the project-wide budget; exceptions specialize it.
* Does the operator want the harness to **produce** the APS-V1-0001
  topology artifacts (`functions.json`, `modules.json`, `coupling.json`)
  in this template, or to leave production to APSS itself? The current
  posture (consume when present; fall back to dependency-cruiser /
  ts-morph) was set by ADR-0017 and is unchanged by this proposal.
