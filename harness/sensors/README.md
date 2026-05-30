# harness/sensors

Workspace architecture-quality metrics. Currently ships the **TypeScript adapter only** — `dependency-cruiser` wrapped by a small Node aggregator that de-dups duplicate `modules[]` entries and scope-filters everything outside `ws_apps/` and `ws_packages/`, then prints per-folder and per-module Robert C. Martin metrics (Ca, Ce, I).

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

- Abstractness (A) and Martin's distance (D = |A + I − 1|). Per `docs/decisions/sensors.md` these come from a ts-morph pass — a later increment.
- A pass/fail policy gate. With ~5 workspace modules in the scaffold, any threshold is noise.
- Adapters for Python (grimp), Rust (cargo-modules), Go (go-arch-lint), or the `sentrux` overlay. Each is a separate increment.

When those land, this directory grows; the `just sensors` recipe stays the same.

## Layout

- `bin/sensors` — bash dispatcher (`report`, `--help`)
- `aggregate.mjs` — pure Node ESM aggregator; tested by `scripts/tests/sensors-aggregate.test.ts`
- `package.json` — minimal package metadata so `pnpm` / `turbo` see the slot

If you want the slot disabled, set `harness.manifest.json#slots.sensors.plugin` to `none` (or just don't call `just sensors`).
