---
date: 2026-05-30
slug: depcruiser-arch-quality
bead: create-harness-app-9lh
hypothesis: >
  dependency-cruiser v17.4.0 can produce per-folder and per-module Martin
  metrics (Ca, Ce, I) on the harness-app-template's ws_apps TypeScript
  workspace with no extra config, and the numbers it returns are
  meaningful enough to justify populating the sensors slot with the
  Rust aggregator described in docs/adr/ADR-0006-sensors.md.
---

# Architecture-quality probe — dependency-cruiser on `ws_apps`

## Method

```sh
npx dependency-cruiser@17.4.0 \
  --no-config --metrics --output-type json --ts-pre-compilation-deps \
  ws_apps/example-typescript/src/main.ts \
  ws_apps/example-typescript/src/telemetry.ts \
  ws_apps/example-typescript/tests/main.test.ts \
  ws_apps/example-typescript/tests/integration/cli.integration.test.ts \
  > depcruise.json
```

Two notes on the invocation:

- `--no-config` was required — the template ships no `.dependency-cruiser.cjs`, so the CLI errors out without it.
- Globs like `ws_apps/example-typescript/(src|tests)` and bare directory args produced `totalCruised: 0` (the resolver did not expand them under `--no-config`). Passing explicit file paths picked up all four entry points.

The cruise produced **67 modules / 122 dependencies** (workspace + reachable `node_modules`). Filtered to workspace files: **4 folder readings, 5 module readings** (see `metrics-table.txt`). Lab reference experiment `2026-05-14 depcruiser-ts-martin-adapter` reported 366 readings on `apps/api` — our scaffold is far smaller (one app, two source files, two test files), so the volume gap is expected.

## Results — per-folder

| folder | mods | Ca | Ce | I |
|---|---:|---:|---:|---:|
| `ws_apps/example-typescript`               | 5 | 0 | 8 | **1.000** |
| `ws_apps/example-typescript/src`           | 3 | 3 | 3 | **0.500** |
| `ws_apps/example-typescript/tests`         | 2 | 0 | 7 | **1.000** |
| `ws_apps/example-typescript/tests/integration` | 1 | 0 | 4 | **1.000** |

## Results — per-module

| module | Ca | Ce | I |
|---|---:|---:|---:|
| `src/main.ts`                                  | 1 | 2 | 0.667 |
| `src/telemetry.ts` (canonical)                 | 2 | 2 | 0.500 |
| `src/telemetry.ts` (also reported, deps=0)     | 2 | 0 | 0.000 |
| `tests/main.test.ts`                           | 0 | 3 | 1.000 |
| `tests/integration/cli.integration.test.ts`    | 0 | 4 | 1.000 |

Distribution (workspace only):

- modules: min/median/max I = **0.000 / 0.667 / 1.000**, stable (I≤0.2) = **1**, unstable (I≥0.8) = **2**.
- folders: min/median/max I = **0.500 / 1.000 / 1.000**.

## Reading the signal

- `src/` sits at I=0.5 with balanced Ca/Ce — exactly where the Martin rule of thumb would put a small library boundary, and a sane baseline for any later policy gate.
- `telemetry.ts` is the most depended-on workspace module (Ca=2 from `main.ts` + `main.test.ts`) and itself depends only on the two OTel packages → on the stable end (I=0.0–0.5). Consistent with its role as the SDK seam.
- Tests and the app-root folder land at I=1.0 (pure consumers). That's correct, not a finding — it's the expected shape of `tests/` and a workspace root that re-exports nothing.
- **Abstractness (A)** is not in the cruiser output by design — Martin's `D = |A + I − 1|` needs an `A` source. `docs/adr/ADR-0006-sensors.md` already assigns that to **ts-morph**; the cruiser output alone can't compute `D`.

## Anomalies worth noting

1. `src/telemetry.ts` appears **twice** in `modules[]` — once with the OTel dependencies attached (I=0.5) and once with `dependencies: []` (I=0.0). Same `source` string, different graph view. Likely the `--no-config` resolver visits the file once as an entry and once as a follow-target. An aggregator must de-duplicate or it will double-count `Ca` and bias the distribution.
2. The cruiser walks into `node_modules` once it hits a test's `vitest` import. **62 of the 67 cruised modules are vendor code.** Without an `excludePattern: "node_modules"` policy the metric report is dominated by vitest internals (e.g. `node_modules/vitest/dist` shows I=0.929, irrelevant to architectural fitness of `ws_apps`).
3. `instability` is `null` on bare-package references (`@opentelemetry/api`, etc.) — the aggregator needs a defined behaviour for those (drop vs. treat-as-stable).

## Recommendation on the sensors slot

**Populate the Rust aggregator** described in `docs/adr/ADR-0006-sensors.md` and ship it default-off (the slot is already opt-in at v0.4.0 — that doesn't need to change). Concretely:

1. **Do it.** The TS adapter half (`dep-cruiser → Ca/Ce/I`) is real and the JSON shape is exactly what an aggregator wants. The numbers above prove the pipeline works end-to-end on the scaffold with no config beyond `--no-config + --metrics`.
2. **The aggregator earns its keep on three jobs the raw cruiser output does not handle, all visible in this 5-module probe:**
   - **De-dup** repeated `modules[].source` entries before computing `Ca`.
   - **Scope filter** — strip `node_modules/**` from the metric set so the distribution reflects workspace code. (Cruiser has `excludePattern`, but that requires a config file the template doesn't ship; the aggregator can apply it uniformly across adapters.)
   - **Merge `A` from `ts-morph`** to produce Martin's `D = |A + I − 1|`. Neither tool computes `D` alone.
3. **Defer the gate.** With only 5 workspace modules, any threshold-based pass/fail is noise. Run the aggregator in *report-only* mode against this template until at least one consumer fork has ≥ 50 workspace modules and a real `governance.toml` (referenced but not present in the template today).
4. **Ship a config file alongside the aggregator.** The need for `--no-config` to make cruiser run is a paper-cut for anyone trying this manually. A minimal `.dependency-cruiser.cjs` (`includeOnly: '^(ws_apps|ws_packages)'`, `excludePattern: 'node_modules'`, `tsPreCompilationDeps: true`) makes `npx dependency-cruiser --metrics --output-type json` work on the scaffold and removes anomaly #2.
5. **Cost ceiling is fine.** Cruiser run was sub-second on cold `npx` (mostly download). With `dependency-cruiser` installed as a dev-dep it's negligible — no reason to delay on perf grounds.

In short: **green-light the aggregator**, but its first PR should land config + de-dup + scope-filter, not a threshold gate. The data here is too thin for a policy yet, but the pipeline is sound.

## Artifacts

- `depcruise.json` — raw cruiser output (117 KB)
- `parse-metrics.py` — workspace-scoped Martin-metrics parser
- `metrics-table.txt` — formatted report from the parser
