# Gap analysis 05 — APSS conformance

> **Mode:** discovery + planning input.
>
> **Companion docs:** [`01-harness-engineering.md`](./01-harness-engineering.md), [`02-decisions-adr.md`](./02-decisions-adr.md), [`03-harness-implementation.md`](./03-harness-implementation.md), [`04-learnings-examples.md`](./04-learnings-examples.md), [`00-consolidated.md`](./00-consolidated.md).
>
> **APSS spec sources read:** (1) [`docs/coordination/APSS-ADR-STANDARD.md`](../coordination/APSS-ADR-STANDARD.md) — the in-template APSS ADR01 migration contract; (2) [`agentic-harness-lab/docs/standard/decisions/sensors-v0.3-apss-canonical.md`](https://github.com/NeuralEmpowerment/agentic-harness-lab/blob/main/docs/standard/decisions/sensors-v0.3-apss-canonical.md) — the lab's APSS-canonical sensors decision; (3) lab `docs/specs/20260529_cha-canonical-readme.md` § APSS mentions.
>
> **Companion ADR (this commit):** [`ADR-0017-sensors-v03-apss-canonical.md`](../adrs/ADR-0017-sensors-v03-apss-canonical.md) records the deliberate both-vs-reduce decision: APSS canonical, sentrux preserved.

## 1. APSS standard surface — what conformance means

Two distinct APSS surfaces are in play:

| Surface | What it specifies | Spec location |
|---|---|---|
| **ADR01** | Architecture-decision-record shape: directory path, filename pattern, frontmatter, required sections, identifier rules, backlink convention. | [`docs/coordination/APSS-ADR-STANDARD.md`](../coordination/APSS-ADR-STANDARD.md) (in-template), based on `AgentParadise/agent-paradise-standards-system` PR 61. |
| **Sensors v0.3 / topology + policy** | An `aps` binary emits `.topology/metrics/{modules,functions}.json` (15-metric per-entity schema). A `governance.toml` declares per-sensor thresholds + ignore + exclude rules. A `fitness-toml-bridge` binary converts a `fitness.toml` input into the governance.toml shape `harness-sensors gate` consumes. | Lab `sensors-v0.3-apss-canonical.md` + lab `harness/sensors/docs/plugin-protocol.md` (draft v0.3). |

**ADR01 required surface:**
- Directory: `docs/adrs/` (plural).
- Filename: `ADR-NNNN-kebab-case-title.md` (4-zero-padded digits).
- Context files: `docs/adrs/CLAUDE.md` + `docs/adrs/AGENTS.md`.
- Frontmatter: `name`, `description`, `status` (proposed / accepted / deprecated / superseded).
- Required body sections: `## Context`, `## Decision`, `## Consequences`.
- Metadata block: `Date`, `Category` (required); `Supersedes`, `Superseded by`, `Next review` (conditional).
- Backlink rule: implementation files cite the ADR by exact filename stem (`// Implements ADR-0006-sensors`).
- Index: `docs/adrs/README.md` carries the `| Document | Description |` table from frontmatter.

**Sensors v0.3 required surface (per the lab's APSS-canonical record):**
- `aps` binary (cross-language: Rust / Python / TS / TSX) emitting `.topology/metrics/modules.json` + `functions.json` with 15+ metrics per entity.
- `governance.toml` with `[per_sensor]`, `[ignore]`, `[exclude]` sections.
- `fitness.toml` as the consumer-facing input; `fitness-toml-bridge` (~322 LOC, 7 tests) converts it to `governance.toml`.
- `apss_topology` adapter shim (~358 LOC, 11 tests) bridges APSS output → `harness-sensors` semantics.

## 2. ADR01 conformance (per-ADR shape)

`docs/gap-analysis/02-decisions-adr.md` already covered the per-ADR pattern check. **Cliffs notes here, not duplicated:**

| Check | Result |
|---|:-:|
| Filename pattern (`ADR-NNNN-kebab-case.md`, 4-digit) | 16 / 16 ✓ |
| Frontmatter (`name`, `description`, `status`) | 16 / 16 ✓ |
| Status lifecycle (Fowler proposed/accepted/deprecated/superseded) | 14 accepted, 2 proposed, 0 deprecated/superseded ✓ (no evolution yet — this commit adds the first `Supersedes` annotation via ADR-0017) |
| `## Context` / `## Decision` / `## Consequences` | 16 / 16 ✓ |
| `Date` + `Category` metadata | 16 / 16 ✓ |
| `docs/adrs/CLAUDE.md` + `AGENTS.md` context files | 2 / 2 ✓ |
| `docs/adrs/README.md` Index table | ✓ |

**Single new conformance event this commit:** ADR-0017 introduces the first `Supersedes:` annotation, pointing at ADR-0006 (partial). Lifecycle now exercises evolution.

**Outstanding ADR01 conformance gap (not in 02):** the `docs/coordination/APSS-ADR-STANDARD.md` file is a *non-structural Markdown file* inside the project but is itself NOT in `docs/adrs/`, which the spec explicitly allows. However it warns: *"This file is a temporary coordination document, not an ADR. Remove it or move it outside `docs/adrs/` before final ADR01 validation, because ADR01 validates every non-structural Markdown file in the ADR directory against the ADR naming pattern."* The file is currently at `docs/coordination/`, so it's already out of the ADR dir — the warning is honored. **No gap on this surface.**

## 3. APSS measurement-layer conformance (sensors)

| APSS-required item | Template state | Gap |
|---|---|---|
| `aps` binary | not present | ❌ Full — no binary in template. |
| `governance.toml` (per-sensor + ignore + exclude) | not present | ❌ Full — referenced in ADR-0006's "What this means for your fork" snippet but no actual file. |
| `fitness.toml` | not present | ❌ Full. |
| `fitness-toml-bridge` binary | not present | ❌ Full. |
| `apss_topology` adapter shim | not present | ❌ Full — template uses its own `harness/sensors/aggregate.mjs` + `abstractness.mjs` instead. |
| Per-entity metric output (modules + functions JSON with 15 dims) | partial — emits Ca/Ce/I/A/D per module via Node aggregator | ⚠️ Same dimensions for Martin metrics; missing the 11 other APSS dims (cognitive, cyclomatic, function-level rollups, etc.). |

**State:** the template ships ADR-0006-sensors as a *v0.2 consumer summary* with a hybrid disclaimer pointing at the lab's v0.3 evolution. ADR-0017 (this commit) records the **deliberate** decision to promote APSS to canonical while keeping the current Node aggregator + sentrux + the per-language adapters as available options. The actual *implementation* swap is governed by beads `n48.3` (port APSS), `n48.4` (gate), `n48.5` (cognitive-complexity dimension).

## 4. APSS governance-on-every-run conformance

The operator's mid-task framing: **fitness functions that run continuously on every commit and CI, not on-demand report-only.** Audit:

| Hook stage | Gate | Fitness-function dimension | APSS-aligned? |
|---|---|---|---|
| pre-commit | `biome-format-lint` | formatting / lint | No — categorical, not a fitness threshold. |
| pre-commit | `secret-scan` (gitleaks) | secrets presence | No — categorical. |
| pre-commit | `ubs-staged` (UBS — Ultimate Bug Scanner) | bug patterns | No — categorical/AST. |
| pre-push | `typecheck-affected` | TS strict-typing | Categorical. |
| pre-push | `test-affected` | test pass | Categorical. |
| pre-push | `scripts-coverage` (vitest, 100/100/100/100) | line/branch/function/statement coverage | **Yes** — the only true fitness gate the template enforces today. |
| pre-push | `ubs-diff` | bug patterns vs base | Categorical. |
| **anywhere** | **sensors Ca/Ce/I/A/D** | **Martin coupling/abstractness/distance** | **No — report-only, gate deferred to n48.4.** |
| **anywhere** | **cognitive / cyclomatic complexity** | **per-function cognitive load** | **No — adapter not built; bead n48.5.** |
| **anywhere** | **doc-validator** | **broken markdown links, ADR shape, principle ↔ ADR ↔ skill round-trip** | **No — stub; bead n48.6.** |
| **anywhere** | **template hygiene** | **CLAUDE.md / README / manifest consistency** | **No — `template-hygiene-gate.mjs` not ported from lab/harness/hooks.** |
| **anywhere** | **performance** | **p95 latency / startup time** | **No — bead n48.13 (startup-time gate).** |

**Net:** 1 of 6 Martin/APSS fitness dimensions is gated today (coverage). The other 5 are documented but unenforced. The operator's north star is closing this gap; beads `n48.4`, `n48.5`, `n48.6` are the explicit closure items.

## 5. Preservation-first compliance

Operator rule: **never delete; record decisions as ADRs; keep lab reference implementations.**

| Item | Status | Notes |
|---|---|---|
| `ADR-0006-sensors.md` lists sentrux as active text | ✓ unchanged in this commit | ADR-0017 layers on top without rewriting; preserved as the v0.2 record. |
| Sentrux preserved as available adapter | ✓ recorded in ADR-0017 § Decision (2) | Both APSS-canonical AND sentrux are in the adapter catalog. |
| Lab `harness/sensors/` reference implementation | ✓ preserved upstream | The Rust crate stays in the lab; this template's Node aggregator is the working starter per ADR-0017 § Consequences. |
| Lab `harness/doc-validator/` reference impl | ✓ preserved upstream | Template's bash stub is the placeholder; `n48.6` ports the lab's Rust crate without removing it from the lab. |
| Lab `harness/stack/` reference impl | ✓ preserved upstream | Template's Rust stub is a placeholder; lab's Node/TS impl stays in lab. |
| Per-language adapters (grimp / cargo-modules / go-arch-lint) in ADR-0006 | ✓ unchanged | ADR-0017 § Decision (2) explicitly preserves them as available adapters. |
| Any silent deletion in the template's `docs/adrs/` corpus | ✓ none | 02-decisions-adr.md confirms 15/16 lab decisions ported + 1 template-local. No deletions. |

**Compliance: clean.** The operator's preservation rule was the framing for ADR-0017 itself, so this report and that ADR are mutually consistent.

## 6. APSS conformance beads — file, defer, or already covered

| APSS surface | Bead status |
|---|---|
| ADR01 shape (directory, filename, frontmatter, sections) | ✓ already conformant; no bead needed. |
| ADR01 backlinks (`// Implements ADR-NNNN-slug` in code) | ❌ not enforced; **covered by `n48.6`** (doc-validator's principle ↔ ADR ↔ skill round-trip). |
| `aps` binary in template | ❌ not present; **covered by `n48.3`**. |
| `governance.toml` in template | ❌ not present; **covered by `n48.3` + `n48.4`** (gate file). Also a candidate for a small standalone bead for the **eat-own-dogfood seed** — see Section 7. |
| `fitness.toml` + `fitness-toml-bridge` | ❌ not present; **part of `n48.3`** (the larger APSS port). |
| `apss_topology` adapter shim | ❌ not present; **part of `n48.3`**. |
| Cognitive / cyclomatic dim | ❌ not present; **`n48.5`** filed. |
| Sentrux + APSS both-vs-reduce decision recorded | ✓ closed by ADR-0017 in this commit. |
| Pre-push fitness gate for Ca/Ce/I/A/D | ❌ not present; **`n48.4`** filed (baseline-snapshot mode). |
| Image distribution (APSS in agent image) | ⚠️ not relevant for the template (no agent image); upstream concern. |

**New bead to file (this pass):** none — the surface is already covered by `n48.3 / n48.4 / n48.5 / n48.6` plus ADR-0017. A *small* additive bead for the `.harness/governance.toml` seed could simplify `n48.4`'s scope, but the existing P0 covers it sufficiently.

## 7. The `.harness/governance.toml` foundation

The lab's `harness/.harness/governance.toml` (37 lines, per gap report 03 § A1) is the file the harness gates itself against — eat-own-dogfood foundation. Currently absent from the template.

**Recommendation (additive, not a bead — implemented inline this commit):** scaffold a placeholder `.harness/governance.toml` in the template with the lab's current rule set verbatim (preserve the upstream values; consumers ratchet up). The file is not yet consumed by any gate (that lands under `n48.4`), but its presence:

- Makes the lab→consumer lineage visible.
- Gives `n48.4` a starting input rather than a blank slate.
- Surfaces the "harness eats its own dogfood" principle as a tangible artifact, not just a sentence in `docs/harness-engineering/lab-five-principles.md`.

The seed file is a discovery artifact only until `n48.4` consumes it.

## Provenance

- **Inventory pass timestamp:** 2026-05-30.
- **Sub-agent:** one Explore agent walked the APSS spec surfaces + template's ADR / sensors / manifest layout. This report incorporates its findings.
- **Cross-checks:** every "missing" item verified against the live template tree (`harness.manifest.json`, `harness/sensors/`, `docs/adrs/`).
- **Companion artifacts in this commit:** ADR-0017 (recorded both-vs-reduce decision) + `.harness/governance.toml` seed.
