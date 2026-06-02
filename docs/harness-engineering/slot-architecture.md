# Slot Architecture

The `harness-app-template` is built on a **plug-and-play slot architecture**. Rather than hardcoding the toolchain, the template defines **slots**—clear, named contracts with documented interfaces. This dependency injection model ensures that the template's governance, linting, observability, and deployment pipelines remain flexible and evolvable over time.

## The Slot Model

Think of a slot as a "socket" in the template's motherboard. Each socket accepts a specific type of "plugin."

1. **Contract**: The logical purpose of the slot (e.g., `stack-manager`, `sensors`, `secret-scanner`).
2. **Interface**: The mechanism by which the template communicates with the plugin. Interfaces can be:
   - **CLI**: Executed via standard commands (e.g., `check`, `report`).
   - **External**: Shell commands executed directly (e.g., `just`, `gitleaks protect`).
   - **Compose / Library**: Structural conventions or environment variables.
3. **Plugin**: The actual tool or library implementing the contract (e.g., `playwright-node` for the `inspector` slot, `harness-sensors` for the `sensors` slot).

All slots are defined in the central `harness.manifest.json`.

## How to Swap a Plugin in a Slot

Because plugins are genuinely "rip-out-able," swapping one is straightforward. For example, if you want to replace the `harness-sensors` plugin with a custom `my-custom-sensors` implementation:

1. **Implement the Contract Interface**
   Ensure your custom plugin honors the CLI or library interface expected by the slot. If the slot expects `bin/sensors report` and `bin/sensors gate`, your plugin must provide those entrypoints.

2. **Update the Workspace**
   Remove the old plugin directory or dependency, and install or place your new plugin in the corresponding location (e.g., `harness/sensors/`).

3. **Update the Manifest**
   Modify `harness.manifest.json` to declare the new plugin, ensuring the harness orchestrator knows what is currently active:

   ```json
   "sensors": {
     "contract": "sensors",
     "plugin": "my-custom-sensors",
     "version": "1.0.0",
     "required": false,
     "swappable": true,
     "interface": {
       "type": "cli",
       "entrypoint": "harness/sensors/bin/sensors",
       "commands": ["report", "gate"]
     },
     "decisionAt": "docs/adrs/ADR-0006-sensors.md"
   }
   ```

4. **Update the ADR (Architecture Decision Record)**
   Record the reason for the swap in the corresponding `docs/adrs/` file (e.g., updating `ADR-0006-sensors.md` to reflect the move to `my-custom-sensors`).

By maintaining this separation of contract and plugin, you can upgrade or replace the underlying engine of any harness capability without breaking the repository's fundamental workflow.