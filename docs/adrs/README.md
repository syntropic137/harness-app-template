---
name: "Architecture Decision Records"
description: "Index of APSS ADR01 architecture decision records for the harness app template"
---

# Architecture Decision Records

This directory contains the numbered architecture decision records (ADRs) that ship with the template. They cover slot plugin picks, cross-cutting policy, and decisions about how the canonical template evolves.

Forks inherit these records as a baseline. Keep them, then add new numbered ADRs in this directory when your fork makes a load-bearing tooling or architecture choice.

## Index

| Document | Description |
|----------|-------------|
| [Stack Manager](ADR-0001-stack-manager.md) | Rust binary stack manager using bollard, portpicker, and docker compose |
| [Inspector](ADR-0002-inspector.md) | Playwright inspector with spawned ffmpeg for evidence capture |
| [Hooks](ADR-0003-hooks.md) | Use lefthook for fast polyglot Git hooks |
| [Telemetry SDK](ADR-0004-telemetry-sdk.md) | Use official OpenTelemetry SDKs per language |
| [Observability Stack](ADR-0005-observability-stack.md) | Use OTEL Collector with VictoriaLogs, VictoriaMetrics, and VictoriaTraces |
| [Sensors](ADR-0006-sensors.md) | Use an opt-in Rust aggregator with language adapters for architectural fitness signals |
| [Agent Plugins](ADR-0007-agent-plugins.md) | Use .claude as canonical agent context with vendor symlinks |
| [Task Runner](ADR-0008-task-runner.md) | Use just as the human-facing polyglot task runner |
| [Secret Scanner](ADR-0009-secret-scanner.md) | Use Gitleaks for secret scanning |
| [Doc Validator](ADR-0010-doc-validator.md) | Use a custom Rust crate for internal Markdown cross-reference validation |
| [Versioning](ADR-0011-versioning.md) | Use cocogitto for conventional commits, version bumps, changelog generation, and tags |
| [Binary Distribution](ADR-0012-binary-distribution.md) | Use cargo-dist and cargo-binstall for Rust harness binary distribution |
| [Coverage Enforcement](ADR-0013-coverage-enforcement.md) | Use high-threshold coverage gates with explicit opt-outs |
| [Strict Typing](ADR-0014-strict-typing.md) | Track strict typing posture and proposed tightenings as an audit record |
| [CHA Sync Source of Truth](ADR-0015-cha-sync-source-of-truth.md) | Treat the template as standalone canonical repo, not live-synced from the lab |
| [Create Harness App Wrapper](ADR-0016-createapp-wrapper-design.md) | Design a future npx create-harness-app wrapper as an additive scaffolding path |
| [Sensors v0.3 — APSS canonical, sentrux preserved](ADR-0017-sensors-v03-apss-canonical.md) | Promote APSS to canonical cross-language measurement; keep sentrux as an opt-in available adapter (deliberate both-vs-reduce decision, not a deletion) |
| [APSS v1.1.0 integration — augment, never replace](ADR-0018-apss-v1-1-0-augmentation.md) | Augment the doc-validator slot with APS-V1-0003 (add, do not replace) and route fitness signals through the ADR-0017 apss_topology shim |
| [Closed-loop architectural quality](ADR-0019-closed-loop-architectural-quality.md) | APS-V1-0001 code-topology runs every cycle, gate.mjs hard-enforces against real APSS metrics via the apss_topology shim, the diagram is regenerable, and structured verdict + diff reach any coding agent on every run |
| [Architectural fitness ratchet](ADR-0020-architectural-fitness-ratchet.md) | Ratchet floors upward on complexity, coupling, cycles, security, and licensing every commit; `--update-baseline` is the audited escape hatch |
| [Formatter slot](ADR-0021-formatter-slot.md) | Promote auto-formatter (Biome + Ruff) from implicit hook to a named, swappable `formatter` slot wired through `lefthook.yml` with `stage_fixed: true` |
| [Merge gating](ADR-0022-merge-gating.md) | Protect `main` with required PR-time status checks (workspace qa × 2, check, scripts, rust-coverage, python-coverage, sensors-coverage, documentation, fitness, fork-check, dep-audit); no required approvals so auto-merge does not deadlock the autonomous loop |
| [Dependency audit](ADR-0023-dependency-audit.md) | Polyglot CVE / supply-chain audit gate at CI (`pnpm audit`, `cargo audit`, `pip-audit`), with a fast lockfile-integrity check at pre-push; fail-closed on missing tooling |
| [Dead-code ratchet](ADR-0024-dead-code-ratchet.md) | Deterministic scoped-grep unused-export ratchet under MT01 (zero node_modules / network dependency, identical count locally and on every CI lane); floor auto-tightens on improvement, fails on regression; the "no broken windows" rot gate |

## Adding Records

Use the next four-digit number and a kebab-case title:

```text
docs/adrs/ADR-0020-my-decision.md
```

The canonical shape lives at [`../coordination/adr-template.md`](../coordination/adr-template.md) — **copy it as a starting point** rather than writing from scratch. The template lives outside this directory because the APSS APS-V1-0003 documentation gate strictly enforces the `ADR-\d{3,5}-…` naming pattern on every file in `docs/adrs/` and does not exempt template files. Keeping the template at `docs/coordination/adr-template.md` lets both the narrow `harness/doc-validator` (which checks internal links) and the APSS gate (which checks ADR naming) pass.

Each ADR must include APSS ADR01 front matter with `name`, `description`, and `status`, then the standard `## Context`, `## Decision`, and `## Consequences` sections. Use `## Details` for migrated rationale, alternatives, sources, and operational notes.

Update this README's Index table whenever a new ADR lands; the doc-validator pre-push hook enforces both the ADR-NNNN shape and that every numbered ADR is indexed here.

Authoritative spec for the ADR contract: [`../coordination/APSS-ADR-STANDARD.md`](../coordination/APSS-ADR-STANDARD.md).
