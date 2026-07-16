---
name: "APSS code-topology 0.3.0 upgrade — re-enable APSS cognitive/cyclomatic as an MT01 source"
description: "Records the Phase B upgrade of the APSS code-topology pin from 0.2.x to 0.3.0 (SonarSource-faithful cognitive complexity, AgentParadise PR #90 + #112) and the re-enabling of APSS function values as a source for the MT01 max-cognitive and max-cyclomatic metrics. Under 0.2.0 APSS over-counted cognitive complexity (off-by-one nesting, per-case switch/match charging, logical-run and parens deviations), so PR #55 sourced these two metrics from the TS-only ts-morph complexity.mjs adapter as an interim — correct for TypeScript but leaving Rust cognitive/cyclomatic ungated. With 0.3.0 the over-count is fixed and verified against SonarSource reference values, so APSS is restored to the source set, the two MT01 floors are re-derived to admit the Rust functions newly in scope, and Rust cognitive gating is recovered."
status: accepted
---

<!--
ADR-0030 — closes issue #58 Phase B. Phase A (upstream, AgentParadise):
merged PR #90 (nesting off-by-one + per-case switch/match) and PR #112
(the six SonarSource follow-ups: range-fallback routing, try/catch,
ternary, else-if, logical-operator runs incl. parens transparency,
Python match, generators, labeled break/continue), published as
code-topology 0.3.0 / aps-cli 1.4.0 on crates.io. This ADR records the
template-side consequence and the baseline re-derivation. It does NOT
change the ratchet mechanics (ADR-0020), the reading taxonomy /
fail-closed profiles (ADR-0028), the size-invariance admission rule
(ADR-0029), or APSS's canonical status (ADR-0017); it restores a source
that ADR-0017 always intended and PR #55 only suspended.
-->

# ADR-0030: APSS code-topology 0.3.0 upgrade — re-enable APSS cognitive/cyclomatic as an MT01 source

**Date:** 2026-07-16
**Category:** sensors slot (harness/sensors/gate.mjs, harness/sensors/baseline.json, APSS.yaml, apss.lock)
**Supersedes:** none (completes the interim taken in PR #55; complements [ADR-0017](./ADR-0017-sensors-v03-apss-canonical.md) § canonical-signal posture and [ADR-0029](./ADR-0029-fitness-metric-size-invariance.md) § re-derivation discipline)
**Next review:** 2027-01-16

## Context

MT01 `max-cognitive` and `max-cyclomatic` watch the peak per-function
complexity across the workspace. Their canonical source is the APSS
code-topology adapter, which analyzes every supported language (Rust,
TypeScript, Python) — this is the property that lets the metric gate the
harness's own Rust code, not just the TypeScript product.

APSS `apss-v1-0001-code-topology` 0.2.0 over-counted cognitive
complexity, proven against the [SonarSource reference
algorithm](https://www.sonarsource.com/docs/CognitiveComplexity.pdf):
an off-by-one nesting penalty (the function's own node counted as a
nesting level), per-case `switch`/`match` charging (SonarSource charges
the structure once, not per arm), and — surfaced by the multi-model
review panel on the fix itself — several further deviations (logical
operator runs, parenthesized same-operator transparency, try/catch
nesting direction, ternary nesting, else-if, Python `match`, generators,
labeled break/continue).

As an interim, [PR #55] re-sourced both metrics from the template's own
ts-morph `complexity.mjs` adapter, which implements the SonarSource
algorithm correctly. That was accurate **for TypeScript** but
`complexity.mjs` is TS-only, so **Rust cognitive/cyclomatic went
ungated** for the duration of the interim.

## Decision

Upstream (Phase A) fixed the over-count in AgentParadise PR #90 (nesting
+ switch/match) and PR #112 (the six SonarSource follow-ups), each
validated with fail-before/pass-after reference-value tests and an
independent Codex + Gemini review panel, and published it as
code-topology **0.3.0** / aps-cli **1.4.0** on crates.io.

Template-side (Phase B):

1. **Pin bump.** `APSS.yaml` `code-topology >= 0.3.0`; `apss.lock` and
   the CI `fitness`/test job install `apss` 1.4.0.
2. **Re-enable APSS as a source.** `gate.mjs` `max-cognitive` and
   `max-cyclomatic` are again `max()` over the APSS function values AND
   the ts-morph `complexity.mjs` module/folder values, restoring Rust
   gating.
3. **Re-derive the two floors.** Bringing 23 Rust harness files back into
   scope raises the observed peaks: `max-cognitive` 8 → **15**
   (`extract_links` in `harness/doc-validator/src/scanner.rs`, verified a
   genuine SonarSource-15) and `max-cyclomatic` 6 → **9**
   (`resolve_all_with` in `harness/config-manager/src/resolver/mod.rs`).
   These floor moves are recorded as `BASELINE-RELAX-OK` entries labelled
   **scope expansion, not a code regression** — the honest audit trail
   the [ADR-0029](./ADR-0029-fitness-metric-size-invariance.md) /
   [ADR-0028](./ADR-0028-fail-closed-fitness-profiles.md) baseline guard
   requires for any loosening direction.

The re-derivation is deliberately **surgical**: only these two floors
move. A blanket `--update-baseline` also re-derives dormant local-only
metrics (halstead, sentrux, coverage, duration) against whatever adapters
happen to be present on the developer's machine, which is exactly the
local-churn the CI-authority + relax-marker design exists to prevent. CI
remains the canonical ratchet authority.

## Consequences

- **Rust cognitive/cyclomatic is gated again** — the harness's own Rust
  code is held to the same peak-complexity bar as the product.
- `extract_links` sits **at the cap** (cognitive 15, `default_threshold`
  15). It is the first ratchet-down candidate; a follow-up refactor
  lowers it and tightens the floor.
- APSS 0.3.0 additionally emits Halstead volume, which 0.2.0 did not.
  `max-halstead-volume` currently reads ~1498 as a first measurement
  against a null baseline (informational, not gated). Whether to gate it
  is left to a separate decision — it is out of scope for this ADR.
- Consumers scaffolding from this template inherit the corrected metric
  and the Rust-inclusive scope.
