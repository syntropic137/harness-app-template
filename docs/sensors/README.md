---
name: "Sensors documentation"
description: "Index of sensors-slot documentation: the agent-facing fitness-dimensions reference, the closed-loop producer-consumer pipeline, the coverage and baseline-update policy, and the per-gate wall-clock budgets that drive placement at pre-commit / pre-push / CI."
---

# Sensors documentation

This directory documents the `sensors` slot: how the harness measures
architectural fitness, which dimensions are enforced, where each gate
fires in the pre-commit / pre-push / CI pipeline, and how a coding
agent consumes the verdict.

## Index

| Document | Description |
|----------|-------------|
| [Architectural-fitness closed loop](closed-loop.md) | How the APS-V1-0001 producer, the apss_topology.mjs shim, the aggregator's APSS merge, gate.mjs hard-enforcement, and the regenerable apss code-topology viz diagram form a closed-loop hard requirement, and how a coding agent consumes the feedback on every run. |
| [Sensors, coverage, and baselines](coverage-and-gate.md) | Per-app unit coverage policy (100 / 100 / 100 / 100); the VERDICT: line contract; the deliberate baseline-update flow for new modules and intentional refactors. |
| [Fitness dimensions reference](dimensions-reference.md) | Agent-facing catalog of every architectural-fitness dimension and metric enforced by harness/sensors/gate.mjs: code (MT01/MD01/ST01/SC01/LG01/AC01/PF01/AV01/CV01), per-metric direction and committed floor, speed tier (pre-commit/pre-push/CI), how an agent moves each metric, the upward-ratchet + atomic-baseline + EPSILON semantics, the sensor-determinism meta-guard, the just fitness surface, and the step-by-step recipe for adding a new dimension. |
| [Fitness-function timing and placement](fitness-timing-and-placement.md) | Wall-clock budget of every fitness function, the discipline rule per tier, and the rationale behind the CI-only placement of the full sensors gate. |
