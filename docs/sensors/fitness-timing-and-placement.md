---
name: "Fitness-function timing and placement"
description: "Wall-clock budget of every fitness function, the discipline rule per tier, and the rationale behind the CI-only placement of the full sensors gate."
---

# Fitness-function timing and placement

This page records the wall-clock budget of every fitness function the
template enforces, and the discipline behind which feedback point each
one fires at (pre-commit, pre-push, CI). It is the operator-facing
companion to [ADR-0020](../adrs/ADR-0020-architectural-fitness-ratchet.md)
(the upward ratchet) and [ADR-0021](../adrs/ADR-0021-formatter-slot.md)
(the formatter slot).

The numbers below are point measurements on the VPS reference host
(2026-06-10, branch `feat/fitness-fast-feedback`). They are not
guaranteed reproducible across hosts; treat them as **order-of-magnitude
budgets**, not contract floors. The placement decisions are.

## Placement discipline

Three buckets, three feedback points, one rule per bucket:

| Bucket  | Tolerated budget        | Feedback point                  | Discipline rule |
|---------|-------------------------|---------------------------------|-----------------|
| Instant | < 2 s per gate          | `lefthook` pre-commit           | Hard-enforce; auto-fix when possible (`stage_fixed: true`). |
| Medium  | 2 – 30 s per gate       | `lefthook` pre-push             | Hard-enforce; soft-skip when local toolchain is missing so first-clone pushes still work. |
| Slow    | > 30 s per gate         | `.github/workflows/test.yml`    | Hard-enforce in CI only; operators can invoke locally on demand (`just sensors gate`, `just cov-rust`). |

Two gates that straddle the medium / slow boundary (`cov-ts`, `cov-rust`)
stay in pre-push because pnpm and cargo cache aggressively — the cold
run is ~80 s / ~55 s, but the warm run on a touched module is ~5 s. CI
runs them again on a clean checkout as the canonical authority.

## Measured wall-clock (single shot, 2026-06-10)

`bin/sensors gate` is the heaviest single gate. The breakdown below is
the data behind moving it to CI-only.

| Stage                                          | Wall-clock | Notes |
|------------------------------------------------|-----------:|-------|
| `npx dependency-cruiser` (workspace scope)     |     ~85 s  | First run installs into `~/.npm`; subsequent runs warm. |
| `apss code-topology analyze` (via `--produce`) |      5.7 s | Pure-Rust producer; writes `.topology/metrics/*.json`. |
| `apss_topology.mjs --no-produce` (adapter)     |     0.11 s | Reads the cached `.topology/` snapshot. |
| `gate.mjs` (comparator, reads report from stdin) |    0.15 s | Pure JSON-in / JSON-out; no IO past the baseline. |
| `harness/sensors/bin/sensors gate` (end-to-end) |   ~108 s  | Cruiser dominates. |

All other gates are O(seconds) or less:

| Gate                                | Wall-clock | Placement | Rationale |
|-------------------------------------|-----------:|-----------|-----------|
| `secret-scan` (gitleaks --staged)   |     <0.1 s | pre-commit | Always-instant. |
| `biome-format-lint` (staged set)    |       1.4 s | pre-commit | Auto-fix + `stage_fixed: true`. |
| `python-ruff-format` (staged set)   |       0.5 s | pre-commit | Auto-fix + `stage_fixed: true` (formatter slot). |
| `python-ruff` (lint, staged)        |       0.3 s | pre-commit | Lint-only; failure means broken syntax. |
| `python-mypy` (strict)              |       0.4 s | pre-commit | Strict type-check on ws_apps/example-python/src. |
| `ubs-staged`                        |       0.1 s | pre-commit | UBS quick scan of staged files. |
| `doc-validator-apss`                |       0.3 s | pre-commit + pre-push | APSS APS-V1-0003 hard-enforce. |
| `doc-validator` (full repo)         |       1.3 s | pre-commit + pre-push | Rust crate; checks links + manifest + ADR shape. |
| `perf-gate` (startup-time fitness)  |       0.3 s | pre-push | Soft-skips when `hyperfine` is missing. |
| `cov-py` (pytest --cov 100%)        |       1.4 s | pre-push | Tiny example app; near-instant. |
| `versioning-release-check`          |       0.7 s | pre-push | `just release-check`; soft-skips when cargo/bun/just missing. |
| `typecheck-affected` (pnpm turbo)   |    2 – 15 s | pre-push | Turbo filter scopes to changed packages. |
| `test-affected` (pnpm turbo)        |    2 – 28 s | pre-push | Same turbo filter. |
| `ubs-diff` (vs upstream/main)       |    1 – 23 s | pre-push | Cold run touches every changed file. |
| `cov-rust` (cargo llvm-cov)         |   30 – 55 s | pre-push (cached) + CI | CI is the authority. |
| `cov-ts` (vitest --coverage)        |   68 – 80 s | pre-push (cached) + CI | CI is the authority. |
| `sensors-gate` (full ratchet)       |     ~108 s  | CI ONLY    | Was pre-push; removed because parallel races on `.topology/`. |

## Why `sensors-gate` moved to CI-only

The full sensors gate took ~108 s wall-clock AND failed
non-deterministically under `lefthook run pre-push` with
`parallel: true`. The failure mode:

```
ws_apps/example-typescript/src  I: 0.250 -> 0.333  (+0.083)
ws_apps/example-typescript/src  D: 0.250 -> 0.333  (+0.083)
MD01 instability-out-of-range-count: 4.000 -> 8.000 (+4.000)
```

The same gate run standalone (`harness/sensors/bin/sensors gate`)
consistently passed. The root cause was that `pnpm turbo run typecheck`,
`pnpm test:coverage`, and the APSS topology producer all mutate state
under `ws_apps/example-typescript/` and `.topology/` concurrently — when
the gate sampled mid-write, the per-folder Martin readings reflected a
transient hybrid.

The fix preserves the gate as the canonical ratchet authority by moving
it to a serial CI job (`.github/workflows/test.yml → fitness`) that runs
on a clean checkout with no concurrent build pressure. Operators can
still invoke locally on demand:

```sh
just sensors gate                   # full ratchet, ~108 s
just sensors gate --update-baseline # deliberate floor relax (audit trail)
RATCHET=off just sensors gate       # dry-run comparator, no rewrite
```

## Formatter slot

The formatter slot (ADR-0021) is a hard-enforced pre-commit auto-fix:
it runs `biome check --write` against the staged JS/TS/JSON/CSS/MD/YAML
set and `ruff format` against the staged Python set, then re-stages the
rewrites via lefthook's `stage_fixed: true`. The recorded commit always
passes the same formatter check, so a `pre-push` re-run would be
redundant and a CI sweep is only needed when a fork adds a new package.

Forks that swap formatters (Prettier instead of Biome, Black instead of
Ruff) update one slot block in `harness.manifest.json` and one lefthook
command; everything else (CI, the ratchet, fork-readiness tooling)
treats the formatter as an opaque box.

## References

- [ADR-0020-architectural-fitness-ratchet.md](../adrs/ADR-0020-architectural-fitness-ratchet.md) — the ratchet contract.
- [ADR-0021-formatter-slot.md](../adrs/ADR-0021-formatter-slot.md) — the formatter slot.
- [coverage-and-gate.md](./coverage-and-gate.md) — per-app coverage policy + the sensors gate verdict format.
- [closed-loop.md](./closed-loop.md) — the APSS topology producer -> sensors adapter -> fitness gate pipeline.
- `lefthook.yml` — the actual hook wiring referenced above.
- `.github/workflows/test.yml` — the CI authority for the slow gates.
