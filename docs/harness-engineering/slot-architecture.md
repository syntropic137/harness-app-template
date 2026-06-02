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

## Worked Swap: Sensors

The `sensors` slot is an excellent example of how to swap a plugin. In this worked example, we'll swap the default `harness-sensors` for a custom implementation called `my-custom-sensors` and show how the resolver automatically picks it up.

### 1. The Custom Plugin
First, we create our custom plugin. For demonstration, this is a simple executable bash script placed at `harness/my-custom-sensors/bin/sensors`:

```bash
#!/bin/bash
echo "My custom sensors plugin is running! Args: $@"
exit 0
```
*(Ensure this file is executable with `chmod +x harness/my-custom-sensors/bin/sensors`)*

### 2. The Original Manifest
The original entry in `harness.manifest.json` looked like this:

```json
"sensors": {
  "contract": "sensors",
  "plugin": "harness-sensors",
  "interface": {
    "type": "cli",
    "entrypoint": "harness/sensors/bin/sensors",
    "commands": ["report", "gate"]
  }
}
```

### 3. The Swapped Manifest
We swap it to point to our new plugin by editing `harness.manifest.json`:

```json
"sensors": {
  "contract": "sensors",
  "plugin": "my-custom-sensors",
  "version": "1.0.0",
  "required": false,
  "swappable": true,
  "interface": {
    "type": "cli",
    "entrypoint": "harness/my-custom-sensors/bin/sensors",
    "commands": ["report", "gate"]
  },
  "implementation": "A custom runnable plugin example demonstrating the slot architecture swap.",
  "decisionAt": "docs/adrs/ADR-0006-sensors.md"
}
```

### 4. Resolving the Swap
The `scripts/lib/slots.ts` resolver is responsible for finding the correct entrypoint based on the active manifest. We can run the command normally without knowing which plugin is active under the hood.

When we run the task (e.g., via `bun run scripts/sensors.ts report` or `just sensors report`), the resolver reads the manifest, sees the newly defined `my-custom-sensors` entrypoint, and executes it:

```bash
$ bun run scripts/sensors.ts report
My custom sensors plugin is running! Args: report
```

### 5. Automated Check
We can verify the resolver's correctness programmatically with a test. Here's how a test in `scripts/tests/slots.test.ts` validates that the new entrypoint is successfully resolved:

```typescript
test('resolves the swapped my-custom-sensors plugin entrypoint', () => {
  const customSensorsSlot = {
    contract: 'sensors',
    plugin: 'my-custom-sensors',
    interface: {
      type: 'cli',
      entrypoint: 'harness/my-custom-sensors/bin/sensors'
    }
  };
  
  const invocation = resolveSlotInvocation('sensors', ['report'], {
    cwd: '/repo',
    readText: () => JSON.stringify({ slots: { sensors: customSensorsSlot } }),
  });

  expect(invocation).toMatchObject({
    disabled: false,
    command: 'harness/my-custom-sensors/bin/sensors',
    args: ['report'],
  });
});
```

By maintaining this separation of contract and plugin, you can upgrade or replace the underlying engine of any harness capability without breaking the repository's fundamental workflow.