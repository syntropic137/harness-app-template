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

## Decision

Keep high, mechanically enforced coverage gates per stack and treat threshold lowering as an experiment-backed exception, not a routine config tweak.

## Consequences

The template prevents normalized coverage drift but must still treat coverage as a floor rather than a correctness proof. Untestable lines require explicit rationale.

## Details

> Mechanically enforced coverage thresholds across all three language
> stacks. **No silent threshold lowering.** Every opt-out is enumerated
> below with explicit rationale. Per CLAUDE.md feedback memory: "we
> should be 100%, not 90%, remember?" — TypeScript and Python achieved
> that bar in this cycle; Rust landed at 95/94 with the residual gap
> captured as a follow-up rather than papered over.
>
> Cites harness-engineering principles 1 (**measured, not assumed** —
> every threshold has a measured baseline and a tracked refactor path)
> and 5 (**eat-our-own-dogfood** — the lab holds these gates before
> shipping the recipe to consumers).

## Policy (as of v0.7.1)

| Stack | Recipe | Threshold | Measured |
|---|---|---|---|
| Rust | `just cov-rust` | **95 lines / 94 functions** (workspace, excludes `apps/api-rust`) | 95.82 / 94.80 |
| TypeScript | `just cov-ts` | **100 / 100 / 100 / 100** (lines/functions/branches/statements) | 100 / 100 / 100 / 100 |
| Python | `just cov-py` | **100 lines / 100 branches** (`apps/api-py`) | 100 / 100 |

Per-crate Rust gates (`cov-doc-validator`, `cov-versioning`) sit at
100/100; the looser 95/94 is only the **workspace aggregate** and the
per-crate `cov-sensors` gate. The gap is fully owned by
`harness-sensors` and is documented under "What's next" below.

## What this protects against

- **Coverage drift** — adding new code without tests silently dropping
  the aggregate. The gate fails the commit (or the push, via lefthook).
- **Broken-window normalization** — "we're at 95% which is close
  enough" becomes "we're at 80% which is close enough." Every
  threshold here was raised to its measured baseline +1 and is
  one-way ratchet: lowering it requires a verdict-backed experiment,
  not a config tweak.
- **Refactor regression** — when refactoring covered code, tests are
  part of the contract; missing tests fail the gate.

## What it does NOT protect against

High coverage doesn't prove correctness. A line can run without being
asserted on. Treat the report as a list of risks, not a grade.
Coverage is a floor, not a ceiling. Mutation testing is the planned
follow-up (out of scope for v0.7.1 — see plan §"Out of scope").

## Opt-out mechanism (THE auditable list)

Genuinely untestable lines may be opted out with explicit rationale
comments. Each opt-out is enumerated below — if a new one is needed,
**add it to this table first**, then add the comment in code.

### Rust opt-outs

Two flavours: file-level regex exclusions in the `just` recipes, and
the untested-by-design subprocess bootstrap paths inside
`harness-sensors`.

| File | Line / range | Mechanism | Rationale |
|---|---|---|---|
| `harness/sensors/src/bin/harness_sensors.rs` | full file | `--ignore-filename-regex 'bin/harness_sensors\.rs'` in `cov-sensors` recipe | 8-line CLI shell, no business logic. All logic in `cli.rs` (covered). |
| `harness/doc-validator/src/main.rs` | full file | `--ignore-filename-regex 'main\.rs'` in `cov-doc-validator` recipe | 8-line CLI shell, no business logic. All logic in `lib.rs` (100% covered). |
| `harness/versioning/src/main.rs` | full file | `--ignore-filename-regex 'main\.rs'` in `cov-versioning` recipe | Same as above. |
| `apps/api-rust` crate | full crate | `--workspace --exclude api-rust` in `cov-rust` | Test fixture service. Not part of the harness gate target. |
| `harness/sensors/src/adapters/grimp_instability.rs` — `ensure_venv()` `pip install` body | ~lines 160-220 | Not tested in-process; reachable only on first run when `.venv-grimp/` is absent. Covered indirectly by Phase D smoke. | First-run subprocess; covering it would require fixturing a missing venv + a real `pip install`. Captured as v0.7.2 TODO. |
| `harness/sensors/src/adapters/ts_morph_abstractness.rs` — `ensure_node_modules()` `npm install` body | ~lines 171-230 | Same. | Same first-run rationale; v0.7.2 TODO. |
| Error-path `.with_context()` closures across sensor adapters | scattered | Not opted out via attribute; counted toward residual gap | Only fire when underlying tool exits non-zero (npx dep-cruiser failure, sentrux `--version` failure, etc.). Real fixtures land in v0.7.2. |
| Test-body `panic!()` branches in `FakeSensor` helpers | scattered (test code) | Inherent | Correct-by-design unreachable paths inside test doubles. |

**Net effect on `cov-sensors`:** measured 95.81% lines / 94.58% functions.
Workspace `cov-rust` measures 95.82% / 94.80%. Threshold is set
**at measured floor**, not measured + 1, to leave zero slack for drift.

### TypeScript opt-outs

All 9 entries are tagged `Phase E audit` in this list — every
`c8 ignore` directive across the source tree is enumerated.

| File | Line / range | Mechanism | Rationale |
|---|---|---|---|
| `packages/telemetry/src/node.ts` | full file | `/* c8 ignore file */` | SDK bootstrap: instantiates NodeSDK + OTLP exporters. Side-effects only at process start. Integration-tested via running stack, not unit tests. |
| `packages/telemetry/src/web.ts` | full file | `/* c8 ignore file */` | SDK bootstrap: builds WebTracerProvider + OTLP exporter. Same rationale. |
| `packages/telemetry/src/resource.ts` | line 12 + lines 15-18 | `/* c8 ignore next */` / `start..stop` | Node `os.hostname()` fallback + alt-resource block: alternate-platform branches. |
| `packages/telemetry/src/resource.ts` | lines 20-32 | `/* c8 ignore start..stop */` | Vite browser context block; unreachable in Node-only unit tests. |
| `apps/api/src/server.ts` | lines 26-32 | `/* c8 ignore start..stop */` | `wireDbStore` Postgres bootstrap branch; requires live DB to exercise. |
| `apps/api/src/server.ts` | lines 42-56 | `/* c8 ignore start..stop */` | `runMigrations` DB-bootstrap path; requires live Postgres. |
| `apps/api/src/db.ts` | lines 12-19 | `/* c8 ignore start..stop */` | `runMigrations` needs a live Postgres + packaged migrations dir. |
| `apps/web/src/components/TaskBoard.tsx` | line 9 + lines 57-61 | `/* c8 ignore next 2 */` / `start..stop` | `BUG_LAYOUT_BREAK` build-time toggle hard-coded `false` in unit tests; production-only flag path. |
| `harness/stack/src/runtime/exec.ts` | lines 21-45 (4 directives) | `/* c8 ignore next */` x4 | Defensive optional-chains (`spawn` failure pre-listener-attach, `code ?? 1` signal-exit fallback) — only fire on OS-level spawn failures. |
| `harness/stack/src/runtime/isolation.ts` | lines 46-52 | `/* c8 ignore start..stop */` | Empty-repo branch: defensive fallback when prior git operations leave repo in a totally-empty state. |

(9 logical opt-outs across the listed files; expanded directives shown
for full audit.)

### Python opt-outs

**None.** `apps/api-py` reached 100/100 with zero `# pragma: no cover`
annotations in source. The pyproject.toml `[tool.coverage.report]
exclude_lines` list accepts the standard `pragma: no cover` token but
no source line currently uses it.

| File | Line / range | Mechanism | Rationale |
|---|---|---|---|
| — | — | — | (empty by design) |

## What's next (v0.7.2 follow-up)

The Rust 4-5pp gap (vs. the aspirational 100/100 in the v0.7.1 plan)
is **owned and captured**, not deferred indefinitely:

1. **`ensure_venv()` / `ensure_node_modules()` subprocess paths** —
   refactor into a `Bootstrapper` trait + fake implementations so the
   `pip install` / `npm install` arms can be exercised without a live
   network. Likely lifts `cov-sensors` to ~98% lines.
2. **Error-context closures across adapters** — fixture a
   "broken-tool" mode (dep-cruiser exits 2, sentrux missing, etc.)
   through the existing `CommandRunner` trait (added in this cycle).
   Likely lifts the remaining ~2pp.
3. After (1) + (2), re-run `cov-sensors` and ratchet `cov-rust` to
   100/100 in a v0.7.2 commit. The decision doc gains a row in the
   "Rust opt-outs" table noting the bootstrappers are now mocked.

Tracked in your project's next-steps breadcrumb (whatever convention your fork uses).

## When to update this doc

- A new opt-out is added — **append a row to the audit table BEFORE
  the code change**.
- A language tool is replaced (e.g., vitest → some successor) —
  re-evaluate the threshold mechanism.
- The "100% is impractical for X" argument arises — STOP. Refactor to
  make X testable; don't lower the threshold. The 95/94 Rust floor
  exists because the refactor is **scheduled**, not because the bar
  was negotiated down.

## Sources

- [Rust testability survey (alastairreid.github.io)](https://alastairreid.github.io/rust-testability/)
- [pytest-cov on PyPI](https://pypi.org/project/pytest-cov/)
- [Scientific Python coverage guide](https://learn.scientific-python.org/development/guides/coverage/)
- [Mocking in Rust + alternatives (LogRocket)](https://blog.logrocket.com/mocking-rust-mockall-alternatives/)
