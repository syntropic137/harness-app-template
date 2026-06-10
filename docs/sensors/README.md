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
| [Fitness dimensions reference](dimensions-reference.md) | Agent-facing catalog of every fitness dimension and metric: code, direction, committed floor, speed tier, how to improve it, ratchet semantics, sensor-determinism meta-guard, and the recipe for adding a new dimension. |
| [Architectural-fitness closed loop](closed-loop.md) | PRODUCE / CONSUME / MERGE / ENFORCE pipeline; the five-point agent contract for parsing the gate verdict; failure modes and remediation. |
| [Sensors, coverage, and baselines](coverage-and-gate.md) | Per-app unit coverage policy (100 / 100 / 100 / 100); the `VERDICT:` line contract; the deliberate baseline-update flow for new modules and intentional refactors. |
| [Fitness-function timing and placement](fitness-timing-and-placement.md) | Wall-clock budget of every fitness function, the discipline rule per tier, and the rationale behind the CI-only placement of the full sensors gate. |
