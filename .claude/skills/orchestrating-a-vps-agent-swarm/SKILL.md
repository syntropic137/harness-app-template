---
name: orchestrating-a-vps-agent-swarm
description: Guidance for managing a multi-agent swarm on this template's VPS environment. Use when coordinating multiple autonomous agents (Claude Code, Codex, Gemini) across parallel beads, handling double-claim collisions via Agent Mail, and using beads for global task state. Covers per-agent autonomy toggles (YOLO vs review-gated), multi-model layered review, the human framing gate, and the canonical CLI surface (`br`, `bv`, `am`, `proj`, `ntm`).
---

# Orchestrating a VPS agent swarm

## Overview

A VPS agent swarm is multiple specialized models running in shared or
isolated workspaces on the same VPS. Success depends on: clear framing,
asynchronous coordination via Agent Mail and beads, and a layered review
stack across models with different defect lenses.

This template's VPS layout is documented in `~/CLAUDE.md`. The phase
model (ideation, task breakdown, swarm implementation, review, deploy)
is at <https://agent-flywheel.com/workflow>. This skill covers phase 3
(swarm implementation) in operational detail.

## Core lessons and patterns

### 1. Per-agent autonomy toggles (the YOLO switch)

Autonomy is a scheduling resource, not a binary state.

- **YOLO mode.** Speed and execution on low-risk tasks (scaffolding,
  bulk refactors, doc edits). Launch with the host CLI's bypass flag:
  Claude Code `--permission-mode bypassPermissions`, Codex
  `--dangerously-bypass-approvals`, Gemini `--yolo`.
- **Review-gated mode.** High-stakes architectural choices where each
  tool call should be audited. Drop the bypass flag; let prompts
  interrupt.
- **Rule.** Launch each agent with the autonomy level tailored to its
  bead, not a session default.

### 2. Multi-model layered review

Different models catch different defect classes.

- **Author** (Claude). High-level reasoning, complex spec generation,
  multi-file refactors.
- **Skeptical reviewer** (Codex). Implementation consistency,
  boundary-condition checks, line-level correctness.
- **Consistency reviewer** (Gemini). Cross-specification alignment,
  architectural split-brain detection, doc drift.
- **Outcome.** A "passed" feature from one model should be
  cross-verified by another with a different lens before close.

### 3. The human framing gate

Models are excellent at local correctness but weaker at strategic
pivots.

- **Pattern.** Human intervention is most valuable at the *beginning*
  (framing the product, choosing the bead set) and *middle* (re-scoping
  based on research findings or an unexpected adversarial finding).
- **Lesson.** If an agent is solving the wrong problem perfectly, the
  human must correct the frame before the next execution wave begins.
  The swarm cannot rescope itself.

### 4. Coordination: beads + Agent Mail

Structured state plus asynchronous communication.

- **beads.** The global DAG. Provides stable IDs for claims,
  completions, and dependencies. The `.beads/` directory is committed
  to the project repo.
- **Agent Mail.** The rationale bus. Carries handoffs, merge
  negotiations, reservation announcements, and review findings.
- **Pattern.** Every significant Agent Mail finding should point to a
  bead ID. Every bead claim should be preceded by an Agent Mail
  broadcast on the relevant thread when the work touches files multiple
  beads care about.

## CLI surface (the template's actual tools)

```sh
# beads (per-project tracker; cwd-scoped)
br create -t "..." -d "..."           # new bead
br update <id> --status in_progress   # claim
br close <id> --reason "..."          # finalize (terminal-state)
bv                                    # interactive TUI
bv --robot-next                       # pick next ready bead (JSON)
bv --robot-triage                     # full recommendation set

# Agent Mail (cross-agent comms)
am macros start-session ...           # register an agent identity
am status --agent <NAME>              # inbox + reservation overview
am file_reservations reserve <PROJECT> <AGENT> <PATHS>...
am mail send --from <AGENT> --to <AGENT> --subject ... --body ...
am thread <ID>                        # read a coordination thread

# Project navigation (numbered)
proj                                  # list projects under /data/projects/
proj spawn <N> --cc=<K>                # ntm spawn an agent swarm at project N
proj attach <N>                       # re-attach
proj path <N>                         # absolute path of project N
ntm spawn <org>--<repo> --cc=<N>      # raw ntm form

# Sessions
systemctl --user status agent-mail    # the mail service is required
```

## Operational checklist

- [ ] **Pre-trust environments.** Folder trust and MCP server
      permissions must be granted before dispatching. Re-running
      `claude login` on the VPS is a known anti-pattern; ACFS
      `services-setup` from the operator's Mac is the only path.
- [ ] **Register the agent.** Run `am macros start-session
      --project <abs path> --program <cli> --model <id>` on every fresh
      turn. Without an identity, `am status` cannot inspect inbox or
      reservations.
- [ ] **Claim before you edit.** `br update <id> --status in_progress`
      is the authoritative claim. Two agents that both claim are a
      coordination bug; one of them must stand down via Agent Mail.
- [ ] **Reserve shared files.** When a bead touches a file another
      bead also touches (e.g., `justfile`, `lefthook.yml`,
      `.github/workflows/*`), `am file_reservations reserve` it before
      editing. Skipped reservations cause edit races; recovery costs
      more than the reservation.
- [ ] **Exact file ownership.** Every bead's description should call
      out a specific canonical file path. Name placeholders
      (`<filename>`) cause collisions.
- [ ] **Wedge detection.** Watch for "busy" agents that have not
      touched the filesystem or Agent Mail in N minutes. Use
      `am status --agent <NAME>` to confirm a quiet agent is actually
      idle, not stuck.
- [ ] **Whole-template QA.** After individual feature beads close,
      run `just bootstrap && just test && just lint` against a fresh
      clone (or a worktree) before declaring the swarm output green.
      Per-bead green does not imply assembled green.

## Standard collision-recovery flow

When `bv --robot-next` hands you a bead another agent has already
claimed (visible in Agent Mail threads):

1. Re-read the bead state: `br show <id>`. The status field is the
   shared source of truth.
2. Look up active Agent Mail threads referencing the bead ID:
   `am status --agent <NAME>` then `am thread <ID>` on any
   relevant subject lines.
3. If the other agent has substantive work in the tree, **stand
   down**. Send an Agent Mail reply on the existing thread (or a fresh
   one with a `bd-<id>-coord` style alphanumeric thread-id) naming the
   files you edited and confirming you will not commit. Then
   `bv --robot-next` for a fresh bead.
4. If the other agent appears wedged (no Agent Mail activity, no
   recent file edits), surface that to the human framing gate via an
   Agent Mail message rather than unilaterally taking the bead. The
   wedge is the framing-gate event, not the failed claim.

## Anti-patterns

- **Silent double-claim.** Two agents both run `br update --status
  in_progress` without checking Agent Mail. Recovery: stand down via
  Agent Mail; the bead claim is not exclusive at the beads layer.
- **Unilateral retirement.** Removing or deprecating shared
  infrastructure (a hook, a sensor adapter, an ADR) without an Agent
  Mail broadcast first. The operator's preservation rule applies; see
  ADR-0017's "both-vs-reduce" framing.
- **Per-bead green declared as swarm green.** Each bead's gate is
  per-file or per-slot. A swarm landing requires whole-template
  verification (see Operational checklist).
- **Mail without a bead ID.** Coordination messages that name files but
  not beads decay into untrackable rationale. Cross-link every thread
  to at least one bead.
