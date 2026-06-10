# Gap analysis 00 — Consolidated rollup

> **Mode:** consolidation of all five gap-analysis discovery passes + the closure plan + the first implementing step.
>
> **Parent bead:** [`create-harness-app-n48`](../../.beads/issues.jsonl) — "Gap analysis + port: harness-engineering knowledge from lab not carried into template" (P1, open).
>
> **Per-area discoveries (read these for evidence; this file is the rollup):**
> 1. [`01-harness-engineering.md`](./01-harness-engineering.md) — the discipline doc + standard doc + canonical references catalog.
> 2. [`02-decisions-adr.md`](./02-decisions-adr.md) — per-ADR inventory + APSS ADR01 conformance.
> 3. [`03-harness-implementation.md`](./03-harness-implementation.md) — `lab/harness/` slot implementations vs template.
> 4. [`04-learnings-examples.md`](./04-learnings-examples.md) — retrospectives, leverage reviews, evolution docs, experiments.
> 5. [`05-apss-conformance.md`](./05-apss-conformance.md) — APSS surface conformance.
>
> **Operator framing (this is what the closure plan is measured against):**
> - **Built-in continuous architectural governance on every run** — fitness functions in the Ford/Parsons/Kua sense, enforced at pre-commit + pre-push + CI, not on-demand report-only.
> - **Preservation-first** — never delete; record decisions as ADRs; keep lab reference implementations.
> - **Authoritative source for harness-engineering** is `github.com/NeuralEmpowerment/neural-hermes-data` at `knowledge-management/areas/code/agentic-engineering/harness-engineering` (the lab is itself derivative).
> - **Scope cuts:** 82 lab experiments out; retrospectives nice-to-have (seed only); UE-specific work out of scope.

## TL;DR

The template extraction carried the **shape** of the harness (slot picks, ADRs, basic plumbing) but did not carry the **discipline + governance** layer. Five passes (01–05) inventoried the gap. The largest gaps are:

1. **Discipline doc citation lineage** — closed by commit `7d32493` (canonical neural-hermes-data port + the 11-row References table).
2. **APSS canonical measurement + sentrux preservation** — closed at the ADR layer by `ADR-0017` (this commit).
3. **`.harness/governance.toml` foundation** — eat-own-dogfood seed file ported in this commit.
4. **`harness/sensors/` Rust crate** with 5 adapters + plugin discovery + gate — the largest single implementation gap; closure governed by `n48.3 / n48.4 / n48.5`.
5. **`harness/doc-validator/` Rust crate** — `n48.6`.
6. **`template-hygiene-gate.mjs`** — _initially planned as a port; on re-read the lab file is **lab-only by design** (path-filtered to `templates/` + `harness/create-harness-app/`, neither of which this template has). Not a port. See "Reversal noted" below._
7. **Continuous-governance pre-push gates** — 1 of 6 architectural-fitness dimensions enforced today (coverage); the rest are filed as P0/P1 beads.

This commit closes items 2, 3, and 6 and lays out the plan for the rest.

## Consolidated finding table

| Area | Finding | Closure bead / artifact |
|---|---|---|
| Discipline doc (principles + references) | Lab port had body but dropped citation catalog; canonical is neural-hermes-data with 11-row table | **Closed** in `7d32493` (port + cross-check) + memory `preserve-references-on-port.md`. |
| ADR shape (APSS ADR01) | 16/16 conformant; no `Supersedes` annotations until this commit | **Closed** by ADR-0017 in this commit (first `Supersedes` annotation). |
| sentrux retired vs preserved | Operator correction: preserve as available, don't retire | **Closed** by ADR-0017 (recorded both-vs-reduce decision). |
| APSS canonical measurement layer | `aps` binary + `governance.toml` + `fitness.toml` + `apss_topology` + `fitness-toml-bridge` all absent | Beads `n48.3` (port) + `n48.4` (gate) + `n48.5` (cognitive dim). |
| `.harness/governance.toml` eat-own-dogfood seed | Lab has 37-line file at `lab/harness/.harness/governance.toml`; template has nothing | **Closed** in this commit — seeded from lab values, not yet consumed by a gate (`n48.4` consumes). |
| `harness/sensors/` Rust crate (5 adapters, plugin discovery, gate) | Lab ~5,686 LOC + 95/94 % coverage; template ~18 KB Node ESM + 2 adapters, report-only | Beads `n48.3` + `n48.4` + `n48.5` (multi-step). |
| `harness/doc-validator/` Rust crate | Lab 638 LOC; template 18-line bash stub | Bead `n48.6`. |
| `harness/stack/` Node/TS impl (5 commands, 714 LOC, 15 tests) | Lab has working impl; template has 51-LOC Rust stub | **New bead this pass** (P2) — "Port lab `harness/stack/` Node/TS as the working stack-manager until the Rust binary lands." |
| `harness/hooks/template-hygiene-gate.mjs` | Lab file is **lab-only by design** (path-filtered to `templates/` + `harness/create-harness-app/`); template has neither path | **Not ported** — port would be inert. Deferred until/unless the template grows a `templates/` sub-tree. See "Reversal noted" below. |
| `harness/versioning/` Rust crate | Lab has 301-LOC binary wrapping cocogitto; template has cocogitto wired globally but no orchestrator crate | **New bead this pass** (P3). |
| `harness/downstream-crawler/` | Only `target/` visible in lab; source elsewhere | Investigate under existing `n48.8` (upstream-update-flow port + provenance). |
| `harness/inspector-ue/` + `harness/ue-plugin/` | UE-specific | Out of scope. **No bead.** |
| Pre-push fitness gates | Only `scripts-coverage` (vitest 100/100/100/100) enforced as a fitness function; Martin Ca/Ce/I/A/D, cognitive, cyclomatic, latency all unenforced | Beads `n48.4`, `n48.5`, `n48.13` (startup-time). |
| `upstream-update-flow.md` Tier 1/2/3 mechanism | Not ported; cited in `docs/harness-engineering/README.md` as "deferred" | Bead `n48.8`. |
| Standard prose docs (`v0.2.md`, `polyglot-monorepo-structure.md` with 18 citations) | Not ported | Bead `n48.11`. |
| Lab retrospectives + evolution docs | Not ported (scope-cut to seed-only) | Beads `n48.16` (retros) + `n48.17` (evolution) — P3. |
| BoringBot extractive summary in `references/` | Missing | Bead `n48.18`. |

## The full closure-bead inventory under `create-harness-app-n48`

All filed; ranked by impact on the governance-every-run north star.

| # | Title | Priority | Lifecycle status |
|---|---|---|---|
| n48 (parent) | Gap analysis + port | P1 | **open** — closing incrementally |
| n48.3 | Port APSS-canonical sensors + keep sentrux available | P1 | open |
| n48.4 | Sensors slot enforces architectural budgets as a pre-push gate (baseline-snapshot mode) | **P0** | open |
| n48.5 | Add cognitive-complexity sensor (cyclomatic + cognitive) | P1 | open |
| n48.6 | Populate doc-validator (enforce ADRs, principles, cross-references) | P1 | open |
| n48.7 | Sensors plugin landscape: record APSS canonical AND sentrux as available, decide both-vs-reduce deliberately | P1 | **closing now via ADR-0017** |
| n48.8 | Port `upstream-update-flow.md` + provenance check | P1 | open |
| n48.9 | Install / reference upstream `harness-engineering` Claude plugin | P1 | open |
| n48.10 | Audit in-tree skills against upstream principle skills | P2 | open |
| n48.11 | Port `docs/standard/v0.2.md` + `polyglot-monorepo-structure.md` | P2 | open |
| n48.12 | Add `docs/adrs/_template.md` documenting the ADR shape | P2 | open |
| n48.13 | Startup-time fitness function (hyperfine) | P2 | open |
| n48.14 | `just review` orchestrator | P2 | open (blocked on n48.9) |
| n48.15 | Seed `docs/executive-summary.md` | P2 | open |
| n48.16 | Seed `docs/retrospectives/` | P3 | open |
| n48.17 | Start `docs/evolution/v0.4.x-evolution.md` | P3 | open |
| n48.18 | BoringBot extractive summary | P3 | open |
| **new** | **Port lab `harness/stack/` Node/TS as working stack-manager** | P2 | **to be filed** |
| **new** | **Port lab `harness/versioning/` Rust crate** | P3 | **to be filed** |

---

# Planning — the remaining closure

The plan is organized by the operator's three explicit follow-up items.

## Plan 1 — Sensors APSS swap

The largest implementation gap. Multi-step, governed by ADR-0017 (this commit) at the decision layer.

**Subplan:**

1. **Land `.harness/governance.toml`** (this commit) — preserved seed from lab, not yet consumed.
2. **Land sensors gate (n48.4) in baseline-snapshot mode** — read the current Node aggregator's output, persist as a baseline file, fail on any worsening. No APSS dependency yet. *Smallest first step that exercises the gate path; this is what unlocks the governance-every-run north star.*
3. **Add cognitive-complexity adapter (n48.5)** — `complexity.mjs` next to `aggregate.mjs` + `abstractness.mjs`. Reuses existing aggregator path. WebSearch eslint-plugin-sonarjs / lizard / tokei before deciding the tool.
4. **Port APSS adapter shim (n48.3 — first half)** — `apss_topology` adapter (~358 LOC in the lab; preserve the Node aggregator alongside per ADR-0017). Output joins the existing aggregator's input set, doesn't replace it. New ADR if the swap changes consumer-facing shape.
5. **Port `fitness-toml-bridge` (n48.3 — second half)** — converts `fitness.toml` → `governance.toml` for the gate's consumption.
6. **Promote `governance.toml`** from seed to gate-consumed.
7. **Optional: port the lab Rust crate** as a longer-term swap — only when the Node aggregator's limits bite. Both stay in tree per preservation rule.

**Branching:** each step is its own commit; the in-tree Node aggregator stays working at every step.

## Plan 2 — sentrux + APSS both-vs-reduce (RECORDED, not deletion)

Closed at the decision layer by **ADR-0017** in this commit.

Concretely the ADR commits to:
- Sentrux stays in the adapter catalog as `available`, not retired.
- APSS becomes canonical for the slot's primary signal.
- The lab's per-language adapters (grimp, cargo-modules, go-arch-lint, dep-cruiser, ts-morph) stay in the catalog as `available`.
- No change to `harness.manifest.json` plugin name; only the `implementation` text updates (next step under n48.3).
- A future `harness/sensors/adapters/` catalog file will enumerate each adapter's status. Not required for this commit.

The implementing follow-up is to update ADR-0006's "Maintenance signal" table to add an "Available status" column once the catalog file lands — under bead `n48.3`.

## Plan 3 — Lab harness engine ports

Per gap report 03 § Top-5 leverage:

| Order | Port | Source | Bead |
|---:|---|---|---|
| 1 | `.harness/governance.toml` seed | `lab/harness/.harness/governance.toml` (37 lines) | **this commit** |
| 2 | _(reserved; was `template-hygiene-gate.mjs` — see Reversal note below)_ | — | — |
| 3 | `harness/doc-validator/` Rust crate (638 LOC) | `lab/harness/doc-validator/` | `n48.6` |
| 4 | `harness/sensors/` APSS adapter pieces (incremental) | `lab/harness/sensors/` | `n48.3` (multi-step under Plan 1) |
| 5 | `harness/stack/` Node/TS impl | `lab/harness/stack/` | **new bead this pass** (P2) |
| 6 | `harness/versioning/` Rust crate | `lab/harness/versioning/` | **new bead this pass** (P3) |
| — | `harness/downstream-crawler/` source | `lab/harness/downstream-crawler/` (source elsewhere) | investigate under `n48.8` |

**Preservation discipline at every port:** the lab's reference implementation stays in the lab; the template's port is additive. No `git rm` operations on lab files.

---

# First implementing step (this commit)

Three small ports + the recorded ADR. Each preserves the upstream and adds new in-tree material.

| Artifact | Source | Target | Test |
|---|---|---|---|
| ADR-0017 (the recorded both-vs-reduce decision) | derived from operator framing + lab `sensors-v0.3-apss-canonical.md` | `docs/adrs/ADR-0017-sensors-v03-apss-canonical.md` | ADR-shape gate (when `n48.6` lands) — not yet enforced. |
| ADR-0006 `Superseded by:` backlink | bidirectional ADR pointer per APSS ADR01 | `docs/adrs/ADR-0006-sensors.md` metadata block | Doc-validator (when `n48.6` lands) will enforce. |
| `.harness/governance.toml` seed | `lab/harness/.harness/governance.toml` (verbatim 37 lines) | `.harness/governance.toml` | Inline TOML-parse smoke before commit: `python3 -c "import tomllib; tomllib.load(open('.harness/governance.toml','rb'))"` returns clean. |

Each port carries the lab's content verbatim where the contract is shared.

**Reversal noted:** an earlier draft of this plan included porting `harness/hooks/template-hygiene-gate.mjs`. The lab file's header declares it *"Lab-only by design"* with a path-filter that only fires when the push touches `templates/` or `harness/create-harness-app/`; this template has neither path, so a verbatim port would be inert. Dropped from the first-step scope at the time.

**Reversal superseded (2026-06-11, bead `create-harness-app-port-template-hygiene-hook-rh2`):** the gate was ported with adapted semantics rather than verbatim. This repo has no scaffolder, so the pre-commit port path-filters on this repo's own hygiene-critical surfaces (`lefthook.yml`, `justfile`, `harness/hooks/`, `scripts/{init,update,bootstrap}.ts`, `scripts/lib/`) and runs a fast structural validation (lefthook config validity, justfile parse, hook-script syntax checks). The deep scaffold-and-smoke equivalent remains `just fork-check`.

## Provenance

- **Pass timestamp:** 2026-05-30.
- **Sub-agents:** two Explore agents (gap-03 harness implementations + gap-05 APSS conformance) on top of two earlier (gap-01 docs + ADR fidelity spot-checks).
- **Decisions recorded:** ADR-0017 (this commit) + memory `preserve-references-on-port.md` (saved 2026-05-30 earlier in the session).
- **Implementing artefacts this commit:** ADR-0017 (recorded both-vs-reduce decision), ADR-0006 `Superseded by:` backlink, `harness/.harness/governance.toml` seed (the file is at the `harness/.harness/` slot path matching the lab's location; an explicit `!harness/.harness/` un-ignore line lands in `.gitignore` to allow it under the consumer-side `.harness/` exclusion).
