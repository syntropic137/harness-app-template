---
name: "Binary Distribution"
description: "Use cargo-dist and cargo-binstall for Rust harness binary distribution"
status: accepted
---

# ADR-0012: Binary Distribution

**Date:** 2026-05-16
**Category:** Policy
**Next review:** 2026-11-16

## Context

Harness binaries should reach consumers without requiring every consumer to compile Rust locally.

## Decision

Use cargo-dist for packaging/releasing Rust binaries and cargo-binstall for consumer installation, with `cargo install --path` as the local fallback.

## Consequences

Consumers can install harness binaries from release artifacts with no Rust toolchain. GitHub Releases remain the distribution constraint until a larger release-audit surface is needed.

## Details

> **Consumer summary (hybrid).** This file ships only the outcome. The full comparison (alternatives considered, vendor evaluations, marketplace landscape) was authored in the upstream R&D lab and is preserved there as historical context: [`agentic-harness-lab/docs/standard/decisions/binary-distribution.md`](https://github.com/NeuralEmpowerment/agentic-harness-lab/blob/main/docs/standard/decisions/binary-distribution.md). The outcome below is the part you act on in a consumer fork.

## Current pick

- **cargo-dist** (v0.30+) for **packaging + releasing** Rust binaries to GitHub Releases as static tarballs.
- **cargo-binstall** (v1.13+) for **installing** those binaries on consumers without compiling.
- **Local-only fallback:** `just bootstrap-harness` runs `cargo install --path` against a local checkout when no published release exists.

## What this means for your fork

The harness binaries (`harness-sensors`, `harness-doc-validator`, the future `harness-stack` Rust port) are distributed via this pattern. Consumers do NOT need a Rust toolchain to install them — `cargo-binstall` downloads the pre-built static tarball from GitHub Releases.

If you build your own Rust binaries inside `ws_apps/` or `ws_packages/`, you're free to adopt the same pattern (the configs in your `Cargo.toml`s can mirror the templates here), but it's not required — your application's distribution model is your call.

## Why this combination

- **Industry-converged 2026 pattern.** cargo-dist + cargo-binstall is the modern Rust-CLI standard; both surfaced as canonical answers in the upstream research pass.
- **Zero language-runtime-dep for consumers.** No Rust toolchain on the install path.
- **Cross-platform.** cargo-dist targets x86_64-linux + aarch64+x86_64-darwin + x86_64-windows out of the box.
- **Local-only viable.** The fallback (`just bootstrap-harness`) works against a local checkout without any remote.

## Maintenance signal

Both tools are actively maintained:
- **cargo-dist** — multiple releases per quarter, maintained by Axo.
- **cargo-binstall** — v1.x line since 2024; used by ripgrep, bat, and many others as their canonical installer.

## License

- cargo-dist — Apache-2.0 / MIT (dual-licensed, permissive).
- cargo-binstall — Apache-2.0 / MIT.

## When to re-evaluate

Open the lab's [binary-distribution.md](https://github.com/NeuralEmpowerment/agentic-harness-lab/blob/main/docs/standard/decisions/binary-distribution.md) and check the "Maintenance signal" + "Alternatives considered" sections if any of these trip:

- cargo-dist or cargo-binstall stops shipping releases for > 6 months.
- A new Rust-CLI distribution standard emerges and consolidates the field.
- Your fork's release blast radius outgrows GitHub Releases (large team, signed-release auditing, etc.) — at that point Sigstore Cosign is the next layer (see [`../../security.md`](../../security.md) § "Signed commits and releases").
