# Contributing

This template's contribution flow is the same as any harness-shaped project: hypothesis-first experiments for non-trivial changes, ADRs for decisions, fitness gates on every commit.

## Quick start

1. Read [`docs/harness-engineering/README.md`](./docs/harness-engineering/README.md) for the discipline and the canonical references catalog.
2. Read [`docs/harness-engineering/lab-five-principles.md`](./docs/harness-engineering/lab-five-principles.md) for the five load-bearing principles that govern any change.
3. Read [`CLAUDE.md`](./CLAUDE.md) for agent-facing conventions.

## Gates

Every commit + every push runs:

- Pre-commit: Biome format/lint, Gitleaks secret-scan, UBS bug scan.
- Pre-push: typecheck, test, `scripts/` 100% coverage, UBS diff, doc-validator, **sensors gate** (baseline-snapshot mode — fails on any worsening of per-folder Martin I/D; bead `create-harness-app-n48.4`).

The fitness gates are how the harness enforces architectural quality on every run. If a gate fails, fix the regression rather than relaxing the gate. Lowering a baseline is a deliberate act: `just sensors gate --update-baseline` and commit the resulting `harness/sensors/baseline.json` as part of the same change.

## ADRs

Decisions live under [`docs/adrs/`](./docs/adrs/) in the APSS ADR01 shape (`ADR-NNNN-kebab-case-title.md`). Read the existing records before changing harness-owned architecture. Never renumber an accepted ADR; mark it superseded and write the next-numbered one.

## Bead-driven work

In-flight work is tracked under `.beads/`. Use `br ready` to find the next P0/P1 item.

## Code of conduct

See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
