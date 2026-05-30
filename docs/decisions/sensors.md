# Decision: sensors — Rust aggregator + adapter set

**Status:** active (current-state summary; opt-in slot) · **Date:** 2026-05-14 · **Next review:** 2026-11-14

> **Consumer summary (hybrid).** This file ships only the current state. The full v0.3 evolution — including the APSS-canonical dispatcher / policy / exclude design and the rationale for retiring per-language adapters from the v0.3 agent image — was authored in the upstream R&D lab and is preserved there: [`agentic-harness-lab/docs/standard/decisions/sensors.md`](https://github.com/NeuralEmpowerment/agentic-harness-lab/blob/main/docs/standard/decisions/sensors.md) and [`sensors-v0.3-apss-canonical.md`](https://github.com/NeuralEmpowerment/agentic-harness-lab/blob/main/docs/standard/decisions/sensors-v0.3-apss-canonical.md). The current state below is the part you act on in a consumer fork.

## Current pick

The `sensors` slot is **opt-in** at v0.4.0 — it's wired but not enforced unless your fork's policy turns it on.

- **Aggregator:** Rust crate at `harness/sensors/` (language-agnostic). Synthesizes Martin's `D = |A + I − 1|` from per-adapter `A` (abstractness) and `I` (instability) values, plus the architectural-fitness signal from the `APSS` (Architecture Policy Score Sheet) dispatcher.
- **Adapters (per-language, opt-in):**
  - **TS/JS** — `dep-cruiser` (afferent/efferent coupling → `I`) + `ts-morph` (abstractness `A`).
  - **Python** — `grimp` (ImportGraph for Ca/Ce → `I`).
  - **Rust** — `cargo-modules` (module graph → Ca/Ce; cycle detection).
  - **Go** — `go-arch-lint` (YAML-declared layer rules).
  - **AI-governance overlay** — `sentrux` (modularity, acyclicity, depth across 52 languages via tree-sitter).

## What this means for your fork

If you want architectural fitness as a CI gate:

```sh
# verify the gate runs against your repo's source
harness-sensors gate <path> --format json

# typical CI step:
- run: harness-sensors gate . --format json --policy .harness/governance.toml
```

The `--policy` file declares thresholds per metric. The harness's own policy (`harness/.harness/governance.toml`) is the reference. Without a policy file the gate prints metrics but doesn't fail.

If you don't want sensors:

```sh
just sensors disable
```

This rewrites `harness.manifest.json#slots.sensors.plugin` to `none` so subsequent harness invocations skip the slot. Sensors stay rip-out-able — that's the plug-and-play principle.

## Why this combination

- Martin's `A`/`I`/`D` metrics are the canonical package-design signal, but no single tool computes them cross-language. Hence: thin Rust aggregator + per-language adapters that each expose only what they natively see.
- Adapters are independently maintained and swappable — the polyglot-first rule applies at the adapter layer.
- `sentrux` is a 2026 entrant in AI-coding governance; we treat it as an overlay (one input among many), not the canonical signal.

## Maintenance signal (per-adapter)

- `dep-cruiser` — active, monthly releases.
- `ts-morph` — active, 3.9k dependents on npm.
- `grimp` — active, used by `import-linter` as a dependency.
- `cargo-modules` — active on crates.io.
- `go-arch-lint` — active with a v2 SDK split.
- `sentrux` — emerging; pinned to a vendored submodule version (`lib/sentrux/`) per the upstream lab's audit cadence.

## License

All adapters: OSI-approved permissive (MIT, BSD-2, MPL-2.0). Compatible with shipping in a permissive harness.

## When to re-evaluate

Open the lab's [sensors.md](https://github.com/NeuralEmpowerment/agentic-harness-lab/blob/main/docs/standard/decisions/sensors.md) and the [APSS-canonical superseding doc](https://github.com/NeuralEmpowerment/agentic-harness-lab/blob/main/docs/standard/decisions/sensors-v0.3-apss-canonical.md) if any of these trip:

- A per-language adapter goes inactive (>6 months no release).
- A unified cross-language A/I/D tool ships and consolidates the field.
- Your fork's CI cost from the gate becomes a problem; the lab's APSS policy doc lays out the per-policy cost trade-offs.
