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

## Adding Records

Use the next four-digit number and a kebab-case title:

```text
docs/adr/ADR-0017-my-decision.md
```

Each ADR must include APSS ADR01 front matter with `name`, `description`, and `status`, then the standard `## Context`, `## Decision`, and `## Consequences` sections. Use `## Details` for migrated rationale, alternatives, sources, and operational notes.
