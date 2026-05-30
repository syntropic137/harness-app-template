---
name: "Strict Typing"
description: "Track strict typing posture and proposed tightenings as an audit record"
status: proposed
---

# ADR-0014: Strict Typing

**Date:** 2026-05-16
**Category:** Policy
**Next review:** 2026-08-16

## Context

The template advertises strict typing across languages, but declarations and enforcement can diverge if hooks or compiler settings are incomplete.

## Decision

Track the strict-typing posture as an audit record and prioritize concrete enforcement gaps before introducing new lint rules.

## Consequences

The record identifies where strictness is real and where it is only declarative. Proposed rule additions need source confirmation before becoming gates.

## Details

> Audit-only decision doc. Items marked **[no-research]** are config tightenings using tools we already have — safe to ship. Items marked **[needs-research]** propose new lint-rule names; must be confirmed against current-year tool docs via WebSearch before merging per CLAUDE.md rule #0.

## Current state — declared vs enforced

| Lang | Declared | Enforced pre-commit | Gap |
|---|---|---|---|
| **TS (lab)** | `tsconfig.base.json`: strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, noPropertyAccessFromIndexSignature. Biome: `noExplicitAny: warn`. | `biome check` + `pnpm -r typecheck` | `any` is **warn** not error; `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` unbanned; `!` non-null silenced; no `noUnusedLocals` / `noUnusedParameters`. |
| **TS (template)** | Same `tsconfig.base.json` with `_protected` sentinel. | **No `lefthook.yml` or `biome.json` shipped.** | Strict declarations but zero hook wiring — scaffolded projects inherit *type theatre*, not enforcement. |
| **Rust (lab `apps/api-rust`)** | No `[lints]` table, no `#![forbid(unsafe_code)]`. | `cargo fmt --check` + `cargo clippy -- -D warnings`. | **Lab's own Rust crate is weaker than the template's example.** |
| **Rust (template `example-rust`)** | `#![forbid(unsafe_code)]`; `[package.metadata.harness-engineering] strict_clippy=true, no_unsafe=true`. | None (template has no hook file). | Metadata is descriptive only — no tool reads it. `strict_clippy` not bound to clippy::pedantic/restriction. |
| **Python (lab)** | `[tool.mypy] strict=true`, `files=["src"]`. | mypy pre-commit on staged `*.py`. | `--strict` does NOT enable `disallow_any_explicit`, `warn_unreachable`, `strict_equality`. Tests dir untyped. |
| **Python (template)** | `[tool.mypy] strict=true`. | None. | Same template gap as TS. |
| **C++ (lab)** | `.clang-tidy` with `WarningsAsErrors: "*"`. | `clang-format` + `clang-tidy` pre-commit, **silently skipped** if toolchain or `compile_commands.json` missing. | Green-by-default on macOS dev hosts. |

## Headline findings

1. **The template ships strict typing declarations but NO hook wiring.** A scaffolded project has `strict: true` in tsconfig but no lefthook running typecheck pre-commit. Type-theatre.
2. **The lab's own `apps/api-rust` is weaker than the template's `example-rust`.** Inconsistency — the example sets a higher bar than the lab demonstrates.
3. **`mypy --strict` is not maximally strict.** Specifically misses `disallow_any_explicit`, `warn_unreachable`, `strict_equality`, `ignore-without-code`.
4. **`@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` are not banned in TS.** Biome `noExplicitAny` is warn-only.
5. **C++ hooks fail soft.** When LLVM isn't installed, the hook prints "skipped" and exits 0 — green CI on machines that can't enforce anything.

## Proposed tightenings — ranked by leverage

### 1. **[no-research] Ship `lefthook.yml` + minimal `biome.json` in the template.** ★ TOP PRIORITY
   The template has every strictness lever set in config but nothing actually runs them on commit. Add to `templates/polyglot-monorepo/files/`:
   - `lefthook.yml` mirroring the lab's gates (biome, typecheck, mypy, clippy, fmt).
   - `biome.json` with the same lab rules + the v0.2 tightenings below.
   - Wire `just bootstrap` to `pnpm install` so lefthook auto-registers.

### 2. **[no-research] Bring `apps/api-rust` to parity with template's example-rust.**
   - `apps/api-rust/src/main.rs:1`: add `#![forbid(unsafe_code)]`.
   - `apps/api-rust/Cargo.toml`:
     ```toml
     [lints.rust]
     unsafe_code = "forbid"
     unused = "deny"
     [lints.clippy]
     all = { level = "deny", priority = -1 }
     pedantic = { level = "warn", priority = -1 }
     ```
   `[lints]` table is stable since Rust 1.74 (no new tool).

### 3. **[no-research] Same `[lints]` block in `templates/.../example-rust/Cargo.toml`.**
   Makes the metadata declaration `strict_clippy=true` actually enforced instead of descriptive.

### 4. **[no-research] Extend mypy beyond `strict=true` in both pyproject.toml blocks (`apps/api-py/`, `templates/.../example-python/`):**
   ```toml
   disallow_any_explicit = true
   warn_unreachable = true
   strict_equality = true
   enable_error_code = ["redundant-self", "truthy-bool", "ignore-without-code"]
   ```
   `ignore-without-code` forces every `# type: ignore` to name a rule (Python parity for the `@ts-ignore` ban below).

### 5. **[no-research] Make cpp hooks fail-closed via env gate.**
   Replace `|| echo "skipped"` with `HARNESS_CPP_REQUIRE_LOCAL=1` → exit 1 when toolchain missing. Keep graceful skip as default for non-cpp contributors per retro 011, but enforce in CI.

### 6. **[needs-research] Biome `noExplicitAny: error` + ban TS ignore comments.**
   Flip `suspicious.noExplicitAny` from `warn` to `error`. Add a rule banning `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` — exact rule name must be confirmed against Biome 2.4.15+ release notes via WebSearch (current session denied). Until then: this is the only item that legitimately blocks on rule #0.

## Sources

Audit performed against repo state at HEAD (`172c45a`). Tool-version claims:
- Biome 2.4.15 — declared in `package.json` `devDependencies`
- mypy 1.13+ — declared as a workspace devDep
- Rust 1.74+ `[lints]` table support — Rust stable docs (pre-WebSearch knowledge, not load-bearing for the audit's existing-config findings)

Item #6 specifically requires WebSearch confirmation before shipping.
