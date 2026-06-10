---
name: "Closed-loop architectural quality — apss code-topology produces, the sensors gate hard-enforces, every cycle"
description: "Make architectural quality a continuous closed-loop hard requirement: APS-V1-0001 code-topology runs every cycle, gate.mjs (via apss_topology.mjs) hard-enforces against real APSS metrics, the architectural diagram is regenerable from the same artifacts, and the verdict + diff are surfaced to any coding agent on every run."
status: accepted
---

<!--
ADR-0019 — closes the loop the ADR-0017 shim seam and ADR-0018 augment-not-replace decisions opened. Architecture / docs lane only; the producer wiring (justfile, lefthook entries, harness/sensors changes) is owned by the integration lane. This ADR records the *shape* of the closure: what runs each cycle, what hard-enforces, what's regenerable, and what feedback reaches the coding agent.
-->

# ADR-0019: Closed-loop architectural quality — apss code-topology produces, the sensors gate hard-enforces, every cycle

**Date:** 2026-06-10
**Category:** Cross-cutting (sensors slot + hooks slot + task-runner slot + agent-plugins slot)
**Supersedes:** none (closes the loop opened by ADR-0017 and ADR-0018)
**Next review:** 2026-12-10

## Context

Two prior ADRs put the pieces in place for a closed loop but left the loop *open*:

- [ADR-0017 — Sensors v0.3 — APSS canonical, sentrux preserved](./ADR-0017-sensors-v03-apss-canonical.md) promoted APSS (Agent Paradise Standards System, APS-V1-0001 code-topology) to the canonical cross-language architecture-measurement signal and named `harness/sensors/apss_topology.mjs` as the shim seam. The seam was designed as a no-op when no APSS producer is wired: `analyzeFromTopology` returns `{ tool: 'apss-topology', available: false, readings: [] }` when `.topology/metrics/` does not exist. The shim is correct, but with no producer the gate sees *no real APSS data on any cycle*.
- [ADR-0018 — APSS v1.1.0 integration — augment, never replace](./ADR-0018-apss-v1-1-0-augmentation.md) decided the *routing* shape: fitness signals flow into `gate.mjs` via the shim, not by direct `apss run APS-V1-0002` invocation. It deferred the producer side (the actual `apss run APS-V1-0001 …` wiring that materializes `.topology/metrics/{modules,functions,coupling}.json`) to a separate bead.

That deferred bead is what closes the loop. Without it, the architectural-fitness story is half-built:

- `harness/sensors/gate.mjs` already reads `m.apss?.efferent_coupling`, `m.apss?.distance_from_main_sequence`, `m.apss?.instability`, and APSS function-level cognitive / cyclomatic / halstead_volume values for the MT01, MD01, ST01 metrics declared in `FITNESS_METRICS` (`gate.mjs:91-280`). When the shim returns `available: false`, those `m.apss?…` lookups all resolve to `undefined` and the gate silently falls back to the dep-cruiser/ts-morph baselines — exactly the legacy enforcement path ADR-0006 established.
- `harness/sensors/aggregate.mjs` already calls `mergeApssTopology` and tags the report with `apssAvailable: false` when the producer is missing (`aggregate.mjs:274-281`).
- `harness/sensors/baseline.json` already self-declares `standard = "APS-V1-0002"` and `schema_version = "1.0.0"`. The floor exists.

So the consumer side and the gate side are wired and correct *today*. The closing move is to make the producer side run every cycle, so the gate consumes **real APSS metrics every run** instead of falling back to the legacy adapters with `apssAvailable: false`. Once the producer runs each cycle, the same artifacts feed `apss run APS-V1-0001 viz` (the architectural diagram), making the diagram regenerable from the very same data the gate enforces against — no drift between "what the gate measured" and "what the diagram shows."

This ADR is the recorded decision that architectural quality becomes a **continuous closed-loop hard requirement** of this template, not a one-off audit or an opt-in research tool.

## Decision

Four related decisions, all accepted:

1. **The APS-V1-0001 producer runs on every cycle.** `apss run APS-V1-0001 …` (or its equivalent `apss code-topology analyze` composed-binary entrypoint) is wired into the cycle surface so `.topology/metrics/{modules,functions,coupling}.json` is materialized as **real data** before `gate.mjs` evaluates. "Every cycle" means at minimum: every commit (via the `hooks` slot, lefthook `pre-commit` and `pre-push`), every `just sensors gate` invocation (via the `task-runner` slot), and every CI architecture-fitness job. The integration lane owns the exact wiring; this ADR fixes the *contract* that the producer MUST have run before the gate evaluates.

2. **`gate.mjs` hard-enforces against real APSS metrics.** With the producer wired, the shim returns `{ available: true, readings: [...] }` and `aggregate.mjs#mergeApssTopology` attaches real `m.apss.{efferent_coupling, instability, distance_from_main_sequence}` + function-level `cognitive/cyclomatic/halstead_volume` to every workspace module. Every enforced dimension in `gate.mjs` (MT01, MD01, ST01, SC01, LG01, PF01 — `DIMENSION_ORDER` at `gate.mjs:38`) is then evaluated against APSS-canonical data first and the legacy adapters second (as fallback). A regression against the committed `baseline.json` floor exits non-zero. The ADR-0018 stance ("hold the harness's enforcement posture; the gate does NOT shell out to `apss run APS-V1-0002`") is preserved; only the *producer* side is added to the cycle, not a direct `apss run APS-V1-0002` call from `gate.mjs`.

3. **The architectural diagram is regenerable on demand from the same producer artifacts.** `apss run APS-V1-0001 viz` (or the composed-binary equivalent) consumes the same `.topology/metrics/{modules,functions,coupling}.json` files the gate consumed and emits a renderable architectural diagram (Graphviz DOT, Mermaid, or whatever the packaged APS-V1-0001 `viz` subcommand emits — the template does not re-implement this). The diagram is not committed; it is regenerable. A coding agent that wants to see the architecture as a picture runs the viz recipe and reads the output. Because the diagram is generated from the same artifacts the gate enforces against, there is by construction no drift between "the diagram shows X" and "the gate measured X."

4. **The sensor feedback reaches any coding agent on every run.** The gate's stdout is structured for agent consumption: line 1 is `VERDICT: PASS sensors gate` or `VERDICT: FAIL sensors gate` (`gate.mjs#renderReport`); subsequent lines enumerate the per-folder regression diffs (baseline → current, `+delta`) and per-dimension APSS fitness summary (`[ENFORCED]` / `[advisory]` tags, `evaluated / failed / warned` counts). When the gate fails on commit, the hook surfaces the verdict + diff back to whichever agent (Claude Code, Codex, Gemini, Aider, Cursor, …) authored the commit. The remediation path is mechanical and deterministic: read the regression line, identify the offending file/folder/dimension, fix the code, re-run `just sensors gate`, commit. The agent never has to ask "what's the architecture-quality bar?" — the bar is the committed `baseline.json`, and the diff between current and baseline is the agent's instruction set.

Concretely:

- `APSS.yaml` (repo root) and `apss.lock` already declare APS-V1-0001 ≥ 0.2.0. This ADR fixes that `apss install` is part of `just bootstrap` (so the composed binary is available before any cycle invocation) and that `apss run APS-V1-0001 …` is invoked before `just sensors gate` on every cycle surface.
- `harness.manifest.json#slots.sensors` is unchanged. The shim seam stays the only consumer of `.topology/metrics/*.json`, exactly as ADR-0017 §Decision (2) and ADR-0018 §Decision (2) recorded.
- `harness.manifest.json#slots.hooks` (lefthook config) gains a producer-then-gate sequence on `pre-commit` / `pre-push`. The producer step MUST run before the gate step; failing producer = failing cycle.
- `harness.manifest.json#slots.task-runner` exposes a `just sensors gate` (or composed `just apss topology && just sensors gate`) recipe that wires producer + gate in the correct order so an agent invoking `just sensors gate` directly gets the same closed loop a commit hook gets.
- `harness.manifest.json#slots.agent-plugins` — the in-tree `.claude/`, `.codex`, `.gemini` agent contexts (all symlinked to `AGENTS.md` per the template's vendor-symlinks convention) reference this ADR so any agent reading the project's `CLAUDE.md`/`AGENTS.md` on a fresh clone learns "architecture-fitness is a closed loop; the verdict is on stdout; the floor is `harness/sensors/baseline.json`."

Deliberate non-choices:

- **No change to `gate.mjs`'s enforcement code path.** ADR-0018 §Decision (2) already settled that the gate consumes APSS artifacts through the shim, not by direct `apss run APS-V1-0002` invocation. This ADR adds the producer side of that loop; it does not promote the gate to call APSS directly. The §3.4 `INCUBATING_DIMENSION_ERROR_DOWNGRADED` downgrade therefore stays controlled by the harness manifest — the four contested dimensions (ST01, SC01, LG01, PF01) remain hard-enforced from the harness side until the upstream R1 to R5 disclosure (per `docs/standards-integration/fitness-function-APS-V1-0002.md` §7) closes.
- **No removal of the legacy dep-cruiser/ts-morph/complexity adapters.** ADR-0017 §Decision (2) (preservation rule) holds. The producer wiring makes APSS the *primary* signal each cycle; the legacy adapters remain as the fallback path when APSS is temporarily unavailable (developer running offline, producer binary missing on a fresh clone before `apss install`, etc.). The "both-vs-reduce" trade-off recorded in ADR-0017 remains both.
- **No commitment of `.topology/metrics/` artifacts.** The producer regenerates them every cycle from source; committing them would create a second source of truth and a stale-cache failure mode. The artifacts go in `.gitignore` (integration lane's wiring decision; the contract is "regenerable from source on every cycle").
- **No commitment of the `apss code-topology viz` diagram output.** Same reason: it's regenerable from the artifacts, which are regenerable from source.

## Consequences

- **What this enables.** Architectural quality stops being a one-off audit or an opt-in research probe and becomes a *closed-loop hard requirement* — the same mechanical shape coverage, type-check, and lint already have. Every commit is gated against real APSS measurements of the post-commit source tree. Every coding agent that authors a commit gets a mechanical, deterministic, actionable feedback signal: verdict + diff against floor + per-dimension breakdown. The architectural diagram is always available, never stale, never out of sync with the gate.
- **What this constrains.** `just bootstrap` now has a hard dependency on `cargo install apss` succeeding and `apss install` producing a working composed binary. A fresh clone where `apss install` fails (network down, Rust toolchain missing, composed-binary build error) cannot run the architecture-fitness gate; the legacy adapter fallback in `aggregate.mjs` keeps `just sensors gate` functional but downgraded — the gate reports `apssAvailable: false` and the operator sees that signal in the verdict block. The integration lane MUST make this failure mode loud (a `doctor` check, a bootstrap diagnostic, a manifest-required dependency) so it cannot silently degrade.
- **Per-cycle cost.** APS-V1-0001 code-topology is a static analysis pass over the workspace source tree. For a small template repo (this one), the producer cost is sub-second. For consumer forks with large `ws_apps/` and `ws_packages/` trees, the producer cost scales with module count. The integration lane MUST measure and either (a) accept the cost as part of every cycle or (b) add an incremental-mode flag if APS-V1-0001's composed binary supports one. This ADR does not pre-decide that operational point; it fixes the contract that the producer runs every cycle, leaving the integration lane free to optimize *how* it runs.
- **Preservation audit.** No removals. (1) `harness/sensors/apss_topology.mjs` stays as the only consumer of `.topology/metrics/*.json`, exactly as ADR-0017 named. (2) `harness/sensors/aggregate.mjs#mergeApssTopology` is unchanged. (3) `harness/sensors/gate.mjs` enforcement path is unchanged. (4) `harness/sensors/baseline.json` is unchanged. (5) The legacy dep-cruiser / ts-morph / complexity adapters are unchanged. (6) sentrux remains preserved per ADR-0017 §Decision (2). The closed-loop adds a *producer step before the existing pipeline*; it does not edit the pipeline itself.

## Details

### The four-stage closed loop

```
┌─────────────────────────────────────────────────────────────────────────┐
│ PRODUCE                                                                 │
│   apss run APS-V1-0001 …  (every cycle: pre-commit, pre-push, CI)       │
│   → .topology/metrics/{modules,functions,coupling}.json   (REAL data)   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ CONSUME (shim seam, ADR-0017)                                           │
│   harness/sensors/apss_topology.mjs                                     │
│   → { tool: 'apss-topology', available: true, readings: [...] }         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ MERGE                                                                   │
│   harness/sensors/aggregate.mjs#mergeApssTopology                       │
│   → workspace.modules[i].apss = { … real APSS metrics … }               │
│   → workspace.folders[i].apss_distance_max, apss_efferent_coupling_max, │
│     apss_max_cognitive, apss_max_cyclomatic, apss_modules count         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ ENFORCE (gate, ADR-0018 routing)                                        │
│   harness/sensors/gate.mjs                                              │
│   → compare each FITNESS_METRICS dimension vs. baseline.json floor      │
│   → exit 0 (PASS) or exit non-zero (FAIL)                               │
│   → stdout: VERDICT line + per-folder diff + per-dimension summary      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ FEEDBACK TO ANY CODING AGENT                                            │
│   - lefthook prints the gate's stdout back to the agent's TTY/log       │
│   - `just sensors gate` exit code propagates to the agent's shell       │
│   - `apss run APS-V1-0001 viz` regenerates the diagram from the SAME    │
│     artifacts, on demand, for human or agent inspection                 │
│   - docs/sensors/closed-loop.md (this ADR's sibling) tells the agent    │
│     what each line means and how to remediate                           │
└─────────────────────────────────────────────────────────────────────────┘
```

The loop is "closed" in the control-theory sense: the producer's output drives the consumer; the consumer's output drives the gate; the gate's output drives the agent's next action; the agent's next action (a code edit) re-enters the loop at the producer. There is no manual step. There is no place for the loop to silently break, because every stage has a deterministic failure mode that surfaces in the gate's verdict.

### Why "real data, every cycle" matters

Before this ADR, the shim returned `{ available: false }` because no producer was wired. That is operationally indistinguishable from "APSS is broken" or "APSS is uninstalled" — `gate.mjs` fell through to the dep-cruiser/ts-morph baselines and the architecture-fitness story was a sentence in `harness.manifest.json#slots.sensors.implementation` rather than a mechanical gate.

With the producer wired:

- The first run on a fresh clone produces `.topology/metrics/*.json` *from source*. No cached, possibly-stale committed artifacts. No risk of the "gate measured X" diverging from "what the source actually is."
- Every subsequent run produces the same artifacts from the *current* source. Every commit is gated against the post-commit source tree's real APSS measurements.
- The baseline floor is not an aspirational document; it is the committed `harness/sensors/baseline.json` that the gate compares the current-run APSS metrics against. The only way the floor moves is a deliberate `just sensors gate --update-baseline` that produces a reviewable `baseline.json` diff (per `docs/sensors/coverage-and-gate.md` §"New Module Baseline Flow").

### How a coding agent consumes the feedback (mechanical)

The gate is designed for agent consumption. The contract:

1. **Exit code.** `0` = PASS. Non-zero = FAIL (at least one regression). Agents that wrap `just sensors gate` in `&&` or check `$?` get the verdict for free.
2. **Verdict line.** Line 1 of stdout is exactly `VERDICT: PASS sensors gate` or `VERDICT: FAIL sensors gate`. Grep-friendly. The verdict line is intentionally first so it survives noisy adapter output (`gate.mjs#renderReport`).
3. **Per-folder regression diff.** Each regression line is `<folder>  <metric>: <baseline> -> <current>  (+<delta>)`. The agent reads the folder, the metric, and the delta and knows exactly which workspace folder regressed on which APSS dimension by how much.
4. **Per-dimension APSS fitness summary.** `[ENFORCED]` vs `[advisory]` tag + `evaluated N, failed M, warned K` count per APSS dimension. The agent knows which of the 8 dimensions (MT01, MD01, ST01, SC01, LG01, AC01, PF01, AV01) gated.
5. **Remediation hint.** When the gate fails on a deliberate refactor (not a regression), the gate's stdout includes the literal instruction `just sensors gate --update-baseline`. The agent reads it, runs it, reviews the resulting `baseline.json` diff, and commits the floor change alongside the refactor.
6. **Sibling doc.** `docs/sensors/closed-loop.md` (landed alongside this ADR) is the agent's primary reference for the loop's shape and remediation patterns. The doc is short by design — the verdict is the API; the doc explains the contract.

This is exactly the "agent-friendly mechanical gate" shape Anthropic and the operator-coding-flywheel discipline recommend: deterministic exit codes, structured stdout, no hidden state, no "ask the human what to do." The agent's next action is mechanically derivable from the gate's output.

### Why route the diagram through `apss code-topology viz` (not a separate viz tool)

The `apss code-topology viz` subcommand (provided by the packaged APS-V1-0001 crate) consumes the *same* `.topology/metrics/{modules,functions,coupling}.json` artifacts the gate consumes. This is load-bearing: it means the diagram cannot drift from what the gate measured, because both stages read the same source-of-truth artifacts.

A reasonable alternative would be to keep a separate diagram generator (Mermaid graph from dep-cruiser output, Graphviz from `.dependency-cruiser.cjs`, etc.). Rejected:

- Two diagrams would need to be kept in sync with two different measurement passes; drift is inevitable.
- The reader of the diagram has no way to verify the diagram matches what the gate measured.
- A second tool is a second install dependency for every consumer fork.

Using `apss run APS-V1-0001 viz` keeps one source-of-truth artifact pipeline. The diagram is generated on demand by the same `apss` composed binary the producer step uses. No extra dependency. No drift.

### Why "hard-enforce" and not "advisory-by-default"

A reasonable alternative would be to keep the closed loop as an *advisory* signal — produce artifacts every cycle, run the gate, but exit 0 even on regression and only log the diff. Rejected:

- Advisory gates do not change behavior; coding agents will silently regress architectural quality across commits and the floor will quietly erode.
- The baseline-floor model (ADR-0017 + ADR-0018 §Decision (1)) explicitly chose a hard-enforced floor with deliberate baseline updates as the only way to move it. An advisory mode contradicts that choice.
- The two genuinely-advisory dimensions (AC01, AV01) are already advisory in `gate.mjs#DIMENSIONS` and stay that way; they are advisory because they have no measurable adapter in a static template repo (no rendered frontend, no running service), not because architectural quality is optional.

### Why not direct `apss run APS-V1-0002` from the gate

This is settled by ADR-0018 §Decision (2) and not reopened by this ADR. Summary of the four-line reason:

- The §3.4 `INCUBATING_DIMENSION_ERROR_DOWNGRADED` downgrade on ST01/SC01/LG01/PF01 happens at the APSS layer, so direct invocation would lose the harness's enforcement posture on four dimensions where the harness has working adapters.
- The shim seam keeps the harness in control of the §6 composite score and §5 per-entity exceptions, instead of inheriting APSS's machinery wholesale.
- The R1 to R5 disclosure roadmap in `docs/standards-integration/fitness-function-APS-V1-0002.md` §7 is the channel for re-evaluating direct invocation upstream; until that closes, the shim seam preserves stance (3).
- This ADR is about producing real data each cycle, not about changing where the gate's enforcement code lives.

### Slot contract compatibility (review hook)

This ADR is a contract for the integration lane's wiring. The slot contract definitions live at:

- `harness.manifest.json#slots.{sensors,hooks,task-runner,agent-plugins}`;
- `scripts/lib/slots.ts` — the `SlotConfig` shape and `resolveSlotInvocation` resolver.

The integration lane's wiring is expected to:

- Leave `slots.sensors` unchanged. The producer is invoked *outside* the sensors slot's plugin entrypoint, before the slot's gate runs.
- Add an `apss install` step to `just bootstrap` (task-runner slot). Idempotent — `apss install` resolves from `apss.lock` and rebuilds only on lock changes.
- Add a producer step before the gate step on `pre-commit` and `pre-push` lefthook entries (hooks slot). Producer failure = cycle failure.
- Compose `just sensors gate` (task-runner slot) so a direct invocation also runs the producer first — the recipe a human or agent types should give the same closed loop the commit hooks give.
- Cross-link this ADR from `AGENTS.md` (and its committed symlinks `CLAUDE.md` / `.codex` / `.gemini`) so any agent reading the project's context on a fresh clone learns the closed-loop contract (agent-plugins slot).

### Alternatives considered

- **Run the producer once per `git push`, not per commit.** Cheaper. Rejected: a pre-commit-failing change can still land in the local tree if the producer only runs on push; the floor erodes silently between push events. The hard-enforce-every-commit shape is the operator framing recorded in ADR-0017 §"Discipline (operator framing, governance-every-run)."
- **Commit `.topology/metrics/*.json` to the repo.** Lets a fresh clone gate without running the producer. Rejected: creates a second source of truth (committed vs. regenerated); committed artifacts drift across branches; stale committed artifacts make the gate measure the *wrong* tree. Same reason build outputs aren't committed.
- **Commit the `apss code-topology viz` diagram.** Lets a reader see the diagram without running `apss`. Rejected: same drift problem as committed artifacts; doubles the rebase noise.
- **Make the closed loop opt-in per consumer fork.** Forks that don't want architecture-fitness gates can `apss remove APS-V1-0001`. Rejected for the *template*: the template's job is to make architectural quality a default. A fork that wants out can edit `APSS.yaml` and remove the producer step from its lefthook + justfile, paying the deliberate opt-out cost.
- **Hard-enforce the four contested dimensions (ST01/SC01/LG01/PF01) at the APSS layer by invoking `apss run APS-V1-0002` directly.** Already rejected by ADR-0018 §Decision (2); not reopened here.

### Backlinks

Code, docs, and manifests that will reference this ADR when the integration lane's wiring lands (add the exact identifier `ADR-0019-closed-loop-architectural-quality` when wiring):

- `harness.manifest.json#slots.sensors.implementation` — append "fed by APS-V1-0001 producer every cycle per ADR-0019."
- `harness.manifest.json#slots.hooks` — lefthook producer-then-gate entries on `pre-commit` and `pre-push`.
- `harness.manifest.json#slots.task-runner` — `just bootstrap` includes `apss install`; `just sensors gate` composes producer + gate.
- `harness.manifest.json#slots.agent-plugins` — point at `docs/sensors/closed-loop.md` and this ADR.
- `harness/sensors/README.md` — link this ADR alongside ADR-0017 and ADR-0018.
- `harness/sensors/apss_topology.mjs` — header comment updated to cite this ADR alongside ADR-0017.
- `harness/sensors/gate.mjs` — header comment cites this ADR as the "producer wired every cycle" closure.
- `AGENTS.md` (and its `CLAUDE.md` / `.codex` / `.gemini` symlinks) — short reference to "architecture-fitness is a closed loop; see ADR-0019 and `docs/sensors/closed-loop.md`."
- `docs/sensors/closed-loop.md` — companion doc that this ADR references; explains the loop and the agent-consumption contract.
- `docs/sensors/coverage-and-gate.md` — cross-link from the existing baseline-flow doc.
- `docs/standards-integration/fitness-function-APS-V1-0002.md` — note that the producer side of the loop is now closed; the R1 to R5 disclosure remains the open work.
- `APSS.yaml` / `apss.lock` — already declare APS-V1-0001 ≥ 0.2.0; no edit needed.

### Sources

- [ADR-0006 — Sensors](./ADR-0006-sensors.md) — the original sensors slot; preserved.
- [ADR-0010 — Doc Validator](./ADR-0010-doc-validator.md) — the augment-don't-replace precedent later codified by ADR-0018.
- [ADR-0017 — Sensors v0.3 — APSS canonical, sentrux preserved](./ADR-0017-sensors-v03-apss-canonical.md) — the shim-seam decision this ADR closes the loop around.
- [ADR-0018 — APSS v1.1.0 integration — augment, never replace](./ADR-0018-apss-v1-1-0-augmentation.md) — the routing-via-shim decision this ADR preserves.
- [`docs/standards-integration/fitness-function-APS-V1-0002.md`](../standards-integration/fitness-function-APS-V1-0002.md) — the integration analysis and R1 to R5 disclosure roadmap.
- [`docs/standards-integration/doc-standard-APS-V1-0003.md`](../standards-integration/doc-standard-APS-V1-0003.md) — the parallel docs-standard closure; same augment-not-replace shape.
- [`docs/sensors/coverage-and-gate.md`](../sensors/coverage-and-gate.md) — the existing operator-facing baseline-update flow.
- [`docs/sensors/closed-loop.md`](../sensors/closed-loop.md) — the agent-facing companion doc landed alongside this ADR.
- `apss` v1.1.0 — packaged CLI, `cargo install apss`.
- AgentParadise standards system: https://github.com/AgentParadise/agent-paradise-standards-system.

### When to re-evaluate

- The producer step measurably regresses cycle latency on a consumer fork (sub-second target violated for large monorepos). Re-evaluate incremental-mode flag or producer-on-push-only with a separate fast pre-commit gate.
- APS-V1-0001's composed-binary shape changes such that the artifact paths (`.topology/metrics/{modules,functions,coupling}.json`) move. Update the shim's `findTopologyFiles` accordingly; this ADR's contract is "the producer materializes the artifacts the shim reads," which is stable under filename changes if `findTopologyFiles` is updated in lockstep.
- The R1 to R5 disclosure on ST01/SC01/LG01/PF01 closes upstream and direct `apss run APS-V1-0002` from `gate.mjs` becomes the better routing. That promotion is owned by a successor to ADR-0018; the closed-loop shape this ADR records is orthogonal and survives.
- A coding agent reports that the gate's stdout shape is hard to consume mechanically (regex-breaking, line-order non-deterministic, ambiguous remediation). Re-evaluate `renderReport` for stricter agent ergonomics; the contract this ADR fixes is "structured stdout consumable by any coding agent," not the specific current line shapes.
- `apss code-topology viz` is deprecated or replaced upstream. Re-evaluate Decision (3) — the diagram is regenerable from the same artifacts by whatever the successor tool is.
