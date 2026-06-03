# harness-sensors Adapter Protocol

Status: template v1 internal seam.

The sensors slot keeps APSS topology and the existing Node adapters as the
default gate. Optional adapters can be added without editing the policy engine
when they follow this seam.

## Reading Shape

Adapters emit readings with this JSON shape:

```json
{
  "sensor": "dep-cruiser@17.4.0",
  "metric": "instability",
  "scope": { "kind": "module", "path": "ws_apps/example/src/main.ts" },
  "value": 1,
  "unit": "ratio"
}
```

`scope.kind` is one of `project`, `module`, `file`, or `function`. Module and
file scopes use `path`; function scopes use `file` and `name`.

## Adapter Contract

The internal adapter record is:

```json
{
  "name": "grimp-instability",
  "sensor": "grimp-instability@optional",
  "tier": "optional",
  "command": "python3",
  "fanout": true,
  "shape": "python",
  "optional": true
}
```

The dispatcher prechecks each adapter before it runs. Applicability values are:

| Value | Meaning |
| --- | --- |
| `applicable` | The adapter can run for the workspace or detected packages. |
| `not_applicable` | The workspace does not match the adapter shape. |
| `missing_dep` | A required command or tool is absent. The adapter soft-skips. |
| `skipped` | The user disabled the adapter with `--skip-tier`. |

## Fanout

`adapters.mjs` detects packages below these common roots:

- `ws_apps`
- `ws_packages`
- `apps`
- `packages`
- `libs`
- `services`

A fanout adapter receives package roots matching its shape. Package-relative
scope paths are qualified back to workspace-relative paths before consumers
see the readings.

## CLI Controls

```sh
harness/sensors/bin/sensors adapters --workspace-root .
harness/sensors/bin/sensors report --workspace-root . --skip-tier sentrux,grimp-instability
harness/sensors/bin/sensors gate --workspace-root . --skip-tier dep-cruiser
harness/sensors/bin/sensors sentrux --workspace-root .
harness/sensors/bin/sensors grimp --workspace-root .
```

`--skip-tier` uses prefix semantics. `sentrux` skips `sentrux@optional`, and
`dep-cruiser` skips `dep-cruiser@17.4.0`.

## Optional Adapters

Sentrux and grimp remain available sensor plugins, but they are not default
requirements for a fresh fork.

- `sentrux` is optional because the lab implementation expects a patched
  sentrux binary that can emit quality, cycle, depth, and score readings.
- `grimp-instability` is optional because it needs a Python project plus the
  grimp import graph tool.

The template entrypoints emit a soft-skip JSON envelope when the dependency is
missing. A fork can port the lab implementations behind the same names without
changing `gate.mjs`, `governance.toml`, or the APSS baseline model.

## Lab Lineage

This seam is based on the lab `Sensor` trait, `Applicability` precheck,
workspace fanout, sentrux adapter, grimp adapter, and draft plugin protocol in:

- `/data/projects/NeuralEmpowerment--agentic-harness-lab/harness/sensors/src/sensor.rs`
- `/data/projects/NeuralEmpowerment--agentic-harness-lab/harness/sensors/src/cli.rs`
- `/data/projects/NeuralEmpowerment--agentic-harness-lab/harness/sensors/src/workspaces.rs`
- `/data/projects/NeuralEmpowerment--agentic-harness-lab/harness/sensors/src/adapters/sentrux.rs`
- `/data/projects/NeuralEmpowerment--agentic-harness-lab/harness/sensors/src/adapters/grimp_instability.rs`
- `/data/projects/NeuralEmpowerment--agentic-harness-lab/harness/sensors/docs/plugin-protocol.md`
