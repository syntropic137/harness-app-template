# harness/sensors

Workspace architecture-quality sensors and the APSS fitness gate.

The slot currently runs:

- `dependency-cruiser`: afferent coupling `Ca`, efferent coupling `Ce`, instability `I`.
- `ts-morph` abstractness: abstractness `A` and Martin distance `D`.
- `ts-morph` complexity: cyclomatic and cognitive complexity.
- `apss_topology.mjs`: APSS topology artifacts from `.topology/metrics/`.
- `sentrux_scan.mjs`: sentrux 52-language tree-sitter overlay
  (`ADR-0017-sensors-v03-apss-canonical.md`). Activated as the SECOND
  architectural lens reconciled into the same upward ratchet — feeds
  `quality_signal`, `coupling_score`, `cycle_count`, `god_file_count`,
  `hotspot_count`, `complex_fn_count`, and `max_depth` into MT01 /
  MD01 / ST01. Soft-skips when the `sentrux` binary is absent.

The gate keeps the legacy folder `I` and `D` regression check and adds an APSS
baseline layer for all eight APS-V1-0002 dimensions. It also loads the lab-style
governance policy at `harness/.harness/governance.toml` by default.

## Run

```sh
just sensors report --format md
just sensors report --format json
just sensors gate
just sensors gate --update-baseline
just sensors gate --format json
just sensors gate --readings-from /tmp/readings.json --policy /tmp/governance.toml
just sensors adapters --workspace-root .
just sensors report --workspace-root . --skip-tier dep-cruiser
```

Requires Node 20 or newer and `npx` on `PATH`. The cruiser version is pinned at
`17.4.0` inside `bin/sensors`.

### Optional: install sentrux (activates the 2nd architectural lens)

The sentrux adapter soft-skips when the binary is absent. To activate it,
download the released static binary into `~/.local/bin` (Linux x86_64;
parallel asset names exist for `linux-aarch64`, `darwin-arm64`, and
`windows-x86_64.exe`):

```sh
curl -fL --retry 3 -o ~/.local/bin/sentrux \
  https://github.com/sentrux/sentrux/releases/download/v0.5.7/sentrux-linux-x86_64
chmod +x ~/.local/bin/sentrux
sentrux --version   # 0.5.7 — first run pulls ~30 MB of tree-sitter grammars
```

Verified SHA-256 (`sentrux-linux-x86_64@v0.5.7`):
`3237f80fe20d54aad4deefa8a143f0d60543bb5d2d6ad891eb42432f155725a6`.

After installation, `just sensors gate` adds 7 sentrux metrics to the
ratchet (~3.6 s extra wall-clock for a ~380-file workspace on the bare
scaffold). Telemetry is force-disabled per-invocation by the adapter via
`SENTRUX_ANALYTICS=off`.

## APSS Fitness Model

The committed `baseline.json` includes:

- `MT01` Maintainability, active and enforced.
- `MD01` Modularity and Coupling, active and enforced.
- `ST01`, `SC01`, `LG01`, `AC01`, `PF01`, `AV01`, incubating and advisory.

Each dimension records objective metric metadata, a baseline value, and whether
the metric fails on regression. Enforced regressions exit non-zero. Incubating
dimensions stay visible in the report but do not fail the gate.

## Governance Policy

`gate` evaluates two contracts in one run:

- `harness/sensors/baseline.json`: the committed APSS and Martin-metric
  regression floor.
- `harness/.harness/governance.toml`: declarative constraints, `[[per_sensor]]`
  rules, `[[ignore]]` rule exemptions, and `[exclude].paths` reading suppression.

Error-severity governance violations set the combined gate exit code to 1.
Warn-severity violations are reported but do not fail the gate.

Replay mode accepts either a lab-style `Reading[]` JSON file, a previous
`--format json` envelope with a `readings` array, or an aggregate report object:

```sh
just sensors gate --readings-from /tmp/readings.json --policy harness/.harness/governance.toml
just sensors gate --readings-from /tmp/readings.json --format json
```

The JSON envelope includes `readings`, `violations`, and `exit_code` for CI and
agent consumers.

## Adapter Seam

The adapter seam lives in `adapters.mjs` and is documented in
`plugin-protocol.md`. It provides:

- Built-in adapter identity records for dep-cruiser, ts-morph abstractness,
  ts-morph complexity, APSS topology, sentrux, and grimp-instability.
- Applicability prechecks: `applicable`, `not_applicable`, `missing_dep`, and
  `skipped`.
- Workspace package detection and package fanout for `ws_apps`, `ws_packages`,
  `apps`, `packages`, `libs`, and `services`.
- `--workspace-root` and `--skip-tier` controls on `report` and `gate`.
- Optional sentrux and grimp entrypoints that soft-skip when their dependencies
  are absent.

APSS topology remains the canonical default. Optional adapters can be ported or
installed behind the documented names without changing the baseline model.

## APSS Topology Inputs

The APSS adapter reads these files when present:

- `.topology/metrics/modules.json`
- `.topology/metrics/functions.json`
- `.topology/metrics/coupling.json`

All APSS values are merged under each module's `.apss` object so the existing
Node sensors remain available as fallback signals.

## Layout

- `bin/sensors`: bash dispatcher for `report` and `gate`.
- `aggregate.mjs`: merges dependency, abstractness, complexity, and APSS readings.
- `abstractness.mjs`: ts-morph abstractness adapter.
- `complexity.mjs`: ts-morph complexity adapter.
- `apss_topology.mjs`: APSS topology adapter.
- `sentrux_scan.mjs`: sentrux adapter — runs the binary, parses
  `.sentrux/baseline.json`, emits an envelope `gate.mjs` reads via
  `--sentrux=<path>`. Activated as the 2nd architectural lens per
  ADR-0017.
- `adapters.mjs`: adapter seam, precheck, skip-tier, and fanout utilities.
- `gate.mjs`: baseline and APSS fitness gate.
- `baseline.json`: committed regression floor.
- `plugin-protocol.md`: adapter contract and lab lineage.
