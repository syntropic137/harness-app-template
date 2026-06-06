---
name: "Quality gates are compositional slots"
description: "Quality gates compose via slots that accept multiple provider inputs; portable standards and harness-native rules layer in the same slot rather than competing"
status: accepted
---

# ADR-0018: Quality gates are compositional slots

**Date:** 2026-06-06
**Category:** Cross-cutting
**Next review:** 2026-12-06

## Context

[ADR-0006-sensors](./ADR-0006-sensors.md) and [ADR-0017-sensors-v03-apss-canonical](./ADR-0017-sensors-v03-apss-canonical.md) established the sensors slot, the adapter seam, and the promotion of APSS as the canonical cross-language measurement layer. [ADR-0013-coverage-enforcement](./ADR-0013-coverage-enforcement.md) recorded the high-threshold coverage gates. [ADR-0010-doc-validator](./ADR-0010-doc-validator.md) wired the documentation contract gate. Each of these records picks a tool. None of them states the load-bearing shape that the harness as a whole assumes about quality gates.

The shape was implicit until now: every gate is structured as a slot whose contract sits inside the harness core, but whose enforcement set is built by composing inputs from multiple providers. That structure is the reason an APSS standard and a harness-native rule can coexist inside the same gate without one displacing the other, and the reason a future standard (the [EXP-V1-0004 documentation standard](../standards-integration/doc-standard-EXP-V1-0004.md)) plugs in by adding inputs rather than rewriting the slot.

The catalyst for recording this now is the operator decision to adopt [APSS APS-V1-0002](../standards-integration/fitness-function-APS-V1-0002.md) as a fitness-gate slot input. That adoption forces an enforcement-posture choice that the existing ADRs do not cover: APSS marks only two of its eight dimensions `active`, treats the other six as `incubating` per spec section 3.4, and downgrades configured `error` severities to `warning` on incubating dimensions unless the consumer locally promotes them. The harness already enforces six of the eight dimensions. Reconciling that without either silently overriding the standard or surrendering the harness's enforcement posture requires the compositional-slot framing to be explicit, so future contributors can apply the same shape to other gates without re-deriving it.

## Decision

Three related decisions, all accepted.

**Decision 1: quality gates are compositional slots.**

A quality gate in the harness is a named slot. The slot's contract (its inputs, its outputs, its exit-code policy, its evidence emission) lives inside the harness core and is the same for every fork. The slot's *enforcement set* is built by composing inputs from multiple providers. A provider supplies rules; the slot composes them; the harness core executes the composition. Extension means adding a new provider input to a slot. Extension does not mean editing the slot's contract, and it does not mean editing the harness core.

**Decision 2: portable standards and harness-native rules are co-equal inputs.**

A slot accepts two classes of input on equal footing.

- A portable standard is one input. Portable standards are universal, vocabulary-stable, and authored outside this repository. They travel between projects without modification. APSS APS-V1-0002 is the worked example: the harness consumes its eight-dimension registry, its lifecycle semantics, its diagnostic codes, and its report shape.
- A harness-native rule is the other input. Harness-native rules are opinionated, repository-specific, and authored inside this template. They encode decisions that depend on local context (build budgets, supported runtimes, evidence-capture requirements) and that should not pretend to be universal.

Both classes compose in the same slot. Neither subordinates the other. The slot's composition step decides per-rule severity, per-rule evidence requirements, and the resulting exit code; provider identity is metadata on each rule, not a privileged category.

**Decision 3: applied to the fitness-gate slot.**

The fitness-gate slot composes the following inputs.

- APSS APS-V1-0002 is adopted as a slot input. The harness enforces the six dimensions the operator has declared active for this template: MT01, MD01, ST01, SC01, LG01, and AC01. MT01 and MD01 are natively `active` per APSS. ST01, SC01, LG01, and AC01 are `incubating` per APSS; the harness locally promotes them to enforced through the spec section 3.4 carve-out (`PROMOTION_REQUIREMENT_UNMET` is acknowledged as the expected upstream diagnostic) and records the promotion in this ADR per the carve-out's documentation requirement.
- AC01 (accessibility) is upgraded from advisory to enforced in this slot input. The promotion is deliberate. The rationale is recorded in this ADR rather than in `gate.mjs` so that an upstream APSS promotion of AC01 to `active` can collapse the local promotion without code churn.
- Performance enforcement is a harness-native slot input, not an APSS PF01 input. Performance SLOs are repository-specific (per-fork startup budgets, per-fork latency targets, per-fork journey budgets) and APSS keeps PF01 incubating with no universal threshold. The harness-native rule supplies the threshold; the slot composes it alongside the APSS rules.
- AV01 (availability) stays advisory. The standard keeps AV01 incubating; no fork in scope has a repository-local availability SLO that warrants promotion; the slot still emits the advisory signal for evidence purposes.

These four bullets are the slot's current composition. Future inputs (a different fitness standard, a new harness-native rule, a per-fork override) plug in by adding entries to this composition rather than by editing the slot or the core.

## Consequences

- **What this enables.** New providers extend the harness by adding slot inputs. Adopting a future portable standard (such as the EXP-V1-0004 documentation standard) is a slot-input addition to the doc-validator slot; it does not require touching the slot's contract or the harness core. The same pattern applies to a future supply-chain standard for the secret-scanner slot, a future strict-typing standard for the strict-typing audit recorded in [ADR-0014-strict-typing](./ADR-0014-strict-typing.md), and any other gate added later.
- **Standards stay universal, the harness stays opinionated.** The portable standards the harness adopts are not modified in the slot. They remain re-usable by other consumers exactly as authored. The harness's repository-specific opinions (enforcement posture, local SLOs, evidence requirements) live in the harness-native inputs and in this ADR, not in the standard. The two never merge.
- **Extension is additive.** Adding a rule, a dimension, an adapter, or a whole new provider is an additive change. Removing a provider is also additive in the sense that the slot's contract stays intact; only the composition shrinks. The harness core is not touched in either case. This is the structural reason the operator can preserve sentrux per [ADR-0017](./ADR-0017-sensors-v03-apss-canonical.md) without forking the slot.
- **What this constrains.** No slot may bake provider identity into its contract. A slot that hard-codes a single provider (for example, an early version of `gate.mjs` that knew only about hand-rolled rules and not about externally authored standards) is a contract violation under this ADR and is refactored to a composition step before its next change. A future provider that wants to bypass the slot composition step and call the harness core directly is also out of contract.
- **Section 3.4 promotions are ADR-bound.** Any local promotion of an APSS `incubating` dimension from advisory to enforced (or any equivalent promotion under a future portable standard) requires an ADR entry that names the dimension, names the promotion target, and names the conditions under which the local promotion collapses. The promotion lives in the ADR, not in the slot's code; the slot's code reads the ADR-anchored decision and applies it. This ADR's Decision 3 itself records four such promotions (ST01, SC01, LG01, AC01) as the canonical worked example.
- **Migration cost.** None for already-shipped slots that already compose. The sensors slot already supports the adapter seam per [ADR-0006](./ADR-0006-sensors.md) and the APSS-canonical promotion per [ADR-0017](./ADR-0017-sensors-v03-apss-canonical.md); its current shape is the reference implementation of this ADR's framing. Slots that do not yet compose (any slot whose enforcement set is implicitly single-provider) are flagged for refactor on their next change; no upfront rewrite is required.
- **Preservation audit.** The compositional framing preserves every prior pick. ADR-0006's adapter catalog, ADR-0010's doc-validator rule set, ADR-0013's coverage thresholds, and ADR-0017's both-vs-reduce decision all become slot-input records under the same shape. No prior ADR is invalidated or rewritten by this one.

## Details

### Alternatives considered

**Alternative A: standard-only enforcement.** Adopt APSS APS-V1-0002 verbatim and downgrade every harness-native rule that does not have a portable-standard analogue. Rejected: this surrenders the harness's repository-specific opinions (startup budgets, evidence requirements, project-specific exclusions) and replaces a working enforcement set with the standard's incubating posture on four of the six dimensions the harness already enforces. The operator's framing under `create-harness-app-n48` is explicit that the harness stays opinionated; this alternative violates that framing.

**Alternative B: harness-only enforcement.** Treat APSS as inspiration, reimplement equivalent rules in the harness core, and skip standard adoption. Rejected: this duplicates standard work in the slot, drops the upstream lineage, and prevents consumers from reading the same vocabulary the standard authors use. It also breaks the preservation-first rule: the lab's investment in the APSS adapter shim becomes unreachable.

**Alternative C: pick a winner per dimension.** For each of the eight APSS dimensions, pick either APSS or a harness-native rule as the sole input. Rejected: this is a special case of A or B applied dimension-by-dimension and inherits both alternatives' costs. It also hard-codes provider identity into the slot's per-dimension behavior, which is the exact contract violation this ADR's Decision 1 forbids.

**Alternative D (chosen): compose.** Both classes of input are first-class. The slot's composition step is the single decision point about severity, evidence, and exit code. This is the only alternative that preserves the harness's enforcement posture, preserves the standard as a portable artifact, and keeps extension additive.

### Worked example: the documentation standard

[EXP-V1-0004](../standards-integration/doc-standard-EXP-V1-0004.md) is the documentation standard the operator expects to adopt next. Under this ADR, that adoption is a doc-validator slot-input addition. The slot's contract (parse markdown, validate cross-references, fail the gate on a documented finding) does not change. The standard's rules become one provider input; the existing harness-native rules (the ADR shape check, the manifest decisionAt check, the harness-engineering README check) remain another provider input. The slot composes both; the gate behaves the same way from the consumer's perspective.

### Backlinks

Code, manifests, and ADRs that reference this decision (use the exact identifier `ADR-0018-quality-gate-slot-composition` when implementing, per the doc-validator backlink check):

- `harness/sensors/gate.mjs` and `harness/sensors/baseline.json` are the current concrete instance of a slot composition. The APSS adoption recorded here updates this file's dimension postures (ST01, SC01, LG01, AC01 enforcement) and adds the harness-native performance input as a separate composition entry; the file remains the reference implementation of the compositional shape.
- `harness.manifest.json#slots` already names each slot and its `decisionAt`. No schema change is required by this ADR; the manifest's slot-by-slot framing already matches the compositional shape.
- `docs/standards-integration/fitness-function-APS-V1-0002.md` is the research record that scoped this adoption. This ADR records the resulting decision.
- [`docs/coordination/APSS-ADR-STANDARD.md`](../coordination/APSS-ADR-STANDARD.md) is the ADR shape this record conforms to.
- The doc-validator (`harness/doc-validator/src/validators.rs`) enforces ADR shape and backlink presence; both [`docs/adrs/CLAUDE.md`](./CLAUDE.md) and [`docs/adrs/AGENTS.md`](./AGENTS.md) carry the backlink guidance this ADR relies on.

### Operational notes

- **Adding a slot input.** Author the provider's rules in the form the slot expects (TOML rule entry for the fitness slot, ADR file for the doc-validator slot, and so on). Add the input to the slot's composition manifest. Run the slot's gate; the composition step picks up the new entry without code changes in the slot. Add or update an ADR if the input promotes an incubating standard dimension or otherwise introduces a repository-specific opinion.
- **Removing a slot input.** Remove the entry from the slot's composition manifest. The slot's contract continues to apply. If the removed input was a portable-standard adoption, retain the ADR that recorded the original adoption and add a successor ADR that records the removal and its rationale.
- **Re-evaluation triggers.** Re-open this ADR when: APSS promotes any of ST01, SC01, LG01, or AC01 to `active` upstream (collapse the corresponding local promotion); APSS publishes a universal PF01 threshold (re-evaluate whether the harness-native performance input collapses into APSS PF01); a portable standard ships that overlaps a different slot (doc-validator, secret-scanner, versioning) and forces the same composition decision; or a fork reports that the compositional model has become harder to extend than a flat-list alternative.

### Sources

- The APSS adoption analysis lives at [`docs/standards-integration/fitness-function-APS-V1-0002.md`](../standards-integration/fitness-function-APS-V1-0002.md); its TL;DR enumerates the dimension-by-dimension status, the spec section 3.4 carve-out, and the operator-facing trade-off. This ADR records the resulting decision rather than re-stating the analysis.
- The compositional framing is the structural restatement of the preservation-first rule recorded in [ADR-0017](./ADR-0017-sensors-v03-apss-canonical.md) and elaborated under bead `create-harness-app-n48`. ADR-0017 records the preservation pattern for one slot (sensors); this ADR generalizes that pattern across every quality-gate slot.
