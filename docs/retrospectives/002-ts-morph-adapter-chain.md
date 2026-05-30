---
name: "002-ts-morph-adapter-chain"
description: "Distilled retrospective for the ts-morph abstractness + complexity adapter chain — verdict GO, sensors slot now reports Martin A and D end-to-end"
status: accepted
---

# 002 — `ts-morph-adapter-chain`

**Date:** 2026-05-30 (work landed across commits `a893b33` (abstractness) → `2fc719e`+`487a1f0` (complexity); retro distilled 2026-05-30 under bead `create-harness-app-n48.16`).
**Beads:** `create-harness-app-n48.5` (cognitive-complexity sensor — closed), the abstractness adapter shipped earlier under the `create-harness-app-tck` bead (closed).
**Verdict:** **GO** — ship both ts-morph adapters as part of the sensors pipeline; reuse the same `Project` install for both; merge into the existing aggregator without overwriting dep-cruiser values.
**Distilled, not full.**

## What we ran

Two adapters chained off the same workspace pass:

1. `harness/sensors/abstractness.mjs` — walks every `.ts`/`.tsx` source surfaced by dep-cruiser, counts `abstract class` + `interface` declarations as abstract and non-abstract `class` declarations as concrete. Emits per-source `{abstract, concrete, A}`. Feeds `mergeAbstractness()` in `aggregate.mjs`, which joins per-module A with per-module I from dep-cruiser to compute `D = |A + I − 1|`.

2. `harness/sensors/complexity.mjs` — ts-morph AST walker computing per-function cyclomatic + cognitive complexity. Rolls up per source to `{function_count, max_cyclomatic, median_cyclomatic, max_cognitive, median_cognitive}` plus the underlying per-function list. Feeds `mergeComplexity()` in `aggregate.mjs`.

## Hypothesis

> The ts-morph install already required by the abstractness adapter can host a second adapter (cognitive complexity) without a new dependency. A DIY AST walker is enough to produce a Sonar-shaped approximation good enough to feed a fitness gate; the aggregator can merge multiple ts-morph adapter outputs alongside dep-cruiser's metrics without overwriting any existing field.

## What we found

- **One ts-morph `Project` install hosts both adapters cleanly.** No new dependency required for the complexity adapter; it composes with the existing ts-morph install.
- **Abstractness numbers extrapolate.** On `ws_apps/example-typescript/src/main.ts`: 3 interfaces (HelloMessage, GetActiveTraceIdDeps, RunCliDeps), 0 concrete classes → A=1.0. Paired with dep-cruiser's I=0.667 → D=0.667. The full A/I/D triple is computable end-to-end through the aggregator output.
- **Complexity readings work end-to-end on the scaffold.** 73 functions scanned across 10 modules; max cyclomatic 6, max cognitive 8 (the highest reading is in `tests/main.test.ts`). Median 1 across both metrics — sane baseline floor.
- **Sonar-shaped cognitive approximation is monotonic with — and ≥ — the canonical Sonar value** for typical TS code. V1 simplifications (each `&&`/`||`/`??` counts +1; else-if gets nesting penalty; recursion not detected) are documented in the file header so a future swap to `eslint-plugin-sonarjs` is clean.
- **Aggregator merge is preservation-clean.** `mergeAbstractness` adds `A` + `D` per module; `mergeComplexity` adds `function_count`/`max_*`/`median_*`; neither overwrites the dep-cruiser Ca/Ce/I values. Per-folder rollups are non-mutating.

## What we changed because of it

1. **`harness/sensors/abstractness.mjs`** (commit `a893b33`) — ts-morph adapter; pairs with dep-cruiser to produce Martin A and D.
2. **`harness/sensors/complexity.mjs`** (commit `2fc719e`) — ts-morph adapter for per-function cyclomatic + cognitive.
3. **`harness/sensors/aggregate.mjs`** — gained `mergeAbstractness()`, `mergeComplexity()`, `distanceFromMainSequence()`, plus the `--abstractness=<path>` and `--complexity=<path>` flags on main().
4. **`harness/sensors/bin/sensors`** — invokes both adapters in pipeline position between dep-cruiser and the aggregator. Single end-to-end pass; tempfile-buffered to avoid EPIPE under load.
5. **Tests: 38 vitest cases** across `sensors-abstractness.test.ts` (19) and `sensors-complexity.test.ts` (19) — both exercise pure functions + the CLI main() with in-memory ts-morph projects (no disk).
6. **ADR-0017** records the both-vs-reduce decision: APSS is canonical for future gates, but the ts-morph adapters stay as available adapters in the slot's catalog rather than being silently retired.

## What's still open

- **Polyglot complexity adapters.** Python (`lizard`, `radon`), Rust (`cargo-complexity`, `tokei` for LOC), Go (`gocyclo`). Bead `n48.5` covered TS only; cross-language complexity is a follow-up arc.
- **Gate integration for complexity dims.** The sensors gate today checks per-folder I + D (n48.4 baseline-snapshot mode). Cognitive-complexity dims are reported in the merged output but not yet enforced. File a follow-up bead when the workspace has enough functions for a complexity baseline to mean something.
- **Sonar-canonical swap.** The Sonar-shaped approximation is intentionally conservative (overcounts). When a real complexity-driven decision comes up where the V1 approximation might mismatch the canonical value, swap to `eslint-plugin-sonarjs` or `cognitive-complexity-ts` under the same adapter shape.

## References

- [`docs/adrs/ADR-0006-sensors.md`](../adrs/ADR-0006-sensors.md) — slot pick for the adapter catalog.
- [`docs/adrs/ADR-0017-sensors-v03-apss-canonical.md`](../adrs/ADR-0017-sensors-v03-apss-canonical.md) — the both-vs-reduce recorded decision.
- [`docs/executive-summary.md`](../executive-summary.md) — the rollup that names this verdict.
- Sonar Cognitive Complexity paper (G. Ann Campbell, 2018) — the algorithm this adapter approximates.
- [`https://github.com/SonarSource/eslint-plugin-sonarjs/blob/master/src/rules/cognitive-complexity.ts`](https://github.com/SonarSource/eslint-plugin-sonarjs/blob/master/src/rules/cognitive-complexity.ts) — the canonical implementation reference.
- [`https://www.npmjs.com/package/cognitive-complexity-ts`](https://www.npmjs.com/package/cognitive-complexity-ts) — alternative canonical implementation.
