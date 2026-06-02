# Lab vs Template Principle, Skill, Reference, and ADR Gap Analysis

Date: 2026-06-02

Template: `/data/projects/harness-app-template`

Lab: `/data/projects/NeuralEmpowerment--agentic-harness-lab`

## Scope

This report compares the lab harness-engineering principle docs, `.claude/skills` agent skills, reference material, and decision records against the template. It focuses on real template gaps that affect agent behavior, principle transfer, or ADR conformance.

Checked paths:

- Template: `docs/harness-engineering`, `.claude/skills`, `docs/adrs`
- Lab: `docs/harness-engineering`, `.claude/skills`, `docs/standard/decisions`

## Summary

The template carries the main harness-engineering principles and is ahead of the lab on reference summaries. The template also migrated the lab decision corpus into APSS ADR01-style numbered records under `docs/adrs`, which uses the required plural directory and `ADR-NNNN-title.md` naming.

Verified gaps remain in three areas:

- The lab checkout has an `orchestrating-a-vps-agent-swarm` skill that the template does not carry.
- Several copied template skills still contain lab-only command paths.
- Two ADRs are numbered correctly but still describe lab-specific app paths and enforcement surfaces rather than the current template.

## Principle Docs

| Area | Lab | Template | Result |
| --- | --- | --- | --- |
| Five harness principles | `docs/harness-engineering/README.md` | `docs/harness-engineering/lab-five-principles.md` | Ported and adapted. No new bead. |
| Harness reference catalog | Not present as a reference directory in lab | `docs/harness-engineering/README.md` plus `references/*.md` | Template is ahead. No bead. |
| Capability checklist | Not present in lab | `docs/harness-engineering/capability-checklist.md` | Template is ahead. No bead. |
| Key passages | Not present in lab | `docs/harness-engineering/key-passages.md` | Template is ahead. No bead. |
| Slot architecture | Not present in lab | `docs/harness-engineering/slot-architecture.md` | Template is ahead. No bead. |
| Upstream update flow | Present in both | Present in both | Ported. No new bead. |

Conclusion: the core principle content is present. No principle-doc bead is needed.

## Agent Skills

Template tracked skills:

- `before-after-evidence`
- `chrome-devtools-deep`
- `observability-queries`
- `playwright-debug`
- `running-experiments`

Lab skills on disk:

- `before-after-evidence`
- `chrome-devtools-deep`
- `observability-queries`
- `orchestrating-a-vps-agent-swarm`
- `playwright-debug`
- `running-experiments`
- `unreal-engine-5.7-api`

The common `chrome-devtools-deep`, `observability-queries`, and `before-after-evidence` files were checked against current template paths. The `playwright-debug` and `running-experiments` differences are expected template adaptations, not missing ports.

### Missing or Diverged Skills

| Finding | Evidence | Bead |
| --- | --- | --- |
| Template lacks the lab checkout's `orchestrating-a-vps-agent-swarm` skill. This is high value for the template because it documents Beads, Agent Mail, autonomy toggles, multi-agent review, and swarm handoff discipline. | Present at lab `.claude/skills/orchestrating-a-vps-agent-swarm/SKILL.md`; absent from template `.claude/skills`. | Existing bead: `create-harness-app-port-vps-swarm-skill-ff1` |
| Template has no committed portable Agent Mail wiring example. Both checkouts keep `.claude/settings.local.json` local and ignored, so the gap is not the absence of a local file in this machine. The gap is that fork users have no tracked example or recipe for Agent Mail setup. | Template tracks `.claude/settings.json` and hooks only; `.claude/settings.local.json` is ignored. | Existing bead: `create-harness-app-agent-mail-wiring-example-fzr` |
| `observability-queries` still tells agents to run `pnpm harness inspect`, but the template stack entrypoints are `just stack inspect`, `just stack ports`, and `harness/stack/bin/stack`. | `.claude/skills/observability-queries/SKILL.md` lines containing `pnpm harness inspect`. | Existing bead: `create-harness-app-observability-query-entrypoints-dae` |
| `before-after-evidence` still tells agents to use `pnpm harness inspect` and `harness/agent-tools/screenshot-pair.mjs` or `record-flow.mjs`. The template inspector tools live under `harness/inspector`. | `.claude/skills/before-after-evidence/SKILL.md` lines containing `pnpm harness inspect` and `harness/agent-tools`. | New bead: `create-harness-app-pud` |
| `unreal-engine-5.7-api` exists in the lab and is absent from the template. This is domain-specific Unreal Engine material, not a general harness template skill. | Present in lab tracked files under `.claude/skills/unreal-engine-5.7-api`; absent from template. | No bead. Deliberate non-port. |

## References

The lab does not have a `docs/harness-engineering/references` directory in the checked tree. The template has eleven reference summaries:

- `anthropic-effective-harnesses.md`
- `boringbot-ai-agent-harnesses-architecture.md`
- `lexi-lambda-parse-dont-validate.md`
- `lexler-approved-scenarios.md`
- `logic-ai-forcing-good-code.md`
- `martin-fowler-developer-skills.md`
- `martin-fowler-harness-engineering.md`
- `openai-codex-orchestration-symphony.md`
- `openai-harness-engineering.md`
- `stripe-minions-one-shot-agents.md`
- `thoughtworks-architectural-fitness-function.md`

Conclusion: no missing template reference gap was found.

## ADR Corpus

Lab decision records:

- `agent-plugins.md`
- `binary-distribution.md`
- `cha-sync-source-of-truth.md`
- `coverage-enforcement.md`
- `doc-validator.md`
- `hooks.md`
- `inspector.md`
- `observability-stack.md`
- `secret-scanner.md`
- `sensors-v0.3-apss-canonical.md`
- `sensors.md`
- `stack-manager.md`
- `strict-typing.md`
- `task-runner.md`
- `telemetry-sdk.md`
- `versioning.md`

Template ADR records:

- `ADR-0001-stack-manager.md`
- `ADR-0002-inspector.md`
- `ADR-0003-hooks.md`
- `ADR-0004-telemetry-sdk.md`
- `ADR-0005-observability-stack.md`
- `ADR-0006-sensors.md`
- `ADR-0007-agent-plugins.md`
- `ADR-0008-task-runner.md`
- `ADR-0009-secret-scanner.md`
- `ADR-0010-doc-validator.md`
- `ADR-0011-versioning.md`
- `ADR-0012-binary-distribution.md`
- `ADR-0013-coverage-enforcement.md`
- `ADR-0014-strict-typing.md`
- `ADR-0015-cha-sync-source-of-truth.md`
- `ADR-0016-createapp-wrapper-design.md`
- `ADR-0017-sensors-v03-apss-canonical.md`

All lab decisions are represented in the template ADR corpus. The template also has the template-only `ADR-0016-createapp-wrapper-design.md`.

### APSS ADR01 Conformance

| Check | Template result |
| --- | --- |
| Default ADR directory | Conforms: `docs/adrs` plural |
| File naming | Conforms: `ADR-NNNN-title.md` |
| Index | Present: `docs/adrs/README.md` |
| Template | Present: `docs/adrs/_template.md` |

The lab source corpus still lives under `docs/standard/decisions` with unnumbered names. That is a lab-side source difference, not a template gap.

### ADR Drift

| Finding | Evidence | Bead |
| --- | --- | --- |
| `ADR-0013-coverage-enforcement.md` is structurally migrated but still describes lab v0.7.1 coverage surfaces, including `apps/api-rust`, `apps/api-py`, `packages/telemetry`, `harness/sensors/src`, and coverage recipes not currently accurate for the template. | Verified by stale path references in `docs/adrs/ADR-0013-coverage-enforcement.md`. | New bead: `create-harness-app-e2p` |
| `ADR-0014-strict-typing.md` is structurally migrated but still reads like the lab audit. It says the template has no hook file, while the template now has `lefthook.yml`, `biome.jsonc`, `ws_apps/example-python`, `ws_apps/example-rust`, and template-specific lint and typecheck wiring. | Verified by stale path and hook references in `docs/adrs/ADR-0014-strict-typing.md`. | New bead: `create-harness-app-aje` |

## Beads Filed or Reused

New beads filed by this analysis:

- `create-harness-app-pud` - fix stale before/after evidence skill inspector entrypoints.
- `create-harness-app-e2p` - update ADR-0013 to match template coverage reality.
- `create-harness-app-aje` - update ADR-0014 to match template strict typing reality.

Existing beads reused to avoid duplicates:

- `create-harness-app-port-vps-swarm-skill-ff1` - port the VPS swarm orchestration skill.
- `create-harness-app-agent-mail-wiring-example-fzr` - add portable Agent Mail wiring example.
- `create-harness-app-vendor-mirror-link-recipe-w66` - add vendor mirror link recipe for `.codex`, `.gemini`, and `AGENTS.md`.
- `create-harness-app-observability-query-entrypoints-dae` - fix observability skill command entrypoints.
