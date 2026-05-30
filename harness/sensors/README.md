# harness/sensors

Workspace architecture-quality metrics. Ships **two adapters** today:

- `dependency-cruiser` → afferent coupling **Ca**, efferent coupling **Ce**, instability **I**.
- `ts-morph` → abstractness **A** (`abstract class` + `interface` declarations vs concrete classes).

The aggregator merges both and computes Robert C. Martin's distance from the main sequence, **D = |A + I − 1|**, per module and per folder.

Report-only. The policy gate is **intentionally deferred** until at least one consumer fork has ≥ 50 workspace modules — see `experiments/2026-05-30--depcruiser-arch-quality/README.md` for the rationale.

## Run it

```sh
just sensors report --format md     # human-readable Markdown
just sensors report --format json   # machine-readable JSON
just sensors --help                 # subcommand list
```

Requires `npx` on `$PATH` (Node ≥ 18). The cruiser version is pinned at `17.4.0` inside `bin/sensors`.

## What this fixes vs. raw `npx dependency-cruiser --metrics`

1. **Scope.** Without `.dependency-cruiser.cjs` (at the repo root) cruiser follows vitest's imports into `node_modules` and the metric set becomes 90%+ vendor noise. The config pins `includeOnly: ^(ws_apps|ws_packages)/` and `exclude.path: node_modules`.
2. **De-dup.** Cruiser sometimes emits the same `modules[].source` twice with different graph views; the aggregator merges dependents/dependencies into sets and recomputes I from the merged view.
3. **Distribution.** Workspace-scoped min/median/max I plus stable/unstable counts, so the report tells you something even when each individual reading is unsurprising.

## What this does **not** ship yet

- A pass/fail policy gate. Even with A and D in hand, the scaffold still has too few workspace modules for a threshold to be anything but noise.
- Adapters for Python (`grimp`), Rust (`cargo-modules`), Go (`go-arch-lint`), or the `sentrux` overlay. Each is a separate increment per `docs/adrs/ADR-0006-sensors.md`.

When those land, this directory grows; the `just sensors` recipe stays the same.

## Reading the output

`A` and `D` only appear in the report when ts-morph successfully classified at least one source. Modules with no class/interface declarations get `A = null` (and therefore `D = null`); the aggregator never invents a value.

Folder-level `A` is the simple mean of defined per-module A values inside that folder. Folder-level `D = |A + I − 1|` using that folder mean and the cruiser-supplied folder `I`.

## Layout

- `bin/sensors` — bash dispatcher (`report`, `--help`)
- `aggregate.mjs` — pure Node ESM aggregator; tested by `scripts/tests/sensors-aggregate.test.ts`
- `abstractness.mjs` — ts-morph adapter; tested by `scripts/tests/sensors-abstractness.test.ts`
- `package.json` — minimal package metadata so `pnpm` / `turbo` see the slot
- `node_modules/ts-morph` — pinned per the slot's `dependencies`; also hoisted to the root so vitest can resolve it from test files

If you want the slot disabled, set `harness.manifest.json#slots.sensors.plugin` to `none` (or just don't call `just sensors`).
