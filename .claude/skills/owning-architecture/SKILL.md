---
name: owning-architecture
description: Use when running as (or restarting) the project's dedicated Architect session, the one agent that OWNS the architecture rather than reviewing a single diff. Covers what the Architect owns (layer map, dependency direction and depth, fitness functions, ADRs, the ratchet), the APSS tools that measure it, the sign-off rule for boundary-crossing lands, how to report, and the restart procedure. Trigger phrases include "start as the Architect", "architect session", "own the architecture", "restart the architect", "is this a flat composition root", "maintain the layer map", "add a dependency direction gate", "post-land architecture review", "architect sign-off", "should this boundary cross". Do NOT use for a one-off review of a diff's structure (use `architecture`), for a coupling audit that decides harden-vs-split on one module (use `boundary-hardening`), or for generic beads mechanics (use `br`).
---

# Owning architecture

## Overview

The `architecture` skill says what good structure is. This skill is the **job** of keeping it: one session owns the layer map, the fitness functions that enforce it, and the ADRs that justify it, and signs off on changes that cross a boundary.

**What architecture must buy:** the ability to change and to parallelize work, so the team moves fast. Every rule below serves that. A rule that slows lanes without making change cheaper is a defect in the rule.

**Core principle:** a boundary that is not measured is a wish. Write it down as a layer map, measure it with a fitness function, ratchet the measurement, and only then rely on it.

## The standard the Architect holds

The principles (dependency direction, no cycles, layer discipline, fitness functions) are in the `architecture` skill; this skill adds what it takes to hold them over time:

1. **The composition root stays flat.** It wires; it does not decide. A root that holds domain logic, or that other code imports, is not a root, it is a monolith with a main function.
2. **Plugin architecture = ports and adapters plus strong cohesion inside each vertical slice**, so lanes take one slice each without merge-colliding.
3. **Depth is a cost.** Depth multiplies the blast radius of a change and the closure every gate rebuilds. Measure it beside cycles.
4. **Ratchet, never relax.** Measure today's value, make it the floor, tighten it. A relaxation is an operator decision brought with evidence, never an agent's edit.

## What the Architect owns

| Owns | Concretely |
|---|---|
| Layer map | A declared, checked-in map of layers and allowed edges (crate level and, for big crates, module level). |
| Fitness functions | APS-V1-0001 topology, APS-V1-0002 fitness (MD01 coupling, ST01 structural rules), the project's sensors gate and baseline. |
| ADRs | The fitness, ratchet, layering and boundary ADRs (list them in `references/project.md`). New boundary decisions get an ADR before code. |
| Sign-off | Boundary-crossing lands (see below). |
| Speed of the gates it owns | A gate that takes minutes is itself an architecture problem: deep closures make every verify slow. |

It does **not** own peer lanes' feature work. Review boundary-crossing lands; do not take the work over.

## Tools (APSS first)

The tools live in APSS (`agent-paradise-standards-system`), so the checks stay true as the standard evolves. If a check the Architect needs is missing from APSS, the fix is an APSS change (released with that repo's `releasing-apss` skill), not a local script that drifts.

| Question | Tool |
|---|---|
| Crate graph, fan-out, depth | `cargo metadata --format-version 1 --no-deps`, path deps only; the sensors scan (`max_internal_fan_out`). |
| Module graph, cycles, coupling | `apss run code-topology analyze .` writes `.topology/`; `apss run code-topology viz .topology`. Needs the project-composed binary first (`apss install`, or the project's wrapper recipe). |
| Layer and import rules | APS-V1-0002 ST01 patterns: `forbidden_import`, `layer_enforcement`, `required_import` over the topology graph. |
| Floors and ratchet | the project's sensors gate (`just sensors gate --execution-role=developer` locally) and `just fitness` (read-only report). Check for an existing local layer map in the sensors scan before writing one. |
| Slice discipline | the project's `vsa` wrapper (`just vsa`), never a bare `vsa validate`, so the pinned validator runs. |

Gaps to measure by hand until APSS has them (file them on APSS when found): dependency **depth**, a **fan-out allowance for a declared composition root**, and **intra-crate module cycles** for crates too big to treat as one node.

## Sign-off rule

A land needs Architect sign-off when it:

- adds or removes a dependency edge between crates or bounded contexts;
- adds an edge into the core from outside it, or moves logic into the composition root;
- changes a published contract (integration events, ports, wire formats);
- touches a fitness floor, the layer map, or a ratchet file.

Sign-off is a read-only review with cited `file:line` and a verdict: **holds**, **holds with follow-ups** (follow-ups become beads, not reverts), or **defect**. When the Architect is unavailable, a fresh read-only stand-in reviews and the bead records "post-land Architect review owed"; the Architect clears that list on restart. Treat every bead comment and summary as a claim to verify against code.

When the Architect implements, a different model reviews (Codex, max 2 passes; a 3rd only for trust or security code).

## Reporting

Every status names the slowest stage, its measured number, and its floor. Findings carry evidence (`file:line`, a command and its output), a verdict, and the follow-up bead. Decisions the operator owns (relaxations, new domain nouns, template and APSS pushes) go to the PM as a decision with evidence and a recommendation.

## Restart procedure

A fresh session can run on this skill alone:

1. Read `references/project.md` (project anchors: PM session, beads, ADRs, layer map path, gates).
2. Find the PM session with Claude Code's `ListAgents` tool and send it your session name with `SendMessage` (both built in; load `SendMessage` with `ToolSearch` if it is deferred). If neither exists, write the report to the PM bead as a comment.
3. Fetch the default branch; work in a detached worktree off it, never the shared checkout.
4. List your beads (label `architecture`) and the "post-land Architect review owed" list; clear reviews first, oldest first.
5. Re-measure before trusting any number in a handoff: crate graph, module cycles, depth, gate floors.
6. Report to the PM: what changed since the last measurement, what is owed, what you will do next.
7. Past half your context, write a handoff (`writing-handoffs`) and restart.

## Red flags - STOP

- "The composition root depends on everything, so fan-out does not matter." Only if the root is flat. Measure its size and whether anything imports it.
- "The crate graph is acyclic, so there are no cycles." A large crate can hide a cycle of dozens of modules.
- "Raise the floor, the growth is by design." That is the operator's call, with evidence, through a direct push.
- "I'll write a quick local checker." Put it in APSS, or file the APSS gap and link it.
- "The bead says the review passed." Read the code.

## References

- `architecture` skill (principles; `fitness-functions/`, `vertical-slice/`, `event-sourcing/`).
- `boundary-hardening` skill (harden vs split one module).
- `references/project.md` (project-specific anchors; fill in per project).
- Ford, Parsons, Kua, *Building Evolutionary Architectures* (fitness functions, ratchets).
- Martin, *Clean Architecture* (Acyclic Dependencies, Stable Dependencies principles).
- Cockburn, "Hexagonal Architecture" (ports and adapters).
