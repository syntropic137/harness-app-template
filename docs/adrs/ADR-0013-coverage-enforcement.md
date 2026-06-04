---
name: "Coverage Enforcement"
description: "Use high-threshold coverage gates with explicit opt-outs"
status: accepted
---

# ADR-0013: Coverage Enforcement

**Date:** 2026-05-16
**Category:** Policy
**Next review:** 2027-05-16

## Context

Coverage thresholds are only useful if they are explicit, measured, and resistant to quiet lowering as the codebase changes.

This template no longer matches the imported lab coverage surface. The current
template has example apps, shared packages, and harness slots with mixed
coverage maturity:

- `scripts/`, `ws_apps/example-typescript`, and `harness/inspector` enforce
  100 percent Vitest coverage.
- `ws_apps/example-python` enforces 100 percent pytest-cov coverage.
- `ws_apps/example-rust` enforces 100 percent line, function, and region
  coverage through `cargo llvm-cov`.
- `harness/doc-validator` and `harness/versioning` enforce measured Rust
  floors below 100 percent while excluding CLI shell entrypoints.
- `harness/stack` produces a Vitest coverage report but has no threshold yet.
- `ws_packages/telemetry` is tested and typechecked, but does not yet enforce
  coverage thresholds.
- `harness/sensors` is gated by syntax checks, focused script tests, and the
  sensors gate, not by a package-local coverage threshold.

## Decision

Keep high, mechanically enforced coverage gates where the template has a
declared threshold, and make every ungated or lower-threshold surface explicit.
Threshold lowering requires an ADR update plus a measured reason. New Vitest
apps under `ws_apps/*` must opt in to the per-app 100 percent unit coverage
policy documented in `docs/sensors/coverage-and-gate.md`.

## Consequences

The template prevents normalized coverage drift on its declared protected
surfaces, but coverage is still a floor rather than a correctness proof.
Ungated or report-only surfaces remain visible policy debt rather than implied
exceptions.

## Details

The policy cites harness-engineering principles 1, measured not assumed, and
5, eat our own dogfood. The coverage gates are part of pre-push and CI-ready
local recipes, not comments that agents must remember.

## Policy as of 2026-06-04

| Surface | Recipe or config | Threshold | Enforcement |
|---|---|---|---|
| Root scripts | `vitest.config.ts`; `pnpm exec vitest run scripts/tests --coverage` | 100 lines, branches, functions, statements | `pnpm test:coverage`; pre-push `cov-ts` |
| TypeScript example app | `ws_apps/example-typescript/vitest.config.ts`; `pnpm --dir ws_apps/example-typescript exec vitest run --coverage --exclude tests/integration/**` | 100 lines, branches, functions, statements | `pnpm test:coverage`; pre-push `cov-ts` |
| Inspector slot | `harness/inspector/vitest.config.ts`; `pnpm --dir harness/inspector exec vitest run --coverage` | 100 lines, branches, functions, statements | `pnpm test:coverage`; pre-push `cov-ts` |
| Stack slot | `harness/stack/vitest.config.ts`; `pnpm --dir harness/stack exec vitest run --coverage` | Report-only, no threshold | `pnpm test:coverage`; pre-push `cov-ts` |
| Python example app | `ws_apps/example-python/pyproject.toml`; `just cov-py` | 100 total coverage with branch coverage enabled | pre-push `cov-py`; package `test` |
| Rust example app | `just cov-example-rust` | 100 lines, functions, regions | `just cov-rust`; pre-push `cov-rust` |
| Doc-validator slot | `just cov-doc-validator` | 82 lines, 94 functions | `just cov-rust`; pre-push `cov-rust` |
| Versioning slot | `just cov-versioning` | 87 lines, 86 functions | `just cov-rust`; pre-push `cov-rust` |

`pnpm test:coverage` is the TypeScript umbrella. It runs root scripts,
`ws_apps/example-typescript`, `harness/stack`, and `harness/inspector`.
`just cov-rust` is the Rust umbrella. It runs the Rust example,
doc-validator, and versioning gates.

## What this protects against

- **Coverage drift**: adding new code without tests silently dropping
  the aggregate. The gate fails the commit (or the push, via lefthook).
- **Broken-window normalization**: "we are close enough" becoming a routine
  reason to lower a threshold. Every lower-than-100 threshold is listed here.
- **Refactor regression**: when refactoring covered code, tests are
  part of the contract; missing tests fail the gate.

## What it does NOT protect against

High coverage doesn't prove correctness. A line can run without being
asserted on. Treat the report as a list of risks, not a grade.
Coverage is a floor, not a ceiling. Mutation testing is the planned
follow-up and is out of scope for this ADR.

## Opt-out mechanism (THE auditable list)

Genuinely untestable lines may be opted out with explicit rationale
comments. Each opt-out is enumerated below. If a new one is needed,
add it to this table first, then add the comment in code.

### Accepted exclusions and report-only surfaces

| Surface | Mechanism | Rationale |
|---|---|---|
| `ws_apps/example-typescript/tests/integration/**` | Excluded from the coverage command in `scripts/test-coverage.ts` | Integration tests spawn subprocesses and prove CLI boundaries. Unit coverage remains 100 percent over `src/**/*.ts`. |
| `ws_apps/example-python/tests/integration` | Ignored in `pyproject.toml` pytest addopts | Subprocess coverage is not merged. Unit coverage remains 100 percent over `example_python`. |
| `harness/doc-validator/src/main.rs` | `--ignore-filename-regex 'main\.rs'` in `just cov-doc-validator` | CLI shell. Business logic lives in `lib.rs` and modules. |
| `harness/versioning/src/main.rs` | `--ignore-filename-regex 'main\.rs'` in `just cov-versioning` | CLI shell. Business logic lives in `lib.rs`. |
| `harness/stack` | Coverage report with no threshold | Real tests exist, but no ratcheted coverage floor has landed yet. Treat as policy debt, not a protected exemption. |
| `ws_packages/telemetry` | `vitest run` without coverage threshold | Shared telemetry package is tested and typechecked but not yet a coverage-gated surface. Treat as policy debt. |
| `harness/sensors` | Package syntax checks plus sensor/gate tests outside package coverage | Sensors are guarded by focused tests and `just sensors gate`. A package-local coverage threshold is not declared. |
| `harness/stack/rust-stub` | Listed under root `Cargo.toml` `excluded_surfaces` | Stub crate is not part of the current Rust coverage gate. |

### Not current template surfaces

The previous imported lab record described lab application services and Rust
sensors adapter internals that are not part of this template's current
coverage surface. If a lab service or Rust sensors crate is ported into the
template, this ADR must be updated in the same change that wires its coverage
gate.

## What's next

1. Add a threshold to `harness/stack/vitest.config.ts` once the current
   measured floor is intentionally ratcheted.
2. Add a coverage gate for `ws_packages/telemetry`, or record why shared
   telemetry remains a tested-but-ungated package.
3. Decide whether `harness/sensors` needs a package-local coverage gate in
   addition to the architectural sensors gate.
4. Keep `docs/sensors/coverage-and-gate.md` as the per-app policy source for
   new Vitest apps.

## When to Update This Doc

- A new opt-out is added. Append a row to the audit table before the code
  change.
- A language tool is replaced, such as Vitest, pytest-cov, or cargo-llvm-cov.
  Re-evaluate the threshold mechanism.
- A report-only surface becomes enforced.
- A new `ws_apps/*` Vitest app lands.
- A new `ws_packages/*` package is promoted to a shared package with a
  coverage gate.

## Sources

- [Rust testability survey (alastairreid.github.io)](https://alastairreid.github.io/rust-testability/)
- [pytest-cov on PyPI](https://pypi.org/project/pytest-cov/)
- [Scientific Python coverage guide](https://learn.scientific-python.org/development/guides/coverage/)
- [Mocking in Rust + alternatives (LogRocket)](https://blog.logrocket.com/mocking-rust-mockall-alternatives/)
