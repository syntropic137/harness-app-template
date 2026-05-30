# Harness-engineering gap report — lab → this template

> **Bead:** `create-harness-app-n48`.
> **Date:** 2026-05-30.
> **Author:** CobaltWaterfall (claude-code / opus-4.7).
> **Scope per operator:** broad comparison of the upstream lab (`NeuralEmpowerment/agentic-harness-lab`) against this template, framed through the OpenAI harness-engineering lens (context engineering · architectural constraints & fitness functions · entropy management). Scope cuts: **do not port the 82 lab experiments**; retrospectives are nice-to-have only. The lab's `docs/harness-engineering/README.md` and its five principles are the priority port (done in the same commit as this report).
> **North star (operator addition mid-task):** the harness exists for **built-in continuous architectural governance on every run** — every commit and every CI cycle, not on-demand report-only. Fitness functions in the Ford/Parsons/Kua *Building Evolutionary Architectures* sense. The five principles, the sensors slot, and the doc-validator all bend toward this. The gap report below is reorganized around it.

## TL;DR

The template carried over the **shape** of the harness (slot picks under `docs/adr/`, justfile + lefthook, sensors slot, observability stack) but not the **governance posture**: nothing in this fork continuously enforces architectural fitness on every commit. The sensors slot computes Martin Ca/Ce/I/A/D but is report-only. No cognitive-complexity sensor exists. The doc-validator slot is a stub, so principles + ADRs can rot silently. And the discipline doc that names "harness engineering" as a thing was missing — closed in this same commit by porting [`docs/harness-engineering/README.md`](./harness-engineering/README.md).

The gaps below are graded by how directly they block the *governance-every-run* north star.

## Method

1. **Walked the lab** at `/home/ubuntu/Code/NeuralEmpowerment/agentic-harness-lab/docs/{harness-engineering,standard,evolution,retrospectives,specs,journal,experiments}` with read-only sub-agents.
2. **Inventoried this template** at `/home/ubuntu/Code/syntropic137/harness-app-template/docs/` and across `harness.manifest.json`, `lefthook.yml`, `.claude/skills/`, root-level `CLAUDE.md`/`README.md`/`security.md`.
3. **Reviewed the upstream skills plugin** at `github.com/syntropic137/harness-engineering/skills/` (13 principle skills) and compared it against this repo's 5 in-tree skills.
4. **The OpenAI "Harness Engineering" page** (`https://openai.com/index/harness-engineering/`) returns HTTP 403 to non-browser fetches; this report engages with its named pillars — *context engineering*, *architectural constraints & fitness functions*, *entropy management* — as concepts, not by quotation.
5. **Building Evolutionary Architectures (Ford/Parsons/Kua)** is the framing for "fitness function" — a mechanical, continuous, automatable check that a named architectural characteristic still holds under change. Not an audit. Not a report. A *gate*.

## The governance-every-run lens

| What "good" looks like | Where this template stands today |
|---|---|
| Every commit triggers a deterministic check that the architecture is still in spec. | Partial. Lefthook pre-commit runs Biome + Gitleaks + UBS (diff-scoped). Pre-push adds typecheck, test, 100%-coverage, UBS. **No sensors gate.** **No cognitive-complexity gate.** **No doc-validator.** |
| Every architectural characteristic the team cares about has a **named** fitness function (latency, coupling, complexity, abstractness, documentation completeness, etc.). | Coverage = yes. Coupling/abstractness = computed but not enforced (sensors slot, report-only). Latency = no. Cognitive complexity = no. Doc completeness = no. |
| The fitness function has a **budget** and breaks the build when violated. | Only coverage (`vitest --coverage --thresholds 100`). Sensors deliberately deferred. |
| The discipline itself is documented and audit-able. | Was missing; closed by [`docs/harness-engineering/README.md`](./harness-engineering/README.md) in this commit. |
| The agent has a routing path from "I touched X" to "audit dimension Y". | Partial. `CLAUDE.md` names 5 in-tree skills; the lab's 13-skill `harness-engineering` plugin (with `harness-review` orchestrator) is not wired up. |

The gaps below are scored against this table.

## Framing: the three pillars

| Pillar | Concrete meaning in this template's terms |
|---|---|
| **Context engineering** | What the agent can *see* at any moment: CLAUDE.md content + size, skill catalogue + routing descriptions, ADR placement + readability, evidence directories, decision rationale that survives across sessions. The agent's autonomy is the size + quality of its context. |
| **Architectural constraints and fitness functions** | Mechanical gates that bind every change: pre-commit + pre-push hooks, coverage thresholds, secret scanning, the sensors-slot Martin metrics **enforced as gates**, the Standard's slot contracts, cognitive-load budgets. *Continuous, not on-demand.* |
| **Entropy management** | How the harness stays coherent as it grows: a hypothesis-first experiment cadence, retrospectives that distill into durable principles, upstream/downstream sync, an audit pass that flags drift before it compounds, a doc-validator that prevents principle rot. |

---

## Pillar 1 — Context engineering

What the agent can see when it runs.

### G1 — No "what is harness engineering?" hub doc ❌ → ✅ closed in this commit

| | |
|---|---|
| **Lab has** | `docs/harness-engineering/README.md` (9.1 KB) — discipline, five load-bearing principles, "are/aren't building" rules, canonical artifact map. |
| **Template had** | Nothing. The word "harness" appears in `CLAUDE.md` and `README.md` but no doc defined the discipline. |
| **Closed by** | [`docs/harness-engineering/README.md`](./harness-engineering/README.md) ported in this commit, adapted for consumer-fork framing. |
| **Bead** | n/a — closed in this commit. |

### G2 — Upstream-update mechanism missing

| | |
|---|---|
| **Lab has** | `docs/harness-engineering/upstream-update-flow.md` (5.2 KB): provenance block (`.harness-provenance.json`), Tier-1 (manual cherry-pick), Tier-2 (semi-automated crawler), Tier-3 (LLM-as-judge). |
| **Template has** | Hints in `docs/updating.md` (10 KB) and the new `docs/adr/0015-cha-sync-source-of-truth.md`, but no explicit upstream→downstream contract that an agent can mechanically follow. |
| **Why this is a governance gap, not just a doc gap** | Without a written-down sync mechanism the principles + ADRs *in this fork* drift silently from the lab. The governance-every-run posture is undermined the moment the spec a gate checks against goes stale. |
| **Proposed bead** | port `upstream-update-flow.md` adapted for "we are now the downstream"; include a provenance check in `just doctor`. |

### G3 — Skills catalog is thin; lab's audit-style principle skills not wired up

| | |
|---|---|
| **Template ships** | 5 skills under `.claude/skills/`: `before-after-evidence`, `chrome-devtools-deep`, `observability-queries`, `playwright-debug`, `running-experiments`. Concrete + tactical. |
| **Upstream plugin ships** | 13 skills under `syntropic137/harness-engineering/skills/`: `application-legibility`, `approved-scenarios`, `authoring-skills`, `autonomous-validation-loop`, `browser-legibility`, `harness-review`, `long-running-durability`, `performance-gates`, `repo-knowledge-map`, `skill-testing`, `telemetry-pipeline`, `telemetry-query`, `worktree-isolation`. Principle-doc, audit/build-mode skills with deep routing descriptions. |
| **Overlap** | `observability-queries` ↔ `telemetry-query` (template = concrete LogsQL recipes; lab = the discipline of agent-queryable telemetry). `playwright-debug` + `chrome-devtools-deep` ↔ `browser-legibility`. `before-after-evidence` ↔ `application-legibility` (partial — template is artifact-shaped, lab is design-shaped). `running-experiments` has no lab counterpart. |
| **Direct connection to governance-every-run** | The lab ships a `harness-review` meta-skill that fans out across the other 10 principle skills as an orchestrator. **That is the audit-pass-on-demand** that complements the on-commit gates. Without it the agent has no routing from "I touched X" to "audit dimensions Y, Z." |
| **Are agents *using* skills today?** Mostly the 5 in-tree ones. The 13 upstream are unreachable from this fork. |
| **Recommended posture (don't copy — reference)** | The upstream skills are a maintained Claude plugin (`.claude-plugin` at the root of `syntropic137/harness-engineering`). Vendoring duplicates load-bearing prose that drifts. Install the plugin and reference it from `CLAUDE.md`, with a note for each that isn't yet useful in this template's shape (e.g., `worktree-isolation` is moot until the template ships per-task worktree wiring). |
| **Proposed beads** | (a) install / reference the upstream `harness-engineering` plugin and document the routing surface in `CLAUDE.md`. (b) audit the 5 in-tree skills against their lab counterparts and decide for each: keep, merge-with-upstream-by-reference, or retire. |

### G4 — ADR format: now numbered (`docs/adr/0001-*.md`), no shape template yet

| | |
|---|---|
| **State (post-rename by another agent in this session)** | `docs/decisions/<slot>.md` → `docs/adr/0001-stack-manager.md`...`0016-createapp-wrapper-design.md`. The README index is at `docs/adr/README.md`. **The renumbering is already done — this bead can close as observation.** |
| **What's still missing** | A `_template.md` at `docs/adr/` showing the canonical ADR shape (Status / Context / Decision / Consequences) so future records have a stable form. |
| **Connection to governance-every-run** | The doc-validator slot (currently a stub) should eventually *enforce* the ADR shape — see G11. |
| **Proposed bead** | small: add `docs/adr/_template.md` documenting the shape; cross-reference from `docs/harness-engineering/README.md`. |

### G5 — No versioned Standard doc

| | |
|---|---|
| **Lab has** | `docs/standard/v0.1.md`, `v0.2.md` — the prose contract document. Slot ADRs reference it. |
| **Template has** | `harness.manifest.json` (machine-readable, `standard: "0.2"`) but no `docs/standard/v0.2.md` describing the contract for humans + auditors. |
| **Connection to governance-every-run** | A versioned Standard is what fitness functions can check *against*. Today there's no spec for them to enforce. |
| **Proposed bead** | port `docs/standard/v0.2.md` adapted for this fork. |

---

## Pillar 2 — Architectural constraints and fitness functions

The Ford/Parsons/Kua frame: a fitness function is a *mechanical, continuous, automatable* check that an architectural characteristic still holds under change. Not a report. Not an audit pass. A **gate**. This is where the template is most behind the north star.

### G6 — Sensors slot is report-only; the policy gate is the load-bearing gap ⚠️ P0

| | |
|---|---|
| **Status** | The sensors slot computes per-folder + per-module Martin Ca/Ce/I/A/D (commits `0029d03` + `a893b33`). `just sensors report --format json` prints the numbers. **Nothing fails the build when they regress.** `harness/sensors/README.md` documents this as deferred until a consumer fork has ≥ 50 modules. |
| **Why the existing deferral is no longer enough** | The whole *point* of the harness is built-in continuous architectural governance. Report-only sensors are infrastructure without the gate. The "≥ 50 modules" guardrail was framed as a threshold-noise concern; with the governance-every-run lens, the right move is to **wire the gate now**, with starting-budget *baselines* learned from the current readings, and let the budgets evolve as the codebase grows. |
| **Proposed bead** | wire `harness/sensors/gate.mjs`: reads the merged Martin report, compares against a `harness/sensors/budgets.toml` (per-folder I/D ceilings, with `mode: 'baseline'` until a real threshold is set), exits non-zero on regression. Add `just sensors gate` and a `pre-push` lefthook entry. Start mode is *baseline-snapshot-and-forbid-worsening*, not "fail when I > 0.8." |
| **Priority** | **P0.** This is the single biggest gap against the north star. |

### G7 — No cognitive-complexity sensor ⚠️ P1

| | |
|---|---|
| **State** | The sensors slot covers *coupling-shaped* architectural characteristics (Ca/Ce/I) and one *abstractness-shaped* one (A). It does **not** cover **cognitive complexity** (cyclomatic, nesting depth, lines-per-function, parameter count) — the local readability dimension. |
| **Why this matters under governance-every-run** | Coupling can be clean and the code still be unreadable. A 200-line method with depth-7 nesting passes every Martin metric. Agents in particular degrade fast on high-cognitive-complexity code (they make wrong edits because they can't hold the function in context). |
| **Concrete tool picks worth WebSearching before committing (per principle 1: measured, not assumed)** | `eslint-plugin-sonarjs` (cognitive-complexity rule), `lizard` (multi-language cyclomatic), `tokei` (LOC only). Probably one of the first two plus a small adapter in the sensors slot. |
| **Proposed bead** | add a `complexity.mjs` adapter to `harness/sensors/`, mirroring the `abstractness.mjs` shape. Initial metric: per-function cyclomatic + cognitive complexity, rolled to per-module medians + p95s. Pair with G6's gate so a regression past a budget breaks the build. |
| **Priority** | **P1.** Second-biggest gap. |

### G8 — No performance/latency fitness functions

| | |
|---|---|
| **Lab has** | A `performance-gates` skill — p50/p95/p99 latency, startup time, span duration; tools = hyperfine, pytest-benchmark, criterion, k6, Lighthouse; wired as CI gates. |
| **Template has** | `vitest run --coverage` at 100% lines/branches/functions. **Nothing on latency.** |
| **Proposed bead** | wire a minimal startup-time gate for `example-typescript` using hyperfine. Declare a budget. Fail pre-push on regression > N%. |
| **Priority** | **P2.** Important but the codebase is too thin for latency to bite first. |

### G9 — APSS-canonical / sentrux-retired status not ported (correctness)

| | |
|---|---|
| **Lab has** | `docs/standard/decisions/sensors-v0.3-apss-canonical.md` — declares sentrux **retired** from the v0.3 agent image, replaced by APSS (Architecture Policy Score Sheet) as the canonical measurement layer. |
| **Template has** | `docs/adr/0006-sensors.md` still references sentrux as an "AI-governance overlay." This fork is misrepresenting a tool the upstream has retired. |
| **Proposed bead** | mark sentrux as superseded in `0006-sensors.md`; add a short APSS-canonical record (either as content in `0006` or as a follow-on numbered ADR). |
| **Priority** | **P1.** Correctness fix. |

### G10 — No executive-summary measurement rollup

| | |
|---|---|
| **Lab has** | `docs/executive-summary.md` (8.1 KB) — always-current rollup of what's been measured across all experiments. |
| **Template has** | Nothing. Two experiments to date (`experiments/2026-05-30--depcruiser-arch-quality/` and the ts-morph A adapter probe) but no rollup. |
| **Connection to governance-every-run** | The summary is what tells the agent and the operator *what the current budgets are, where they came from, and which gates were last calibrated*. |
| **Proposed bead** | seed `docs/executive-summary.md` with the two completed experiments + the to-be-added sensors-gate baseline. |
| **Priority** | **P2.** |

---

## Pillar 3 — Entropy management

How the harness stays coherent over time.

### G11 — Doc-validator slot is a stub; no enforcement of ADRs, principles, or cross-references ⚠️ P1

| | |
|---|---|
| **Manifest says** | `doc-validator` plugin = `harness-doc-validator` v0.1-stub. Implementation: "Stubbed bin entrypoint; replace with the Rust validator when the real plugin lands." |
| **What it should do under governance-every-run** | Mechanically enforce: every ADR has Status/Context/Decision/Consequences; every principle in `docs/harness-engineering/README.md` is cross-referenced from at least one ADR or skill; every link inside `docs/` resolves; every file the manifest claims exists actually exists; the provenance block matches the upstream sha. **Documents never silently rot.** |
| **Operator's exact phrasing** | "never lose documentation: ADRs and principles preserved and enforced by doc-validator." |
| **Proposed bead** | populate `harness/doc-validator/`. Phase 1: link-checker + ADR-shape validator + manifest-cross-reference validator. Phase 2: principle ↔ ADR ↔ skill round-trip check. Wire as a `pre-push` hook so principle drift breaks the build. |
| **Priority** | **P1.** |

### G12 — No retrospectives directory at all

| | |
|---|---|
| **Lab has** | `docs/retrospectives/` — 24 retros distilled from experiments. |
| **Template has** | `experiments/<date>--<slug>/` directories without paired retros. |
| **Per operator scope cut** | This is nice-to-have. The right move is a small seed, not a full port. |
| **Proposed bead** | (P3) seed `docs/retrospectives/` with distilled retros for the two completed experiments. |

### G13 — No evolution doc (per-cycle synthesis)

| | |
|---|---|
| **Lab has** | `docs/evolution/v0.2.0-evolution.md`, `v0.3.0-evolution.md`, `v0.4.0-evolution.md`. |
| **Template has** | A bare `CHANGELOG.md`. |
| **Proposed bead** | (P3) port the *pattern*; start `docs/evolution/v0.4.x-evolution.md` capturing this fork's arc (sensors slot population over the last three beads, the ADR renumbering, the harness-engineering port). |

### G14 — Skills aren't auto-discovered in non-interactive `claude -p` runs; no `harness-review` orchestrator

| | |
|---|---|
| **Observation** | `CLAUDE.md` already tells delegated `claude -p` runs to invoke skills by bare name. With 5 in-tree skills + 13 upstream-plugin skills (once G3 lands), no agent will remember all of them. |
| **Why this is an entropy problem** | Without an orchestrator the agent never audits across dimensions. Coverage degrades silently — exactly the failure mode this whole report is fighting. |
| **Proposed bead** | (depends on G3) add a `just review` recipe that runs the upstream `harness-review` skill's cross-dimensional audit, gated on the same `pre-push` hook as the rest of the governance layer. |
| **Priority** | **P2** (blocked on G3). |

---

## Summary table of beads to file

Ranked by impact on the governance-every-run north star.

| # | Title | Pillar | Priority |
|---|---|---|---|
| (closed) | Port lab `docs/harness-engineering/README.md` | Context | done in this commit |
| 1 | **Sensors slot enforces thresholds as a pre-push gate** (with baseline-snapshot mode for thin codebases) | Constraints | **P0** |
| 2 | **Add cognitive-complexity sensor** (cyclomatic + cognitive) + wire into the gate from #1 | Constraints | **P1** |
| 3 | **Populate doc-validator slot** so ADRs + principles + cross-refs are enforced on every commit | Entropy | **P1** |
| 4 | Mark sentrux retired in `0006-sensors.md`; port APSS-canonical record | Constraints | **P1** |
| 5 | Port `upstream-update-flow.md` adapted for downstream + `just doctor` provenance check | Context | **P1** |
| 6 | Install / reference upstream `harness-engineering` Claude plugin from `CLAUDE.md` | Context | **P1** |
| 7 | Audit in-tree skills against upstream principle skills; decide keep/merge/retire | Context | P2 |
| 8 | Port `docs/standard/v0.2.md` adapted for this fork | Context | P2 |
| 9 | Add `docs/adr/_template.md` documenting the ADR shape | Context | P2 |
| 10 | Wire a minimal startup-time fitness function (hyperfine on `example-typescript`) | Constraints | P2 |
| 11 | Add `just review` orchestrator that fans out across audit dimensions | Entropy | P2 (blocked on #6) |
| 12 | Seed `docs/executive-summary.md` with the two completed experiments | Constraints | P2 |
| 13 | Seed `docs/retrospectives/` with retros for the two completed experiments | Entropy | P3 |
| 14 | Start `docs/evolution/v0.4.x-evolution.md` for this fork's arc | Entropy | P3 |

## What is explicitly *not* a gap (per scope cuts)

- **82 lab experiments** — out of scope. Load-bearing for the lab, not for a consumer fork.
- **Retro-by-retro port** — downgraded to a single P3 bead that seeds a distilled subset.
- **ADR renumbering** — *already done in this session* by another agent (`docs/decisions/*.md` → `docs/adr/0001-*.md` ... `0016-*.md`). No bead.
- **`docs/journal/`** — beads + Agent Mail cover the in-flight context need at this template's scale.
- **Sensors policy gate "deferred until 50 modules"** — that framing is **superseded** by the governance-every-run lens. The new framing is *baseline-snapshot-and-forbid-worsening* now, with thresholds promoted as the codebase grows.

## Anchoring back to principles

- **Principle advanced:** #1 (measured, not assumed — the report itself is a measurement against the upstream), and #5 (eats its own dogfood — the consumer fork audits itself against its upstream). The proposed P0/P1 beads advance #2 (token-aware: ubs + sensors gates compress audit signal into pass/fail) and #5 (the harness gates its own code via #1 + #2 + #3).
- **Measurement gap closed by this commit:** the absence of a written-down discipline doc was an unstated assumption. The port closes it.
- **Downstream consumer surfaced:** the operator running this template's `create-harness-app` workflow.
- **What this rules out:** chasing 82 experiments into the fork; vendoring the upstream skills plugin; treating sensors as forever-report-only.
