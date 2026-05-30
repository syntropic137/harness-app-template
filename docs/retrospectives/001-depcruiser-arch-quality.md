---
name: "001-depcruiser-arch-quality"
description: "Distilled retrospective for the depcruiser-arch-quality probe — verdict GO, sensors slot populated as a result"
status: accepted
---

# 001 — `depcruiser-arch-quality`

**Date:** 2026-05-30 (probe ran 2026-05-30; retro distilled 2026-05-30 same day under bead `create-harness-app-n48.16`).
**Experiment dir:** [`../../experiments/2026-05-30--depcruiser-arch-quality/`](../../experiments/2026-05-30--depcruiser-arch-quality/).
**Verdict:** **GO** — adopt dep-cruiser as the TypeScript Ca/Ce/I adapter for the sensors slot.
**Distilled, not full.** This template ships the slim retro shape per the operator's scope cut at gap-report G12. The full retro pattern lives at [`agentic-harness-lab/docs/retrospectives/`](https://github.com/NeuralEmpowerment/agentic-harness-lab/tree/main/docs/retrospectives) (24 entries).

## What we ran

`npx dependency-cruiser@17.4.0 --metrics --output-type json --ts-pre-compilation-deps` against `ws_apps/example-typescript/{src,tests}`, then parsed the result for per-folder + per-module Martin metrics.

## Hypothesis

> dependency-cruiser v0.17.4 can produce per-folder and per-module Martin metrics (Ca, Ce, I) on the harness-app-template's `ws_apps` TypeScript workspace with no extra config, and the numbers it returns are meaningful enough to justify populating the sensors slot with the Rust aggregator described in `docs/adrs/ADR-0006-sensors.md`.

## What we found

- **6 modules / 8 folder readings** after de-dup and node-modules filtering. Sample: `ws_apps/example-typescript/src` Ca=3, Ce=3, I=0.500 — a sane "balanced library" baseline. `tests/` and `tests/integration/` correctly read as I=1.0 (pure consumers).
- **De-dup anomaly real and shippable.** Dep-cruiser emits the same `modules[].source` twice for some sources (the `telemetry.ts` quirk), which would double-count without an aggregator-side de-dup step.
- **Scope discipline matters.** Without `.dependency-cruiser.cjs`'s `includeOnly` + `excludePattern`, the cruiser walked into vitest's node_modules and 90%+ of the readings were vendor noise.
- **JSON shape is stable** and parseable from a small Python script — no surprises that would have blocked porting the adapter.

## What we changed because of it

1. **`.dependency-cruiser.cjs` at the repo root** — pins `includeOnly: ^(ws_apps|ws_packages)/` + `exclude.path: node_modules|dist|build|out|.next|coverage` so subsequent runs are workspace-scoped by default.
2. **`harness/sensors/aggregate.mjs`** — Node ESM aggregator that de-dups duplicate `modules[].source` entries and computes per-folder/per-module Ca/Ce/I.
3. **Sensors slot wired** — `just sensors report` runs the cruiser → aggregate pipeline; `just sensors gate` (bead `n48.4`) enforces a baseline-snapshot floor on every pre-push.
4. **Three downstream beads** filed on the back of the GO verdict: `n48.4` (gate baseline mode), `n48.5` (cognitive-complexity adapter), `n48.3` (APSS topology adapter). All landed.

## What's still open

- **Polyglot adapters.** The probe was TypeScript-only. Python `grimp`, Rust `cargo-modules`, Go `go-arch-lint` are catalogued in ADR-0006 but not yet exercised against this fork's scaffold (the Python/Rust example apps under `ws_apps/` are minimal). Re-probe when a real consumer fork has substantial code in another language.
- **Cognitive-complexity dimension.** Not in dep-cruiser's output. Closed by the follow-up retro [`002-ts-morph-adapter-chain`](./002-ts-morph-adapter-chain.md) (n48.5).

## References

- [`experiments/2026-05-30--depcruiser-arch-quality/README.md`](../../experiments/2026-05-30--depcruiser-arch-quality/README.md) — full probe writeup.
- [`docs/adrs/ADR-0006-sensors.md`](../adrs/ADR-0006-sensors.md) — slot pick the probe justified.
- [`docs/executive-summary.md`](../executive-summary.md) — the rollup that names this verdict.
