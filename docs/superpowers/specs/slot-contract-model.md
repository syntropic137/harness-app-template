# Slot Contract Model

**Status:** experiment design note for bead `create-harness-app-p6h`

## Goal

Make the harness plug-and-play model concrete enough that a reader can tell the difference between a slot, a plugin, and a template, and that code can route through the declared seam.

## Model

A slot is a stable named contract. The slot id does not change when an implementation changes. Examples: `stack-manager`, `sensors`, `doc-validator`.

A plugin is the implementation that fills a slot. It can be local code, an external binary, a config file consumed by a third-party tool, or a language SDK binding. A plugin is valid only when it satisfies the slot contract.

A template is one composition of plugin choices. In this repo, `harness.manifest.json` is the composition record.

## Manifest Contract

Each `harness.manifest.json#slots.<slot>` entry should state:

- `contract`: the fixed slot id.
- `plugin`: the active plugin id, or `none` for an optional disabled slot.
- `version`: the plugin version or local implementation version.
- `required`: whether the template is invalid without this slot.
- `swappable`: whether consumers are expected to replace the plugin.
- `interface`: the callable or importable surface the plugin promises.
- `decisionAt`: the ADR that explains why this plugin is the current pick.

For CLI-shaped slots, `interface.entrypoint` is the injection seam. A wrapper should call the manifest-declared entrypoint, not a hard-coded implementation path. For non-CLI slots, `interface.type` records the shape: `config`, `compose`, `library`, `directory`, or `external`.

## Runtime Rule

Harness-owned wrappers resolve the slot from `harness.manifest.json` before invoking a plugin.

If `plugin` is `none` and the slot is optional, the wrapper exits zero with a clear skip message. If `plugin` is `none` and the slot is required, the wrapper fails.

This gives consumers a reversible edit:

```json
"sensors": {
  "contract": "sensors",
  "plugin": "none",
  "required": false
}
```

The rest of the harness must still run.

## Worked Swap

Use `sensors` as the first proof seam because it is optional and already documented as rip-out-able.

1. Default state: `slots.sensors.plugin = "harness-sensors"` and `interface.entrypoint = "harness/sensors/bin/sensors"`.
2. Swap state: set `slots.sensors.plugin = "none"`.
3. Proof: `just sensors --help` routes through the same wrapper, sees the disabled optional slot, prints a skip message, and exits zero.
4. Restore: set `slots.sensors.plugin` back to `harness-sensors`.

The slot id, ADR link, and task-runner recipe do not change. Only the plugin binding changes.
