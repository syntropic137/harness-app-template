---
name: "Architectural-fitness ratchet — quality monotonically improves, never regresses"
description: "Promote the harness/sensors/gate.mjs baseline from a fixed floor to a monotonic upward ratchet: measured improvements automatically tighten the floor, regressions below the floor fail the gate, and the only way to loosen the floor is the deliberate `--update-baseline` escape hatch. Records the no-broken-windows rule that closes the loop ADR-0019 opened."
status: accepted
---

<!--
ADR-0020 — closes the "fixed floor" gap left open by ADR-0017 § Discipline
("The baseline is never auto-updated"). ADR-0019 wired the producer ->
consumer -> enforcer pipeline; this ADR makes the floor side of that
pipeline monotonic. Architecture / sensors lane only; placement (lefthook,
CI) is owned by the integration lane and unchanged.
-->

# ADR-0020: Architectural-fitness ratchet — quality monotonically improves, never regresses

**Date:** 2026-06-10
**Category:** sensors slot (harness/sensors/gate.mjs, baseline.json)
**Supersedes:** none (refines ADR-0017 § Discipline and ADR-0019 § Decision (2))
**Next review:** 2026-12-10

## Context

[ADR-0017](./ADR-0017-sensors-v03-apss-canonical.md) and
[ADR-0019](./ADR-0019-closed-loop-architectural-quality.md) wired a closed
loop: APS-V1-0001 produces real `.topology/metrics/*.json` every cycle,
`harness/sensors/aggregate.mjs` merges them with the dep-cruiser/ts-morph
fallback, and `harness/sensors/gate.mjs` enforces the per-folder Martin
metrics + the eight APSS dimensions against the committed
`harness/sensors/baseline.json` floor.

That loop closed the *producer* side, but the *floor* side stayed static.
ADR-0017 § Discipline recorded:

> The baseline is never auto-updated on regression. The only way to
> change the floor is `gate --update-baseline`, which is a deliberate
> act recorded in git.

That rule prevents regression-driven erosion (good), but it also prevents
*improvement-driven tightening*. The operational consequence: when a
refactor lowers `ws_apps/x/src` from instability 0.4 to 0.1, the gate
notices, passes, and forgets. The next commit can slide back to 0.39 —
*still under the 0.4 floor* — and the gate would pass again. The floor
does not capture wins, so the project quietly accumulates near-miss
regressions that ADR-0019's "no broken windows" framing was supposed to
prevent.

The fixed-floor model is also at odds with how the operator framed the
fitness gate in the assignment: *"a true upward ratchet — quality
monotonically improves, never regresses, no broken windows."* The current
shape is a one-way fail on regression below baseline. The shape we want is
a one-way ratchet that **tightens automatically on improvement** and
**fails on regression below the tightest-ever floor**.

## Decision

Three related decisions, all accepted:

1. **`gate.mjs` becomes a monotonic upward ratchet.** On every passing
   run the gate computes, for each measured metric, whether the current
   value is direction-aware better than the committed floor. Any
   tightening is written back to `harness/sensors/baseline.json` as the
   new floor. The next run enforces against that new (tighter) floor, so
   the floor only ever moves one way: down for `direction: max` metrics,
   up for `direction: min` metrics. A no-op run (current == floor within
   EPSILON) does NOT write the baseline — no git churn.

2. **Regressions still fail; the ratchet does NOT widen on its own.**
   When the current report is direction-aware worse than the floor, the
   gate prints the per-folder / per-dimension diff and exits non-zero.
   The floor is NOT updated. The next action is mechanical: the agent
   fixes the regression and re-runs, or (deliberately) reaches for the
   escape hatch below.

3. **Two escape hatches keep the ratchet humane.**
   - `--update-baseline` (existing flag, semantics preserved) is now the
     ONLY way to LOOSEN the floor. It rewrites the baseline from the
     current report regardless of regression. The resulting
     `baseline.json` diff is the auditable record of a deliberate
     architectural choice (refactor, slot redesign, intentional debt).
   - `--no-ratchet` (alias `--ratchet=off`, env `RATCHET=off`) suppresses
     the rewrite-on-improvement side effect. The gate still passes /
     fails identically, but no baseline file is touched. This is the
     correct mode for replay / CI dry-run / debug sessions that must not
     produce a git change.

The legacy folder I/D ratchet is direction-implicit (smaller is better,
matching the existing `compareLegacyBaseline` regression rule). The APSS
dimension metrics use the explicit `direction` field already declared in
`FITNESS_METRICS` (most are `max` / smaller-is-better; the lone
`min` / larger-is-better case today is `startup-benchmark-count`).

A baseline entry whose floor is `null` while the current measurement is a
real number is tightened to that number — `null -> 5` is the canonical
"first measurement" improvement. A current measurement that is `null`
(e.g., a perf adapter that is offline this run) leaves the floor
untouched. Transient skips must never erode the floor.

Concretely, the new functions added to `harness/sensors/gate.mjs`:

- `ratchetBaseline(baseline, currentReport, options)` — deep-copies the
  baseline, applies the direction-aware tightening rules, and returns
  `{ next, tightenings, changed }`.
- `renderRatchetReport(ratchet, baselinePath)` — emits a human-readable
  RATCHET block after the existing VERDICT line so any coding agent sees
  exactly what tightened and where the new floor lives.
- A `ratchet` block in the JSON envelope: `{ enabled, applied, tightened,
  tightenings, baseline_written }`.

The CLI argument surface gains exactly one new flag (`--no-ratchet`, plus
the symmetric `--ratchet`/`--ratchet=on|off` for explicitness) and reads
`RATCHET=off` from the environment for hook contexts that prefer env over
flags. The `--update-baseline` flag is unchanged in semantics — it was
already a deliberate-relax escape hatch; this ADR just promotes that role
to its new central position in the floor lifecycle.

Deliberate non-choices:

- **No change to the comparison code path.** `compareBaseline`,
  `compareLegacyBaseline`, and `compareFitnessBaseline` are untouched.
  The ratchet is a *post-pass* step that consumes the same data the
  comparator already produced; on regression the ratchet is skipped
  entirely (the comparator's verdict is final).
- **No change to lefthook.yml or the CI workflow.** The existing
  `sensors-gate` lefthook entry and the matching CI job invoke
  `harness/sensors/bin/sensors gate` without any baseline-side flags;
  they pick up the new behaviour for free. Placement / timing decisions
  belong to the integration lane (GrayKnoll's zone in this session);
  this ADR fixes only the floor-lifecycle contract.
- **No change to `harness/sensors/baseline.json`'s shape.** The schema
  (`schema_version: 1.0.0`, `standard: APS-V1-0002`, `folders + dimensions`)
  is unchanged. A pre-ratchet baseline file is consumed as-is; the first
  improvement triggers the first ratchet rewrite.
- **No widening of removed folders.** Folders present in the baseline
  but absent from the current report are left in place. A folder that
  was refactored away will be removed by the next deliberate
  `--update-baseline`, not by the ratchet. This is the conservative
  choice: a transient build skip (excluded ws_app, partial workspace)
  must not silently drop floors.

## Consequences

- **What this enables.** Quality becomes mechanically monotonic. Every
  refactor that improves an APSS dimension or a folder's Martin metric
  tightens the floor on the same commit that produced the improvement,
  so the win is captured forever (until a deliberate `--update-baseline`
  relaxes it). The "no broken windows" framing recorded in ADR-0019 §
  Decision (2) becomes a mechanical gate instead of a discipline note.
  Coding agents get a deterministic signal: PASS + RATCHET block tells
  them their refactor stuck; PASS without a RATCHET block means a no-op
  run; FAIL means a regression below the tightest-ever floor.
- **What this constrains.** Every passing run that improves a metric
  writes to `harness/sensors/baseline.json`. The hook contract grows by
  exactly one side effect: a tightened baseline must be committed. The
  `sensors-gate` lefthook entry runs on `pre-push`, so the
  baseline-write happens *before* the user's push; if the user pushed
  without staging the updated baseline, the next pull on another
  machine will see a diff. This is the same shape as auto-formatted
  files (lefthook already handles "hook changed a file, please re-stage
  and re-commit"). The integration lane MUST surface this as a clear
  message in the hook output; the gate's existing RATCHET line is
  designed for that.
- **Per-cycle cost.** Negligible. The ratchet is a single pass over the
  baseline + current dimensions tree; no extra adapters, no extra IO
  beyond the conditional baseline rewrite. The producer cost recorded in
  ADR-0019 § Per-cycle cost dominates the gate's overall wall-clock.
- **Preservation audit.** No removals.
  (1) `compareBaseline` / `compareLegacyBaseline` / `compareFitnessBaseline`
      enforcement semantics unchanged.
  (2) `extractApssFitnessBaseline` schema unchanged.
  (3) `harness/sensors/baseline.json` schema unchanged (only values move,
      and only in the tighter direction).
  (4) `--update-baseline` flag semantics unchanged (still the deliberate
      relax-the-floor escape hatch).
  (5) All eight APSS dimensions retain their existing enforcement posture
      (ADR-0019 § Decision (2)); the ratchet only ever tightens, never
      changes which dimensions enforce.
  (6) `harness/sensors/bin/sensors gate` wrapper script untouched — the
      new flag passes through the existing `--update-baseline` flag's
      delivery path.

## Details

### Direction semantics

Each metric in `FITNESS_METRICS` (see `harness/sensors/gate.mjs:91`) has
a `direction` field:

- `direction: 'max'` (smaller-is-better, e.g. `max-cognitive`,
  `max-cyclomatic`, `max-fan-out`, `max-main-sequence-distance`): the
  ratchet tightens when `current < baseline - EPSILON`.
- `direction: 'min'` (larger-is-better, e.g. `startup-benchmark-count`):
  the ratchet tightens when `current > baseline + EPSILON`.

Legacy folder I/D values are treated as `direction: 'max'`, matching the
existing `compareLegacyBaseline` rule (regression = `current > baseline + EPSILON`).

### The three states the gate distinguishes

| State        | Comparator verdict | Ratchet action               | Exit code |
|--------------|--------------------|------------------------------|-----------|
| Improvement  | PASS               | Tighten + write baseline     | 0         |
| No change    | PASS               | None (no git churn)          | 0         |
| Regression   | FAIL               | None (floor is not widened)  | non-zero  |

`--update-baseline` overrides the regression case: it relaxes the floor
to whatever the current report shows and exits 0. `--no-ratchet`
suppresses the improvement-case rewrite (the comparator still passes /
fails the same way).

### Why "auto-tighten" and not "tighten only on opt-in"

A reasonable alternative would be to require a `--tighten` flag for the
floor to move, leaving the default behaviour exactly as ADR-0017 § Discipline
recorded. Rejected:

- An opt-in tightening is not a ratchet — it is the existing
  fixed-floor model with a synonym. Agents that forget the flag would
  silently leak quality wins, exactly the failure mode this ADR was
  written to close.
- The "auto-tighten on pass" shape mirrors how every modern auto-format
  gate works (lefthook auto-formats then re-stages; the user sees the
  diff and commits). The mechanism is familiar.
- Genuine cases where the floor should NOT tighten are well-served by
  `--no-ratchet` (replay) and `--update-baseline` (deliberate relax).
  The opt-out shape covers the rare case; the opt-in shape would force
  the rare case on every run.

### Why a single `--no-ratchet` is sufficient

The integration lane may wire a CI dry-run or a sandbox replay that
needs to read the baseline without writing. `--no-ratchet` (or
`RATCHET=off`) gives that path a zero-allocation way to suppress the
rewrite. The flag does NOT change the verdict — a CI dry-run that wants
"would this pass?" still gets the same exit code.

### Why the regression message points at both escape hatches

`renderReport` was updated so the post-regression hint emphasises the
no-broken-windows rule first, then mentions `--update-baseline` second.
The intent is to bias the agent toward fixing the code; reaching for
`--update-baseline` is the deliberate exception, not the default
remediation. The exact text:

> The ratchet does NOT auto-loosen on regression (no broken windows).
> Fix the code so the metric returns at or below the floor and re-run
> `just sensors gate`. If the regression is genuinely intentional
> (refactor, slot redesign), relax the floor deliberately via
> `just sensors gate --update-baseline` and commit the resulting
> harness/sensors/baseline.json as the audit trail.

### Test plan (and how the change is verified)

`harness/sensors/tests/ratchet.test.mjs` (new) covers both directions
and every escape-hatch path:

- `ratchetBaseline: improving folder I tightens the floor` — direct unit
  test of the tightening predicate for a folder-level metric.
- `ratchetBaseline: no change when metrics are equal` — proves no-op runs
  produce zero tightenings (no git churn).
- `ratchetBaseline: regression does NOT widen the floor` — proves the
  ratchet refuses to relax even when invoked on a regressing report.
- `ratchetBaseline: null baseline meeting a real measurement is treated
  as improvement` — covers the "first measurement" path.
- `ratchetBaseline: improving APSS dimension metric tightens floor
  (direction=max)` — proves the dimension-level direction-aware path.
- `compareBaseline: regression below floor is reported and ratchet is not
  triggered` — proves the comparator and the ratchet do not interact
  outside the documented contract.
- `main: improving run auto-tightens baseline.json` — end-to-end PASS +
  RATCHET write through the CLI entry point.
- `main: regression below floor fails AND does not move the baseline`
  — end-to-end FAIL with zero writes.
- `main: --no-ratchet preserves comparison behaviour but skips the rewrite`
  — proves the suppression flag.
- `main: --update-baseline is the escape hatch — relaxes the floor on a
  regressing run` — proves the deliberate-relax path.
- `main: no improvement, no regression → ratchet does not churn the
  baseline file` — proves the no-write-on-no-op invariant.

All eleven cases pass under `node --test harness/sensors/tests/ratchet.test.mjs`.

### Slot contract compatibility

- `harness.manifest.json#slots.sensors.implementation` is unchanged. The
  ratchet is a refinement of the existing gate, not a new slot.
- `harness.manifest.json#slots.hooks` is unchanged. The lefthook
  `sensors-gate` entry continues to invoke `harness/sensors/bin/sensors
  gate`; the new behaviour is the default.
- `harness.manifest.json#slots.task-runner` is unchanged. `just sensors
  gate` continues to compose producer + gate; the gate's ratchet
  behaviour is post-pass and transparent to the recipe.
- `harness.manifest.json#slots.agent-plugins` should reference this ADR
  alongside ADR-0019 so any agent reading `CLAUDE.md` / `AGENTS.md` on a
  fresh clone learns the no-broken-windows contract.

### Alternatives considered

- **Keep the fixed floor; ship a separate `tighten-baseline` recipe.**
  Cheaper to implement. Rejected: it makes tightening a chore an agent
  must remember to run, which means tightening will rarely happen and
  the broken-windows failure mode this ADR closes will persist.
- **Auto-tighten AND auto-loosen on every run.** Symmetric, but
  eliminates the floor entirely — the gate would never fail, because
  every regression would be silently absorbed into a new (worse)
  baseline. Rejected: this is not a ratchet, it is a noise filter.
- **Tighten only the legacy folder I/D ratchet, leave APSS dimensions
  fixed.** Simpler. Rejected: ADR-0019 already promoted APSS metrics to
  primary signal; leaving them out of the ratchet contradicts that
  promotion and leaves the most valuable signal stuck.
- **Write the tightened baseline to a sidecar file (e.g.
  `baseline.tightened.json`) instead of mutating `baseline.json`.**
  Avoids the auto-modified-file UX surprise. Rejected: it creates two
  sources of truth for the floor; the next run has to merge them, which
  is exactly the drift problem ADR-0019 § Per-cycle cost prohibited for
  `.topology/metrics/*.json`.

### Backlinks

Code, docs, and manifests that should reference this ADR when the
integration lane's wiring lands:

- `harness/sensors/gate.mjs` — header comment already cites ADR-0020 and
  the ADR-0017 / ADR-0019 lineage.
- `harness/sensors/baseline.json` — schema unchanged; first ratchet run
  will rewrite values.
- `harness/sensors/tests/ratchet.test.mjs` — the proof.
- `AGENTS.md` (and its `CLAUDE.md` / `.codex` / `.gemini` symlinks) —
  short note: "architecture-fitness is a monotonic ratchet; see
  ADR-0020. PASS tightens, FAIL never widens, escape hatch is
  `--update-baseline`."
- `docs/sensors/coverage-and-gate.md` — update the baseline-flow section
  to describe the ratchet semantics + the two escape hatches.
- `docs/sensors/closed-loop.md` — cross-link from the closed-loop
  companion doc landed alongside ADR-0019.
- `harness.manifest.json#slots.sensors.implementation` — note the
  ratchet as the floor-lifecycle contract.

### Sources

- [ADR-0006 — Sensors](./ADR-0006-sensors.md) — original sensors slot;
  unchanged.
- [ADR-0017 — Sensors v0.3 — APSS canonical, sentrux preserved](./ADR-0017-sensors-v03-apss-canonical.md)
  — the source of the "baseline is never auto-updated" rule this ADR
  refines.
- [ADR-0018 — APSS v1.1.0 integration — augment, never replace](./ADR-0018-apss-v1-1-0-augmentation.md)
  — the routing-through-the-shim decision; unchanged.
- [ADR-0019 — Closed-loop architectural quality](./ADR-0019-closed-loop-architectural-quality.md)
  — the producer-side closure this ADR completes on the floor side.
- [`docs/standards-integration/fitness-function-APS-V1-0002.md`](../standards-integration/fitness-function-APS-V1-0002.md)
  — the integration analysis; unchanged.
- ["The Pragmatic Programmer", Hunt and Thomas, ch. 1 § "Software
  Entropy"](https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/)
  — the original "no broken windows" framing this ADR mechanises.
- "Ratcheting" pattern, as practised by linters and coverage tools that
  permit per-file thresholds to only move in the safer direction (e.g.
  `betterer`, `mutation-testing-elements`'s monotonic mutation score
  gates).

### When to re-evaluate

- A consumer fork reports that the auto-tighten side effect produces
  too much rebase noise during a long-running refactor. Re-evaluate
  whether the ratchet should be opt-in for that fork; the
  `--no-ratchet` flag already covers per-invocation opt-out, but a
  repo-wide opt-out via `harness.manifest.json` may become useful.
- The APSS dimension shape changes such that `direction` is no longer a
  single token per metric (e.g., piecewise direction with a soft band).
  `ratchetBaseline` would need to read a richer schema; the current
  contract assumes a single direction per metric.
- A new dimension or metric is added that should NEVER ratchet (e.g., a
  noisy probabilistic measurement). Extend `FITNESS_METRICS` with a
  `ratchet: false` opt-out per metric and have `ratchetBaseline` skip
  those. Not needed today; every active metric in the v0.1 manifest is
  monotonically interpretable.
- A regression-storm scenario where the gate fails dozens of times in a
  row on the same metric. Consider a short-lived `--allow-regression`
  flag for time-boxed reverts (with auto-expiry). Not needed today; the
  current `--update-baseline` covers the one-shot deliberate relax.
