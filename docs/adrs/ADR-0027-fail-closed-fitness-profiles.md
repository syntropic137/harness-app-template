---
name: "Fail-closed fitness gate — profile-based required adapters, no silent skips"
description: "Replace the gate's two-state (number → evaluate / null → silent-skip → pass) reading model with a four-state model evaluated against an environment profile. A null reading from an adapter that the active profile marks required is a HARD FAIL (generalizing the CV01 coverage hard-contract to every adapter); a null reading from a non-required adapter PASSES but emits a loud, machine-readable warning; advisory-by-design exemptions stay a quiet declared-N/A state. Default profile is `strict` (all adapters required) so an unconfigured environment fails safe."
status: accepted
---

<!--
ADR-0027 — extends ADR-0019 / ADR-0020 / ADR-0024 / ADR-0025 and the
ADR-0017 APSS-canonical sensors posture. Sensors slot only. This ADR
pins the four-state reading taxonomy, the profile schema in
governance.toml, the default-strict rule, the selection precedence, and
the loud-skip output contract. It does NOT change any individual
metric's direction or baseline; it changes what happens when an adapter
cannot produce a reading at all. Motivated by a live finding: a fresh
checkout with no apss binary and no sentrux installed ran the gate to a
green PASS while silently skipping 20 metrics (god-file / hotspot /
complex-fn / apss-topology-derived). A fitness gate that cannot tell
"0 god-files" from "the god-file detector never ran" is not enforcing.
-->

# ADR-0027: Fail-closed fitness gate — profile-based required adapters, no silent skips

**Date:** 2026-06-16
**Category:** sensors slot (harness/sensors/gate.mjs, harness/.harness/governance.toml, FITNESS_METRICS, .github/workflows/test.yml)
**Supersedes:** none (extends [ADR-0019](./ADR-0019-closed-loop-architectural-quality.md), [ADR-0020](./ADR-0020-architectural-fitness-ratchet.md); generalizes the CV01 hard-contract introduced alongside [ADR-0013](./ADR-0013-coverage-enforcement.md) / [ADR-0025](./ADR-0025-coverage-ratchet.md))
**Next review:** 2026-12-16

## Context

The APSS 8/9-dimension fitness gate (`harness/sensors/gate.mjs`, reading
`harness/sensors/baseline.json`) evaluates each metric in one of **two**
states today:

1. The adapter produced a **number** → compare against the committed
   baseline via the ADR-0020 direction-aware ratchet.
2. The adapter produced **`null`** ("no reading") → the metric is
   skipped and does **not** fail the gate.

State 2 exists for a legitimate reason: the template is designed to
"degrade cleanly" — a fork that ships no rendered frontend has nothing
for the a11y adapter to scan, and a fresh clone that has not yet run
`apss install` or installed `sentrux` has no topology / sentrux data.
Soft-skipping those keeps the gate runnable everywhere.

**The defect:** state 2 is indistinguishable from success. A live
checkout of this template — no `.apss/bin/apss`, `sentrux` not on
`PATH`, no `.sentrux/baseline.json`, no `.topology/` — runs the gate to:

```
VERDICT: PASS sensors gate
APSS fitness: 5/7 enforced dimensions actively gating; ... 20 missing baseline(s).
```

A green PASS while **20 enforced metrics never ran**, including the
god-file / file-size enforcement (`sentrux-god-file-count`,
`fail_on_regression: true`). The gate cannot distinguish "the god-file
detector found zero god-files" from "the god-file detector was never
invoked." That is a hollow pass, and it is **not** a local-only problem:
CI only reports full enforcement because its `apss install` and
`install-sentrux.sh` steps *happen* to succeed. If either silently
degrades, CI goes green through the identical skip. The integrity hole
is global; the standard is enforcing by luck, not by contract.

Exactly one metric already does the right thing: **CV01 (coverage)** is
a *hard contract* — when coverage is explicitly requested but
unavailable/malformed, the gate records a **hard regression, not "no
reading."** This ADR generalizes that single-metric pattern to every
adapter.

## Decision

### 1. Four-state reading taxonomy

Every metric reading resolves to exactly one state, evaluated against
the **active profile** (§2):

| State | Condition | Gate behavior |
|---|---|---|
| **Measured** | adapter ran, emitted a finite number | Evaluate against baseline (ADR-0020 ratchet) — **unchanged** |
| **Required-but-missing** | reading is `null` **and** the adapter is `required` in the active profile | **HARD FAIL** — generalizes the CV01 contract to every adapter |
| **Skipped** | reading is `null` and the adapter is **not** required in the active profile | **PASS**, but a **loud warning** is printed on every run and the adapter is recorded in the machine-readable `skipped[]` output array |
| **Declared-N/A** | reading is `null` **and** an explicit `advisory-by-design` exemption (with a reason) covers it | Info-level, cites the declared reason; **not** counted as `skipped` and **never** fails |

Silent-`null` is no longer a reachable state. Every `null` is either a
failure, a loud skip, or an explicitly declared exemption.

### 2. Profiles in `governance.toml`

Profiles are declared in `harness/.harness/governance.toml`, which the
gate already loads. Requiredness is declared at **adapter** granularity
(one adapter feeds many metrics; e.g. `sentrux` → god-file + hotspot +
complex-fn), and the gate maps each metric back to its source adapter.

```toml
[profiles.strict]
required_adapters = ["sentrux", "apss-topology", "ubs-security", "hyperfine-perf", "coverage", "deadcode", "ts-morph-coupling"]

[profiles.local]
required_adapters = ["deadcode", "ts-morph-coupling"]   # the zero-dep, always-available adapters
# sentrux / apss-topology / ubs-security / hyperfine-perf are OPTIONAL here → skip-loud, not fail
```

Two profiles ship; forks add their own. `advisory-by-design` exemptions
(a11y, availability on a static template) are orthogonal to profiles —
they remain declared per-metric and are the **Declared-N/A** state in
every profile.

### 3. Default `strict`, fail-safe

- Selection precedence: `--profile=<name>` flag › `SENSORS_PROFILE` env
  › **default `strict`**.
- An **unconfigured** run is `strict` → every adapter required → any
  null hard-fails. Leniency is always a conscious opt-down.
- An **unknown** profile name is a hard error — never a silent fallback
  to a default.
- CI (`.github/workflows/test.yml`, `fitness` job) pins
  `--profile=strict` **explicitly**, so a future edit to
  `governance.toml` cannot quietly loosen the CI lane.

### 4. Loud output contract

On **every** run, including PASS, when any adapter is in the **Skipped**
state, the verdict block prints, near the top:

```
DEGRADED: 2 adapter(s) skipped — not required by profile 'local': sentrux, apss-topology
```

The gate's JSON output gains two arrays so an agent (or CI assertion)
can parse exactly which dimensions did not truly run:

- `skipped[]`   — `{ adapter, reason, profile }`
- `failed_missing[]` — adapters that hard-failed because they were
  required but missing.

## Consequences

**Positive**

- The standard can no longer pass hollow. A required adapter that does
  not run is a failure, not a silent success — in CI **and** locally.
- Local degradation is preserved but auditable: a lean run still passes,
  but it announces every hole loudly and machine-readably, so a human or
  coding agent knows the gate ran with reduced coverage.
- Generalizes an existing, trusted pattern (CV01) rather than inventing
  a new mechanism; the failure semantics are already proven for coverage.
- Fail-safe default: forgetting to configure a profile yields the
  *strict* behavior, not the permissive one.

**Negative / costs**

- A fresh clone that runs the gate with no profile now **fails** until
  it either installs the full toolchain (`apss install`,
  `install-sentrux.sh`, ts-morph deps, hyperfine) or explicitly selects
  `--profile=local`. This is a deliberate friction trade: the
  "degrades cleanly to PASS" behavior is exactly the bug being removed.
  Mitigation: ship `local` as a documented, discoverable opt-down and
  reference it in the gate's own missing-adapter error message.
- Every fork inherits stricter defaults; forks relying on implicit
  skip-to-pass will see new failures. This is intended and is called out
  in the upstream APSS issue (below).

## Upstream question (APSS standard)

This ADR encodes fail-closed enforcement in the **template**. The open
question it raises — *should the enforcement contract (fail-closed,
profile-based required adapters, no silent skips) be promoted into the
APS-V1-0002 architecture-fitness standard itself, so every consumer
inherits it rather than re-deriving it per fork?* — is filed as an issue
against `AgentParadise/agent-paradise-standards-system`. The template's
implementation here is the reference proposal that issue points at.

## Test matrix (acceptance)

- `strict` + a required adapter reads `null` → **FAIL** (core regression test)
- `local` + an *optional* adapter reads `null` → **PASS** + warning emitted + `skipped[]` populated
- `local` + a *required* adapter reads `null` → **FAIL** (lean profiles keep a floor)
- adapter reads a number → evaluate against baseline (unchanged)
- `advisory-by-design` metric reads `null` → info-level, not warning, not fail, absent from `skipped[]`
- unknown `--profile=` value → hard error (no silent default)
- no profile specified → resolves to `strict`

## Implementation note (2026-06-17)

Four decisions made during implementation that refined or diverged from the ADR text:

1. **Declared-N/A via existing advisory enforcement.** Rather than adding a new per-metric `exempt = true` flag, the Declared-N/A state reuses the existing `enforcement: 'advisory'` dimension mechanism (AC01 Accessibility, AV01 Availability): the four-state logic computes `enforced = code !== 'AC01' && code !== 'AV01'`, so advisory dims never fail and never count as skipped. Approved simplification (YAGNI) — no new schema surface needed.

2. **Required-missing fails regardless of baseline.** An early implementation wrongly gated `requiredMissing` on the metric having a prior baseline entry; this was corrected — a required adapter that produces no reading hard-fails even when the metric's baseline is null (the common case on a fresh clone). A regression test (`sensors-fail-closed.test.ts`, "both-null hollow-pass guard") locks this invariant.

3. **Profile selection and adapter granularity.** Profiles live in `harness/.harness/governance.toml` as `[profiles.strict]` (all 10 KNOWN_ADAPTERS, drift-guarded by a test) and `[profiles.local]` (the zero-dep adapters: deadcode, cruiser-coupling, complexity). Selection precedence: `--profile=` flag › `SENSORS_PROFILE` env › default `strict`; unknown profile → exit 2. CI's fitness job pins `--profile=strict` explicitly so a governance.toml edit cannot silently loosen the CI lane.

4. **Empirical proof (this clone, 2026-06-17):**
   - `--profile=strict` → `VERDICT: FAIL sensors gate` / `MISSING REQUIRED: 18 adapter(s) required by profile 'strict' produced no reading: apss-topology, sentrux, ubs-security, hyperfine-perf, suite-duration, coverage.`
   - `--profile=local` → `VERDICT: PASS sensors gate` / `DEGRADED: 18 adapter(s) skipped — not required by profile 'local': apss-topology, sentrux, ubs-security, hyperfine-perf, suite-duration, coverage. These dimensions did NOT run.`
   - `--profile=bogus` → `gate: unknown profile 'bogus'`, exit 2
   - `--profile=local --json` → `skipped 18 failed_missing 0`
   - Full test suite: 37 test files, 589 tests, all passed.
