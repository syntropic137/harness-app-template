# harness/sensors

Workspace architecture-quality sensors and the APSS fitness gate.

The slot currently runs:

- `dependency-cruiser`: afferent coupling `Ca`, efferent coupling `Ce`, instability `I`.
- `ts-morph` abstractness: abstractness `A` and Martin distance `D`.
- `ts-morph` complexity: cyclomatic and cognitive complexity.
- `apss_topology.mjs`: APSS topology artifacts from `.topology/metrics/`.

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
```

Requires Node 20 or newer and `npx` on `PATH`. The cruiser version is pinned at
`17.4.0` inside `bin/sensors`.

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
- `gate.mjs`: baseline and APSS fitness gate.
- `baseline.json`: committed regression floor.
