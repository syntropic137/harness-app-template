# Slot Contracts

`harness.manifest.json` is the slot composition record for this template. A slot is a fixed named contract. A plugin is the current implementation bound to that contract. Swapping a plugin must not rename the slot or change downstream recipes.

Each manifest slot entry carries the contract fields that a reader and wrapper can rely on:

| Field | Meaning |
|---|---|
| `contract` | Stable slot id. Must match the key under `slots`. |
| `plugin` | Active plugin id. Optional slots may use `none`. |
| `version` | Plugin version or local implementation version. |
| `required` | Whether the template is invalid when the slot is disabled. |
| `swappable` | Whether consumers are expected to replace the plugin. |
| `interface.type` | Shape of the seam: `cli`, `config`, `compose`, `library`, `directory`, or `external`. |
| `interface.entrypoint` | The injected command, file, directory, or import surface. |
| `interface.commands` | Supported commands for CLI-shaped and external slots. |
| `interface.config` | Config keys or files that complete the plugin contract. |
| `decisionAt` | ADR that records the current plugin decision. |

The JSON shape is checked by [`../harness.schema.json`](../harness.schema.json). Runtime wrappers should resolve plugin entrypoints from `harness.manifest.json` instead of embedding implementation paths.

## Current Slots

| Slot | Current plugin | Required | Interface | Contract summary |
|---|---|---:|---|---|
| `stack-manager` | `harness-stack-node` | Yes | CLI at `harness/stack/bin/stack` | Allocates ports and manages stack lifecycle with `boot`, `stop`, `destroy`, `inspect`, `ports`, and `doctor`. |
| `inspector` | `playwright-node` | No | CLI at `harness/inspector/bin/inspector` | Captures screenshots, recordings, and keyframe evidence. |
| `hooks` | `lefthook` | Yes | Config at `lefthook.yml` | Runs pre-commit and pre-push guardrails. |
| `telemetry-sdk` | `opentelemetry-multi` | Yes | Library import surface | Initializes per-language OTEL providers with shared `OTEL_*` configuration. |
| `observability-stack` | `otel-victoria` | Yes | Compose file at `harness/observability/compose.harness.yml` | Receives and stores logs, metrics, and traces. |
| `sensors` | `harness-sensors` | No | CLI at `harness/sensors/bin/sensors` | Computes architecture readings and optional fitness gates. |
| `agent-plugins` | `claude-canonical` | No | Directory at `.claude` | Bundles agent-facing skills, commands, agents, hooks, and memory conventions. |
| `task-runner` | `just` | Yes | External runner from `justfile` | Provides the single discoverable task entrypoint. |
| `secret-scanner` | `gitleaks` | Yes | External binary `gitleaks` | Detects credentials before commit or push. |
| `doc-validator` | `harness-doc-validator` | Yes | CLI at `harness/doc-validator/bin/doc-validator` | Checks internal markdown cross-references. |
| `versioning` | `harness-versioning+cocogitto` | Yes | CLI at `harness/versioning/bin/versioning` | Checks whole-repo and per-package versioning policy. |

## Runtime Swap Rule

For CLI-shaped harness wrappers, the wrapper asks the manifest for `interface.entrypoint`, then invokes that command with the user arguments. The wrapper does not need to know which plugin implementation owns the slot.

If `plugin` is `none`:

- Required slots fail.
- Optional slots skip cleanly, print a short message, and exit zero.

This is the minimum rip-out-able behavior. More complex plugins can add their own adapters later, but they must preserve the slot id and declared interface.

## Worked Swap: Sensors

The `sensors` slot is optional, so it is the first worked example of a plugin swap.

Default binding:

```json
"sensors": {
  "contract": "sensors",
  "plugin": "harness-sensors",
  "interface": {
    "type": "cli",
    "entrypoint": "harness/sensors/bin/sensors"
  }
}
```

Swap binding:

```json
"sensors": {
  "contract": "sensors",
  "plugin": "none",
  "required": false,
  "interface": {
    "type": "cli",
    "entrypoint": "harness/sensors/bin/sensors"
  }
}
```

When `just sensors --help` runs, `scripts/sensors.ts` resolves the `sensors` slot from the manifest. With the default binding it invokes `harness/sensors/bin/sensors --help`. With `plugin: "none"` it prints:

```text
Slot sensors skipped because harness.manifest.json sets plugin to none.
```

The task runner recipe and slot id stay unchanged. Only the plugin binding changes.
