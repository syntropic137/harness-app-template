---
name: "Strict Typing"
description: "Treat strict typing as enforced template policy with explicit gaps"
status: accepted
---

# ADR-0014: Strict Typing

**Date:** 2026-05-16
**Category:** Policy
**Next review:** 2026-08-16

## Context

The template advertises strict typing across TypeScript, Python, and Rust.
That promise is useful only when the declared compiler or linter posture is
bound to commands, hooks, and CI workflows that agents actually run.

This ADR was imported from a lab audit and had drifted. It claimed the template
had no `lefthook.yml` or Biome configuration, and it cited lab-specific app and
package paths. The template now has its own enforcement surface:

- `lefthook.yml` with staged Biome, Python ruff, Python mypy, affected
  typecheck, and CI-mirrored pre-push checks.
- `biome.jsonc` with `suspicious.noExplicitAny = "error"` and
  `style.noNonNullAssertion = "error"`.
- `tsconfig.base.json` with strict compiler settings inherited by TypeScript
  packages.
- `ws_apps/example-python/pyproject.toml` with `mypy strict = true` plus
  additional rules for explicit `Any`, unreachable code, strict equality, and
  bare type-ignore comments.
- Rust `[lints]` tables and `#![forbid(unsafe_code)]` in the example Rust app
  and the real Rust harness slots.

## Decision

The template treats strict typing as an enforced policy, not an aspirational
audit note:

- TypeScript workspaces must inherit `tsconfig.base.json`, pass their package
  `typecheck` script, and pass Biome with `any` and non-null assertions blocked.
- Python workspaces must pass package-local mypy strict mode and ruff checks.
- Rust workspaces and Rust harness slots must forbid unsafe code and deny
  Clippy's `all` lint group through Cargo lints and package `lint` scripts.
- Gaps are documented below as template policy debt. They are not silent
  exceptions.

## Consequences

The template no longer has a "declared but not run" strict-typing posture for
the primary example app and harness slot surfaces. A fork gets runnable
commands, local hooks, and CI workflows that exercise the same policy.

This also makes the remaining gaps sharper. Root `scripts/*.ts` are linted and
tested, but they are not currently covered by a root `tsc --noEmit` project.
TypeScript suppression comments are review-governed rather than mechanically
banned. JavaScript `.mjs` harness slots are syntax-checked and tested, but are
not TypeScript strict surfaces.

## Details

### Current Policy As Of 2026-06-04

| Surface | Strictness contract | Enforcement paths | Known gap |
|---|---|---|---|
| `ws_apps/example-typescript` | Extends `tsconfig.base.json`; package lint uses Biome over `src` and `tests`; `any` and non-null assertions are errors. | `pnpm --filter @example/typescript typecheck`; `pnpm --filter @example/typescript lint`; `just typecheck`; `just lint`; `just qa`; `lefthook` pre-commit Biome; pre-push affected typecheck; `.github/workflows/test.yml` `pnpm qa`. | TypeScript suppression comments are not mechanically banned. Existing uses must carry a reason and be reviewed. |
| `ws_packages/telemetry` | Extends `tsconfig.base.json`; package lint uses Biome over `src` and `tests`. | `pnpm --filter @harness/telemetry typecheck`; `pnpm --filter @harness/telemetry lint`; `just typecheck`; `just lint`; `just qa`; `lefthook` pre-commit Biome; pre-push affected typecheck; `.github/workflows/test.yml` `pnpm qa`. | Same TypeScript suppression gap as above. |
| `ws_apps/docs` | Extends `tsconfig.base.json`; `typecheck` runs `fumadocs-mdx` and `tsc --noEmit`. | `pnpm --filter @harness/docs typecheck`; `pnpm docs:build`; `.github/workflows/pages.yml`; `just typecheck`; `just qa`. | `allowJs = true` is required by the docs stack, so docs are not a pure TypeScript-only surface. |
| `harness/stack` | Extends `tsconfig.base.json`; `lint` and `typecheck` run `tsc --noEmit`. | `pnpm --filter @harness/stack typecheck`; `pnpm --filter @harness/stack lint`; `just typecheck`; `just lint`; `just qa`; pre-push affected typecheck; `.github/workflows/test.yml` `pnpm qa`. | No separate Biome lint is wired for this package; the compiler is the strictness gate. |
| Root `scripts/*.ts` | Biome lint and Vitest coverage protect the scripts tree. | `lefthook` pre-commit Biome; `pnpm test:scripts`; `pnpm test:coverage`; `just qa`; `.github/workflows/test.yml` scripts coverage job. | No root `tsconfig.json` or root package `tsc --noEmit` gate covers the scripts tree today. |
| `harness/sensors` and `harness/inspector` `.mjs` tools | Syntax checks, focused tests, and gate scripts. | Package `lint`, `typecheck`, and `test` scripts; `just sensors gate`; pre-push sensors gate; `.github/workflows/test.yml` fitness job. | These are JavaScript slot tools, not TypeScript strict surfaces. |
| `ws_apps/example-python` | `mypy strict = true`; `disallow_any_explicit = true`; `warn_unreachable = true`; `strict_equality = true`; `ignore-without-code` enabled; ruff lint and format checks. | `pnpm --filter @example/python typecheck`; `pnpm --filter @example/python lint`; `just typecheck`; `just lint`; `just qa`; `lefthook` pre-commit python-mypy, python-ruff, and python-ruff-format; `.github/workflows/test.yml` python coverage job. | Explicit `Any` exists only behind specific `# type: ignore[explicit-any]` escape hatches for OpenTelemetry SDK boundaries. |
| `ws_apps/example-rust` | `#![forbid(unsafe_code)]`; Cargo `[lints.rust] unsafe_code = "forbid"`; unused denied; Clippy `all` denied. | `cargo check`; `cargo clippy --all-targets -- -D warnings`; package `lint` and `typecheck`; `just qa`; `just bootstrap`; `.github/workflows/test.yml` `pnpm qa`. | Clippy is not a pre-commit or pre-push hook. It is enforced through `just lint`, `just qa`, and CI. |
| `harness/doc-validator` and `harness/versioning` | `#![forbid(unsafe_code)]` in crate roots; Cargo `[lints]` forbid unsafe and deny Clippy `all`. | Package `lint` and `typecheck`; `just qa`; `.github/workflows/test.yml` `pnpm qa`; versioning workflow runs versioning tests and release checks. | Same Rust hook gap as above. |
| `harness/stack/rust-stub` | Cargo `[lints]` forbid unsafe and deny Clippy `all`, even though the crate is a stub. | Package build surfaces and direct Cargo commands. | Stub is intentionally excluded from root Rust coverage and is not a real stack-manager implementation. |

### Enforcement Map

- `just lint` runs `bun run scripts/lint.ts`, which delegates to
  `pnpm turbo run lint`.
- `just typecheck` runs `bun run scripts/typecheck.ts`, which delegates to
  `pnpm turbo run typecheck`.
- `just qa` runs `pnpm turbo run lint typecheck test --concurrency=1`.
- `lefthook.yml` pre-commit checks staged TypeScript, JavaScript, JSON,
  Markdown, YAML, Python, secrets, docs, and UBS findings.
- `lefthook.yml` pre-push runs affected package typecheck and tests, coverage,
  doc validation, sensors, performance, versioning, and UBS gates.
- `.github/workflows/test.yml` runs `pnpm qa` on Ubuntu and macOS, root scripts
  coverage, Rust coverage, Python mypy plus coverage, and fitness gates.
- `.github/workflows/pages.yml` builds the docs app on docs-relevant changes.
- `.github/workflows/versioning.yml` tests the versioning slot and release
  discipline.

Local hooks deliberately soft-skip when required tools are absent so a partial
developer machine can still commit. CI installs the toolchains needed for the
main checks and is the hard backstop for pull requests and pushes to `main`.

### Resolved Drift From The Imported Audit

- The missing hook file claim is obsolete. The template has `lefthook.yml`.
- The missing Biome config claim is obsolete. The template has `biome.jsonc`.
- `noExplicitAny` is now an error, not a warning.
- Non-null assertions are blocked by Biome.
- Python strict typing now includes explicit `Any`, unreachable-code, strict
  equality, and bare-ignore checks.
- Rust example and Rust slot crates have Cargo lints and unsafe-code forbids.
- Legacy lab app paths and C++ hook findings are not template policy surfaces.

### Open Gaps

1. Add a root TypeScript compiler project for `scripts/*.ts` or document why
   Biome plus tests are sufficient for that tree.
2. Confirm a current Biome rule or companion tool for banning unreasoned
   `@ts-ignore`, `@ts-expect-error`, and `@ts-nocheck` comments. Until then,
   review must reject suppressions that lack a narrow reason.
3. Decide whether Rust Clippy should also run in local pre-push, or whether the
   current `just qa` plus CI backstop is the right cost tradeoff.
4. Keep `.mjs` harness slots explicit as syntax-checked JavaScript until they
   either move to TypeScript or grow a separate typed contract.

### Sources

This ADR is based on file verification in the template:

- `lefthook.yml`
- `biome.jsonc`
- `tsconfig.base.json`
- `turbo.json`
- `justfile`
- `package.json`
- `pnpm-workspace.yaml`
- `.github/workflows/test.yml`
- `.github/workflows/pages.yml`
- `.github/workflows/versioning.yml`
- `ws_apps/example-typescript/package.json`
- `ws_apps/example-python/pyproject.toml`
- `ws_apps/example-rust/Cargo.toml`
- `ws_packages/telemetry/package.json`
- `harness/stack/package.json`
- `harness/stack/tsconfig.json`
- `harness/doc-validator/Cargo.toml`
- `harness/versioning/Cargo.toml`
- `harness/sensors/package.json`
- `harness/inspector/package.json`
