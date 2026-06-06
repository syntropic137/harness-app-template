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
| [Quality gates are compositional slots](ADR-0018-quality-gate-slot-composition.md) | Quality gates compose via slots that accept multiple provider inputs; portable standards and harness-native rules layer in the same slot rather than competing |

## Adding Records

Use the next four-digit number and a kebab-case title:

```text
docs/adrs/ADR-0018-my-decision.md
```

The canonical shape lives at [`_template.md`](./_template.md) — **copy it as a starting point** rather than writing from scratch. The leading underscore keeps it sorted before the numbered records and signals "meta / not a record". The doc-validator skips files beginning with `_`, so the template doesn't have to pass its own rule.

Each ADR must include APSS ADR01 front matter with `name`, `description`, and `status`, then the standard `## Context`, `## Decision`, and `## Consequences` sections. Use `## Details` for migrated rationale, alternatives, sources, and operational notes.

Update this README's Index table whenever a new ADR lands; the doc-validator pre-push hook enforces both the ADR-NNNN shape and that every numbered ADR is indexed here.

Authoritative spec for the ADR contract: [`../coordination/APSS-ADR-STANDARD.md`](../coordination/APSS-ADR-STANDARD.md).
