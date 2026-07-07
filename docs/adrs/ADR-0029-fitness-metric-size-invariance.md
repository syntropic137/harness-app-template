---
name: "Fitness-metric size-invariance — a hard gate may only enforce a metric that healthy growth cannot move"
description: "State the admission rule every enforced fitness metric must pass: adding one well-designed module must not, by itself, worsen the metric. Metrics that fail this 'new well-designed module' test (global composite ratios, raw counts that grow with module count) measure growth, not rot, and must not hard-gate. Applies the rule to MD01: keep the size-invariant per-module maxima enforcing (with a ratchet clamp at the designed threshold), remove the sentrux global coupling ratio from the enforced set, and fix the instability-count category error. Records the principle so no future scaffold re-wires a growth-sensitive metric as a hard gate."
status: accepted
---

<!--
ADR-0029 — states the durable principle behind the coupling-gate
false-trip class (upstream issue syntropic137/harness-app-template#57,
extending #56; downstream evidence NeuralEmpowerment/dream-ship_v0#17,
research docs in dream-ship PR #20). ADR-0017 made APSS canonical and
sentrux a preserved opt-in overlay; ADR-0020 made the floor a monotonic
ratchet; ADR-0028 closed the silent-skip hole (a missing reading no
longer passes as success). None of those states WHICH metrics are
eligible to be hard gates in the first place. This ADR fills that gap
with a single admission test and applies it to MD01. It does NOT change
the ratchet mechanics, the reading taxonomy, or sentrux's status as a
preserved adapter; it changes which metric shapes may hold enforcement.
-->

# ADR-0029: Fitness-metric size-invariance — a hard gate may only enforce a metric that healthy growth cannot move

**Date:** 2026-07-07
**Category:** sensors slot (harness/sensors/gate.mjs, harness/sensors/baseline.json, FITNESS_METRICS)
**Supersedes:** none (refines [ADR-0017](./ADR-0017-sensors-v03-apss-canonical.md) § canonical-signal posture, [ADR-0020](./ADR-0020-architectural-fitness-ratchet.md) § ratchet contract; complements [ADR-0028](./ADR-0028-fail-closed-fitness-profiles.md))
**Next review:** 2027-01-07

## Context

The fitness gate exists to fail early on **architectural rot** — a module
over-coupling, a cycle appearing, complexity spiking — so an agent or a
human fixes the code before it lands. Its authority depends entirely on
one property: **a red gate must almost always mean genuine rot.** The
moment the gate fires on ordinary, well-designed growth, every firing is
a false positive, trust erodes, and the rational move for whoever hit the
gate is to route around it — demote the metric to advisory, bump the
baseline, or disable it. A gate that gets disabled is not stricter than
no gate; it is worse, because it cost trust on the way out.

That failure mode is not hypothetical. Across five weeks in a scaffolded
consumer of this template (dream-ship_v0), the MD01 coupling gate was
worked around **three times** — PR #4 (a clean markdown-portability
feature), then the dream-walker renderer crate — each time triggered by
**well-factored code being added**, never by degradation. The pattern was
always: add a feature → a metric moves → the hard gate fires → the agent
grinds against a noisy metric (once for 35 min / 90k tokens without
converging) → the metric is demoted or its floor is bumped to keep moving.
A four-lane read-only research swarm (dream-ship PR #20, cross-checked by
an independent Codex pass) traced every incident to the same structural
cause and it is the cause this ADR fixes.

**The structural cause: some metric shapes cannot distinguish growth from
rot.** A global composite ratio (`cross_module_edges / total_import_edges`)
and a raw count that scales with module count (`instability-out-of-range-count`)
both move when you add a perfectly well-designed module. They are
measuring the *size and mix* of the codebase, not whether any boundary is
over-coupled. No amount of tolerance tuning rescues a metric of that shape
for hard-gating: the signal it emits genuinely conflates the thing we want
to block (rot) with the thing we want to encourage (clean growth).

The template already had the right *tools* — ADR-0017 keeps APSS canonical
and sentrux a preserved second lens; ADR-0020 makes improvements ratchet;
ADR-0028 stops missing readings from passing silently. What was missing is
a rule for **which metrics are eligible to hold enforcement at all.** That
rule lived only as research prose in a downstream fork. This ADR makes it a
durable, template-level decision so no future scaffold re-wires a
growth-sensitive metric as a hard gate.

## Decision

### 1. The admission test: the "new well-designed module" rule

**A metric may be wired as an enforcing hard gate (`fail_on_regression: true`)
only if it passes this test:**

> Take the current report. Append one well-factored module — reasonable
> internal imports, fan-out below the designed threshold, sitting on or
> near the Martin main sequence. Does the metric structurally worsen?
> **If yes, the metric measures growth, not rot, and must not hard-gate as
> wired.**

The test is mechanical and shape-based. It sorts metric shapes cleanly:

| Shape | Passes? | Why |
|---|---|---|
| **Per-module maximum** (e.g. `max-fan-out`, `max-main-sequence-distance`) | **Yes** | A new module *under* the threshold cannot raise the workspace max. Size-invariant by construction. |
| **Zero-tolerance count of a real defect** (e.g. `circular-dependency-edges`) | **Yes** | A well-designed module introduces no cycle, so the count does not move. The defect, not the size, drives it. |
| **Per-module offender ledger / density** (offenders ÷ modules) | **Yes** | Constant quality under growth reads as constant; only a *new offender* or a *worsening listed module* moves it. |
| **Global composite ratio** (e.g. `sentrux-coupling-score`) | **No** | A clean multi-module feature legitimately adds cross-module edges; the ratio drifts by rounding-scale amounts driven by the *mix* of code added. |
| **Raw count that scales with module count** (e.g. `instability-out-of-range-count` as wired) | **No** | Every new leaf/entrypoint module (Ca=0 → I=1.0) increments the count by definition, even at constant quality. |

A metric that fails the test is not thereby useless — it may still be a
valuable **advisory** trend, or it can be **reshaped** into a passing form
(per-module maximum, offender ledger, or density with a tolerance band)
and then earn enforcement. What it may not do is hold hard-gate authority
in its growth-sensitive shape.

This test is the standing admission criterion for every future metric.
`docs/sensors/dimensions-reference.md`'s "adding a new dimension" recipe
and the `harness/sensors/tests/` suite carry it forward (Consequences).

### 2. The ratchet clamps at the designed threshold; it never ratchets headroom into policy

ADR-0020 makes the floor tighten monotonically on improvement. Left
unbounded, that tightening captures **incidental** headroom — the accident
that today's code is small — and freezes it as policy nobody chose.
Concretely, `max-fan-out` has `default_threshold: 20` but auto-ratcheted to
a floor of **2** because the template's example modules are tiny. The first
real feature module importing three packages — impeccably designed — then
hard-fails the canonical coupling gate. That is a size-invariance failure
*introduced by the ratchet itself*, on a metric whose shape is otherwise
sound.

**Rule: where a designed threshold represents headroom, the ratchet stops
tightening at it.** For a `direction: max` (smaller-is-better) metric that
opts in, the effective floor is `max(measured_best, ratchet_floor)` — the
ratchet burns down debt *toward* the floor and clamps there. "No broken
windows" applies to *debt*, not to *headroom*: defending fan-out 2 over 3
buys nothing (both are healthy) while costing trust.

This is expressed as an **opt-in per-metric `ratchet_floor`**. A metric that
declares it is clamped there; a metric that does not is unchanged and
ratchets to its measured best as before. The clamp is deliberately *not* a
blanket `default = default_threshold`, because some `max` metrics are meant
to ratchet *below* their threshold: `max-cognitive` has
`default_threshold: 15` (the Sonar watch line) yet the template intentionally
tightens its floor to the measured peak (e.g. 5), so a function regressing
from 5 back toward 15 fails. Coupling headroom (fan-out 2 vs 20) is
incidental; complexity headroom (cognitive 5 vs 15) is a real, defensible
gain worth pinning. The two cannot share one default, so `ratchet_floor` is
opt-in and wired only where headroom is genuinely incidental — the MD01
coupling maxima (§3). The min-direction (larger-is-better) metrics never
clamp: a higher quality signal is always a genuine improvement, never
incidental headroom.

### 3. Applying the rule to MD01 (Modularity and Coupling)

| Metric | Test verdict | Disposition |
|---|---|---|
| `max-fan-out` (APSS/Martin Ce, canonical) | Pass (per-module max) | **Stays enforcing.** Add the §2 `ratchet_floor` clamp at the designed threshold, and relax the current floor of 2 to that threshold **before** it fires (a deliberate, audited baseline edit — a raw `--update-baseline` writes the current measurement, so the clamp/edit is required). Remains the **single canonical enforcing coupling metric** per ADR-0017 § one-canonical-signal. |
| `max-main-sequence-distance` (canonical) | Pass (per-module max) | **Stays enforcing.** Same §2 clamp applies once it begins tightening (floor is currently 1.0, the theoretical max, so it gates nothing yet). |
| `instability-out-of-range-count` | Fail (raw count; new entrypoint → I=1.0 increments it) | **Reshaped.** Count a module only when its instability is extreme AND it sits *off* the main sequence (Martin distance `D > 0.1`). An extreme-instability module ON the sequence (a leaf/entrypoint at I≈1,A≈0, or a stable-abstract module at I≈0,A≈1) is a healthy design point and is not counted — so adding one never trips the gate. This main-sequence-proximity test is the mechanism actually shipped (cleaner than the entrypoint/test name-exclusion or density-band alternatives first considered). A module whose `D` is unreadable is not counted (a deliberate fail-open on that one path; full coverage assumes the abstractness adapter is provisioned). |
| `sentrux-coupling-score` | Fail (global composite ratio) | **Removed from the enforced set.** Delete the metric from `FITNESS_METRICS` and from `harness/sensors/baseline.json`. `sentrux_scan.mjs` continues to compute `coupling_score` in its envelope for anyone who wants to read it, but the gate no longer governs it. Removing the unreliable ratio is clearer than shipping a "present but permanently disabled" metric every future scaffold must learn to ignore. |
| `sentrux-max-depth` | Mostly pass (a well-layered feature can add one level) | **Stays enforcing** with the §2 clamp at the designed threshold (10; ratcheted value 3 is incidental headroom). |

**Sentrux is preserved, not implicated.** Per ADR-0017 sentrux stays an
installed, trusted second lens. Four of its five wired metrics
(`sentrux-quality-signal`, `sentrux-god-file-count`, `sentrux-hotspot-count`,
`sentrux-complex-fn-count`) are scores/counts with no false-trip history and
**remain enforcing**. Only the one metric whose *shape* is a global ratio —
independent of sentrux as a tool — leaves the enforced set. The lens is
kept; the wrong-shaped signal is not hard-gated.

## Consequences

- **What this enables.** Every enforced MD01 metric now satisfies "adding a
  well-designed module does not change the verdict." The coupling gate fires
  only on genuine over-coupling — a module exceeding the designed fan-out
  policy, a worsening listed offender, or a new cycle — so a team can leave
  it enforcing forever and never has a rational reason to disable it. The
  fan-out floor-of-2 time bomb is defused before it fires.
- **The escape-hatch pressure drops.** Baseline bumps and advisory demotions
  were symptoms of enforcing the wrong shapes. With only size-invariant
  metrics hard-gating, the deliberate `--update-baseline` relax returns to
  its intended rare role (a recorded architectural choice), not a per-feature
  ritual.
- **One canonical signal per axis is honored.** MD01 coupling is enforced by
  a single canonical metric (`max-fan-out`); the sentrux overlay informs but
  does not block, exactly as ADR-0017 intends. Two enforcing metrics on one
  axis would double the false-positive rate for near-zero added recall.
- **Follow-on implementation (separate beads/PR, not this ADR):**
  1. Add the opt-in per-metric `ratchet_floor` clamp to `ratchetBaseline()`
     in `harness/sensors/gate.mjs` (both the new-metric seed path and the
     tighten path); wire it on the MD01 coupling maxima only.
  2. Remove `sentrux-coupling-score` from `FITNESS_METRICS` (MD01) and from
     `harness/sensors/baseline.json`.
  3. Reshape `instability-out-of-range-count` to count only extreme-instability
     modules that are also off the main sequence (`D > 0.1`); an unreadable `D`
     is not counted (fail-open on that path, gated by abstractness-adapter
     provisioning).
  4. Relax the `max-fan-out` floor from 2 to the designed threshold via an
     audited baseline edit before the clamp lands.
  5. Add a fixture test in `harness/sensors/tests/` that appends a synthetic
     well-designed module (fan-out = threshold − 1, I = 1.0, A = 0,
     reasonable depth) and asserts the gate stays green — the mechanical
     encoding of §1. Today it fails twice (fan-out floor 2; instability
     count); when it passes, the principle is enforced, not just documented.
  6. Update `docs/sensors/dimensions-reference.md` MD01 section (drop
     `sentrux-coupling-score`, correct the enforced-metric count and the
     stale floors) and fold the §1 admission test into its "adding a new
     dimension" recipe.
- **Cost.** MD01 loses one whole-graph sentrux ratio as a *governed* signal.
  Accepted: the metric is opaque at repo scale (its live value does not
  reconcile with the `cross`/`total` fields sentrux emits) and unstable under
  growth; the canonical APSS coupling metric remains the authority and the
  raw ratio stays readable in the sentrux envelope for anyone who wants it.

## When to re-evaluate

- Sentrux (or another tool) publishes a **stable, documented decomposition**
  of coupling that supports a per-module offender-ledger or density shape —
  then a size-invariant coupling overlay could re-earn enforcement via §1
  plus a stability window of N feature merges with zero would-have-been false
  positives. Recording that promotion is a new ADR.
- A metric currently enforcing is found to fail the §1 test under a workload
  this template did not anticipate — reshape it or demote it to advisory.
- The ratchet clamp (§2) is observed to pin a floor *looser* than a project
  actually wants — a project may deliberately choose a tighter designed
  threshold via an audited baseline/ADR edit; the clamp bounds the automatic
  ratchet, not a deliberate human choice.

## Backlinks

- [ADR-0017-sensors-v03-apss-canonical](./ADR-0017-sensors-v03-apss-canonical.md) — APSS canonical; sentrux preserved opt-in; one canonical signal per axis.
- [ADR-0020-architectural-fitness-ratchet](./ADR-0020-architectural-fitness-ratchet.md) — the monotonic ratchet this ADR clamps at the designed threshold.
- [ADR-0028-fail-closed-fitness-profiles](./ADR-0028-fail-closed-fitness-profiles.md) — the complementary fix (a missing reading no longer passes silently); this ADR governs which *present* readings may hard-gate.
- `harness/sensors/gate.mjs` — `FITNESS_METRICS` MD01 table, `ratchetBaseline()`, `EPSILON`.
- `harness/sensors/baseline.json` — MD01 floors (fan-out 2, instability count, sentrux-coupling-score).
- `docs/sensors/dimensions-reference.md` — MD01 section + "adding a new dimension" recipe (to carry the §1 admission test).
- Upstream: [syntropic137/harness-app-template#57](https://github.com/syntropic137/harness-app-template/issues/57) (extends #56) — the coupling-gate reliability issue this ADR answers.
- Downstream evidence: [NeuralEmpowerment/dream-ship_v0#17](https://github.com/NeuralEmpowerment/dream-ship_v0/issues/17) and research docs in dream-ship PR #20 (design / mechanics / recurrence-audit / template-ladder lanes).
