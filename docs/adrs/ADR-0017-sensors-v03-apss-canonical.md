---
name: "Sensors v0.3 — APSS canonical, sentrux preserved"
description: "Promote APSS to canonical cross-language measurement; keep sentrux as an opt-in available adapter (deliberate both-vs-reduce decision, not a deletion)"
status: accepted
---

# ADR-0017: Sensors v0.3 — APSS canonical, sentrux preserved

**Date:** 2026-05-30
**Category:** Slot
**Supersedes:** ADR-0006-sensors (partial — promotes APSS to canonical primary; preserves the slot's plug-and-play adapter seam; preserves sentrux as an opt-in adapter)
**Next review:** 2026-11-30

## Context

[ADR-0006-sensors](./ADR-0006-sensors.md) established the sensors slot as a Rust aggregator with swappable per-language adapters: dep-cruiser, ts-morph, grimp, cargo-modules, go-arch-lint, and sentrux. That ADR is unchanged.

Between 2026-05-14 (when ADR-0006 was written) and 2026-05-18, the upstream R&D lab made a measurement-layer decision recorded in [`agentic-harness-lab/docs/standard/decisions/sensors-v0.3-apss-canonical.md`](https://github.com/NeuralEmpowerment/agentic-harness-lab/blob/main/docs/standard/decisions/sensors-v0.3-apss-canonical.md): APSS (Architecture Policy Score Sheet — the AgentParadise topology + policy standard) becomes the **canonical** cross-language measurement layer. Lab-internal language-specific adapters (grimp, dep-cruiser+ts-morph, etc.) move from "canonical signal" to "reference implementations preserved for testbed use", and the slot exposes APSS readings as the primary signal that `harness-sensors gate` validates against.

The bead `create-harness-app-n48.7` originally framed this as *"mark sentrux RETIRED"*. The operator corrected that framing mid-task (`create-harness-app-n48.3` description): **do not unilaterally retire sentrux**. The sensors slot is a dependency-injection seam that can hold multiple plugin adapters; record both APSS-canonical and sentrux as available, and make the both-vs-reduce trade-off a deliberate, recorded decision rather than a silent deletion.

This ADR is that recorded decision. It is additive to ADR-0006, not a replacement.

## Decision

Two related decisions, both accepted:

1. **APSS is canonical.** When a consumer fork wires sensor gates into CI, the primary signal is the APSS topology output (`.topology/metrics/modules.json` + `functions.json`) consumed by `harness-sensors`. The Martin Ca/Ce/I/A/D readings emitted by the current Node aggregator (`harness/sensors/aggregate.mjs` + `abstractness.mjs`) are kept as a working starter while the APSS adapter-shim port lands (separate bead).

2. **Sentrux is preserved, not retired.** Sentrux remains an *available* adapter in the slot's plugin catalog. It is not promoted to canonical, not vendored into the default agent image, and not removed from the manifest. Forks that want the AI-governance overlay opt in by declaring sentrux in their own policy file. Lab reference implementations for grimp / dep-cruiser / ts-morph / cargo-modules / go-arch-lint are likewise preserved as available adapters; the v0.3 agent image's choice to drop them from the *baked* image does not propagate to this template's *catalog*.

Concretely:

- `harness.manifest.json#slots.sensors.plugin` stays as `harness-sensors`.
- `harness.manifest.json#slots.sensors.implementation` text adds an APSS-canonical reference; sentrux is described as "available, opt-in" rather than "AI-governance overlay (canonical)".
- A new (deferred) `harness/sensors/adapters/` catalog enumerates each adapter and its status (canonical / available / experimental). This ADR does not require that catalog to exist yet; subsequent bead lands it.
- `ADR-0006-sensors.md` is unchanged. Its "Current pick" section still describes the v0.2 adapter set; this ADR layers on top.

## Consequences

- **Preservation-first holds.** No adapter is deleted from the manifest, the README, or the source tree. Sentrux specifically remains a documented option for forks that need its 52-language tree-sitter overlay. This is the operator's explicit framing: record decisions as ADRs, keep lab reference implementations.
- **One canonical signal for gates.** Forks that wire `just sensors gate` into pre-push or CI get a single APSS-canonical pass/fail rather than a fan-out of per-language adapter verdicts. Reduces governance noise; keeps the Ford/Parsons/Kua fitness-function contract clean.
- **Migration cost is deferred and explicit.** The current Node aggregator stays functional. The APSS adapter shim (`apss_topology` per the lab's spec, ~358 LOC + 11 tests) lands in a separate bead. Until then, the gate runs on the Node aggregator's output; the swap is a transparent later step.
- **Adapter set in ADR-0006 is preserved verbatim.** No "deprecated" sweep on per-language adapters; their lifecycle is governed by their own maintenance signal (the table in ADR-0006 § "Maintenance signal").
- **APSS-version vs harness-sensors-version mismatch risk** (flagged in the lab's APSS-canonical record) is inherited by any fork that opts in. The mitigation is documented at the lab; this template references it rather than reinventing.

## Details — the both-vs-reduce trade-off (deliberate)

A reasonable alternative was to *reduce* the adapter catalog — pick APSS as canonical, drop the per-language adapters from the slot entirely, vendor sentrux out. That move:

- Simplifies the slot's surface area.
- Aligns with the lab's v0.3 agent-image trim.
- Costs preservation: dropped adapters are not recoverable without a re-port.
- Violates the operator's preservation rule.

The decision is to **keep both**:

- APSS is the canonical signal a gate validates against.
- The per-language adapters remain available in the catalog. A fork can opt to run them in addition to APSS, or instead of APSS for a specific dimension where the adapter is more precise than APSS's cross-language averaging.
- Sentrux specifically stays as an available overlay because (a) it has no canonical replacement for the 52-language tree-sitter modularity signal, and (b) the operator surfaced this as the test case for the preservation rule.

The cost of keeping both is documentation overhead (this ADR + the adapter-catalog bead) and a slightly larger plugin matrix in the manifest. The benefit is that no consumer fork wakes up to find a tool they relied on has been silently removed.

## Backlinks

Code and docs that reference this decision (add the exact identifier `ADR-0017-sensors-v03-apss-canonical` when implementing):

- `harness/sensors/` — the Rust aggregator's `Cargo.toml` and the bin entrypoints (when the APSS adapter shim lands).
- `harness/sensors/aggregate.mjs` — currently the working Node aggregator; will be replaced when the APSS shim lands.
- `harness/sensors/abstractness.mjs` — likewise.
- `harness.manifest.json#slots.sensors` — when the implementation text is updated.
- `docs/harness-engineering/references/anthropic-effective-harnesses.md`, `docs/harness-engineering/lab-five-principles.md` — the broader discipline backdrop.
- `docs/coordination/APSS-ADR-STANDARD.md` — the ADR shape this record conforms to.

Upstream lineage (lab):

- [`agentic-harness-lab/docs/standard/decisions/sensors.md`](https://github.com/NeuralEmpowerment/agentic-harness-lab/blob/main/docs/standard/decisions/sensors.md) — original sensors decision (v0.2 reference).
- [`agentic-harness-lab/docs/standard/decisions/sensors-v0.3-apss-canonical.md`](https://github.com/NeuralEmpowerment/agentic-harness-lab/blob/main/docs/standard/decisions/sensors-v0.3-apss-canonical.md) — the source of the canonical-promotion decision.

## When to re-evaluate

- A unified cross-language A/I/D tool ships that subsumes APSS (re-evaluate canonical).
- Sentrux maintenance lapses (>6 months no release): move from "available" to "deprecated, kept for reference".
- APSS adapter shim lands and the Node aggregator is retired — re-evaluate which adapters remain "available" vs "experimental".
- Any fork reports CI-cost or governance-noise pain from running multiple adapters in parallel — re-evaluate the both-vs-reduce trade-off.
