---
name: "Versioning"
description: "Use cocogitto for conventional commits, version bumps, changelog generation, and tags"
status: accepted
---

# ADR-0011: Versioning

**Date:** 2026-05-16
**Category:** Slot
**Next review:** 2026-11-16

## Context

The versioning slot needs mechanical conventional-commit validation, semantic version bumps, changelog generation, and tag creation in one cross-platform tool.

## Decision

Use cocogitto as the reference versioning plugin.

## Consequences

The template gets a single Rust binary for commit validation and release flow. Deep per-package versioning needs may warrant Changesets or a secondary plugin for TS-only monorepos.

## Details

> The slot is `versioning` (Standard §4.11). Today's pick is cocogitto. This doc captures the rationale.

## Current pick

- **cocogitto v6+** ([github.com/cocogitto/cocogitto](https://github.com/cocogitto/cocogitto), [docs.cocogitto.io](https://docs.cocogitto.io/))
- **License:** MIT
- **Install:** `cargo install cocogitto` (works without lab publication) OR `cargo-binstall cocogitto` once lab publishes via cargo-dist
- **Distribution:** single Rust binary, no language-runtime dep

## Justification

- **Single-binary Rust** — matches harness-doc-validator + harness-sensors distribution shape (per `docs/adr/ADR-0012-binary-distribution.md`)
- **All-in-one** — `cog commit` (conventional-commits-validated commit creation), `cog bump` (semver bump + tag + changelog append), `cog changelog` (generate from history). One tool replaces what would otherwise be 2-3 tools chained.
- **Conventional-commits-native** — the lab already uses conventional commits by convention. cocogitto enforces it mechanically.
- **Pre-commit hook ready** — `cog verify` validates a single commit message; ms-class. Wires into lefthook trivially.
- **Cross-platform** — single binary per platform (Linux x64, Darwin x64+arm64, Windows x64).

## Maintenance signal

- Active development (releases in 2025-2026 per the GitHub releases page).
- Active community + Rust toolchain ecosystem.

## License

- MIT — permissive; redistribute freely in the template.

## Cross-platform

- macOS / Linux / Windows: all first-class.

## Alternatives considered

- **[git-cliff](https://git-cliff.org/)** — Rust binary, purely a changelog *generator* (doesn't bump versions). cocogitto can consume git-cliff-style configs (`cocogitto.toml` example in git-cliff repo). Use git-cliff alone if you want decoupled bump (Cargo + your own bump script) + changelog-only generation. Rejected as default because cocogitto delivers both in one tool.
- **[release-please](https://github.com/googleapis/release-please)** — Google, GitHub-Action-driven. Rejected because: (a) GitHub-Actions tied (less portable for self-hosted-git consumers like agentic-domain-runner which uses Gitea), (b) PR-workflow assumes GitHub PR-merge semantics, (c) more configuration overhead than cocogitto.
- **[Changesets](https://github.com/changesets/changesets)** — monorepo industry standard for per-package versioning. Node-centric. Rejected as default because the polyglot template includes Rust + Python + C++ packages where Changesets has no native support. Documented as the recommended plugin when the consumer is TS-only and explicitly per-package.
- **Custom Rust scanner** — considered. Rejected because cocogitto already handles the validate-commit-message + bump + changelog + tag-creation workflow. Adding a thin orchestrator wrapper (`harness/versioning/`) for per-package detection is sufficient.

## When to re-probe

- cocogitto v7+ ships with breaking changes — re-validate config.
- A consumer with deeply per-package versioning needs (e.g., a TS-only monorepo) reports cocogitto friction — consider shipping Changesets as a secondary plugin option.
- The lab wants release-PR-driven workflow (release-please style) instead of tag-driven — re-evaluate.
- A new conventional-commits-related Rust tool ships that supersedes cocogitto's scope.

## Sources

- [cocogitto on GitHub](https://github.com/cocogitto/cocogitto)
- [cocogitto docs site](https://docs.cocogitto.io/)
- [git-cliff cocogitto example](https://github.com/orhun/git-cliff/blob/main/examples/cocogitto.toml)
- [Changelogs guide (cocogitto)](https://docs.cocogitto.io/guide/changelog.html)
- [Best Automated Changelog Tools 2026 (usenotra.com)](https://www.usenotra.com/blog/best-automated-changelog-tools-in-2026)
- [Using Changesets in a polyglot monorepo (luke.hsiao.dev)](https://luke.hsiao.dev/blog/changesets-polyglot-monorepo/)
