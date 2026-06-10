---
name: "Dead-Code Ratchet"
description: "Add a deterministic unused-export ratchet to the sensors gate using a pure-source scoped grep over ws_apps/<app>/src and ws_packages/<pkg>/src. Floor auto-tightens on improvement, fails on regression. The 'no broken windows' rot gate."
status: accepted
---

# ADR-0024: Dead-Code Ratchet

**Date:** 2026-06-10
**Category:** Slot (sensors)
**Supersedes:** none (extends [ADR-0019](./ADR-0019-closed-loop-architectural-quality.md) / [ADR-0020](./ADR-0020-architectural-fitness-ratchet.md) with a new dimension reading)
**Next review:** 2026-12-10

## Context

The sensors slot already ratchets on cognitive complexity, cyclomatic
complexity, coupling, main-sequence distance, circular edges, sentrux
composite signals, security findings, and licenses. None of those
catch the rot mode that dominates AI-coding workflows: orphaned
exports, dead files, and unused type aliases left behind when an
agent refactors a callsite but skips the producer-side cleanup. The
code still compiles, the tests still pass, and the floor never moves.

The first draft of this ADR specified knip 6.16.1 as the detector.
That detector failed the determinism property the ratchet model
requires:

- Developer machine: `total_unused = 2`.
- GitHub Actions `workspace qa (ubuntu-latest)`: `total_unused = 3`.
- GitHub Actions `workspace qa (macos-latest)`: `total_unused = 3`.

Same knip version (6.16.1 pinned via `npx --yes`), same
`pnpm install --no-frozen-lockfile`, same source tree, three
different readings. The variance came from knip's auto-discovery of
workspace entry points, which depends on the exact node_modules
layout pnpm produces in a given cache state, which in turn varies
with the runner's cached pnpm store. A ratchet floor on a metric
that drifts between environments fails open or closed at random and
poisons the entire fitness gate's signal.

## Decision

Replace the spawn-knip-from-npx design with a deterministic
scoped-grep detector at
[`harness/sensors/deadcode_scan.mjs`](../../harness/sensors/deadcode_scan.mjs)
that:

1. Walks a fixed set of source globs: `ws_apps/<app>/src/**/*.{ts,tsx}`
   and `ws_packages/<pkg>/src/**/*.{ts,tsx}`. The walk skips
   `node_modules`, `.next`, `dist`, `build`, `target`, `.venv`,
   `__pycache__`, `coverage`, and `.cache` deterministically.
2. Skips a small fixed list of files that frameworks load by
   convention (`mdx-components.tsx`, `source.config.ts`,
   `layout.shared.tsx`, `middleware.ts`, `instrumentation.ts`) plus
   every file under any `app/` path segment (Next.js App Router).
3. Parses each source file with a single fixed regex that captures
   the identifier from `export <kind> <name>` (const, function,
   async function, class, interface, type, enum, let, var). Default
   exports and `export { renamed } from '...'` re-exports are
   intentionally excluded; both are framework-loaded or
   transparently consumed and would produce noise the floor cannot
   distinguish from real regressions.
4. For each captured identifier, scans the reference corpus (every
   `.ts` / `.tsx` file under `ws_apps/**` and `ws_packages/**`,
   excluding the same skip list) for whole-word occurrences of the
   identifier in any file other than the one defining it.
5. Counts identifiers with zero external references as the metric.
6. Adds an MT01 metric `unused-export-count` to
   [`harness/sensors/baseline.json`](../../harness/sensors/baseline.json):

   | Field | Value |
   |---|---|
   | dimension | `MT01` (Maintainability) |
   | direction | `max` (smaller is better; ratchet tightens toward 0) |
   | `fail_on_regression` | `true` |
   | baseline | current deterministic count (`14` at landing time) |
   | reading source | `harness/sensors/deadcode_scan.mjs` envelope |
   | flow into gate | `--deadcode=<path>` flag on `harness/sensors/gate.mjs` |

The wiring mirrors the SC01 / LG01 / sentrux contracts that already
exist on the gate:

1. [`harness/sensors/bin/sensors`](../../harness/sensors/bin/sensors)
   runs `deadcode_scan.mjs` after `license_scan.mjs` /
   `sentrux_scan.mjs` and writes the envelope to a tempfile.
2. The tempfile is passed to
   [`harness/sensors/gate.mjs`](../../harness/sensors/gate.mjs) and
   [`harness/sensors/fitness_report.mjs`](../../harness/sensors/fitness_report.mjs)
   via `--deadcode=<path>`.
3. The reader function returns `null` when the envelope is missing,
   reports `available: false`, or has a non-numeric metric. `null`
   degrades the gate to "no reading" rather than a false zero, so a
   broken scanner cannot silently pass a CI run.

The metric runs at the **CI tier** (`fitness` job in
`.github/workflows/test.yml`) alongside the rest of the
sensors-gate. The full pipeline was moved out of pre-push by
[ADR-0020](./ADR-0020-architectural-fitness-ratchet.md) /
[ADR-0019](./ADR-0019-closed-loop-architectural-quality.md) on
wall-clock + race grounds; this ADR does not relitigate that
placement. The pre-push tier sees only the read-only summary line
through `just fitness --quick --format=summary`.

## Consequences

- **Code rot now fails CI.** A PR that lands a new orphaned
  identifier in `ws_apps/<app>/src/` or `ws_packages/<pkg>/src/`
  flips the ratchet — the gate exits non-zero and auto-merge stalls.
  Same mechanical guarantee that the complexity ratchet gives for
  `max-cognitive`.
- **Same input → same output.** The detector reads zero external
  state (no node_modules, no network, no npx) and walks a fixed
  source tree with sorted iteration. Three back-to-back runs and a
  with-vs-without-`node_modules` cross-check all produce the
  identical count. The cross-environment variance that killed the
  knip design is structurally impossible here.
- **Floor auto-tightens.** When a refactor reduces the unused count,
  `just sensors gate --update-baseline` (or the CI workflow's same
  invocation) rewrites the baseline at the new lower number.
  Atomic-baseline discipline carries over; there is no path to
  silently lower the floor without an audited edit to
  `baseline.json`.
- **False positives are absorbed into the floor.** The starting
  baseline of `14` reflects identifiers that are exported from
  workspace source modules but never imported by another workspace
  file at this snapshot. Most are public-API shapes
  (`HelloMessage`, `WebTelemetryConfigOpts`, etc.) intentionally
  exposed for downstream consumers that the template does not
  contain. Fork operators who delete or wire up those consumers see
  the ratchet tighten automatically; operators who introduce a new
  orphan see the gate fail until either the consumer is added or
  the export is deleted.
- **Scope is `ws_apps/<app>/src/` and `ws_packages/<pkg>/src/`.**
  This matches the canonical workspace-source filter used by
  [`harness/sensors/complexity.mjs`](../../harness/sensors/complexity.mjs)
  and `abstractness.mjs`. Tool code (`scripts/`, `harness/`) is not
  scanned because those entry points are invoked from the
  `justfile` or another tool wrapper and look unused to a static
  analyzer.
- **The detector under-counts rather than over-counts.** A
  whole-word grep treats every identifier match as a reference,
  including parameter names, type names, and string literals that
  happen to coincide with an export name. That makes the metric
  conservative: real dead exports may slip through as "used" by a
  coincidental name collision, but live exports never falsely flag
  as dead. For a regression-only ratchet the conservative direction
  is the safe one — false positives on a "lower-is-better" floor
  would block legitimate PRs.

## Details

### Why not knip

The decision to abandon knip was driven by a concrete CI failure on
PR #27 of the harness-app-template repository: the same knip
6.16.1 binary, pinned via `npx --yes` and invoked with identical
arguments, produced `total_unused = 2` on the developer's machine
and `total_unused = 3` on every GitHub Actions runner with
`pnpm install --no-frozen-lockfile` applied. Adding `pnpm install`
to the `fitness` CI job did not close the gap. The 3rd phantom
unused entry came from knip's auto-discovery of the docs workspace
entry points, which resolves differently on fresh pnpm caches than
on a developer's repeatedly-installed pnpm store. ts-prune and
other npx-spawned detectors all have the same class of
non-determinism (they read whatever the package manager left them).

The deterministic-grep detector is strictly less capable than knip
(it cannot resolve dynamic imports, cannot follow re-exports across
files, cannot detect unused files that are imported only by their
own tests). It is, however, the only design that holds the ratchet
contract: same input always yields the same count.

### Why exclude default exports and `export { renamed } from`

A default export has no stable identifier — `export default ...`
is consumed by `import Foo from '...'` where `Foo` is named at the
import site. A whole-word grep cannot prove the lack of a
reference. A `export { renamed } from '...'` line is a transparent
re-export; the named symbol is defined in another file and is
already covered there. Including either category would either
inflate the count with noise (default exports) or double-count real
findings (re-exports).

### Why include tests in the reference corpus

Tests are the most reliable signal that a public-API export is in
use even when the runtime callers do not exist yet. Counting tests
as referrers is conservative: it keeps a function exported by a
library and exercised by a unit test out of the "dead" bucket even
if no other workspace file imports it.

### When to re-evaluate

- If a future detector ships that holds the determinism contract
  (oxc-based, stamp-pinned via a committed binary, or
  vendor-installed at `node_modules/.bin/<tool>` from a frozen
  lockfile), this ADR's grep loop can be swapped behind the same
  envelope shape. The gate-side contract does not change.
- If a fork's primary workspace is non-TS / non-JS, this dimension
  reports `total_unused: 0` over no source files and never fires.
  Such forks can either remove the entry from `baseline.json` or
  port a lane-appropriate adapter (`vulture` for Python, `cargo
  machete` for Rust) behind the same envelope shape.

## Self-validation

The detector's self-validation is the test suite at
[`harness/sensors/tests/deadcode.test.mjs`](../../harness/sensors/tests/deadcode.test.mjs)
(18 tests). It exercises:

- `findExports` over every supported export shape, including the
  intentional exclusion of default exports and `export { renamed }`.
- `countReferences` whole-word semantics, including the corner
  cases that motivated the conservative-direction note above.
- `walkSourceTree` ignoring `node_modules`, `.next`, `dist`,
  `build`, `target`, dotfiles, and returning sorted output for
  determinism.
- `listExportSources` scoping to `ws_apps/<app>/src` and
  `ws_packages/<pkg>/src` only.
- `listReferenceCorpus` including tests and configs as referrers.
- `runDeadcodeScan` over an in-memory FS with hand-derivable
  expected counts, including the framework-convention exclusion
  and the soft-skip path when no workspace package exists.
- A explicit three-back-to-back-runs determinism regression.
- Gate integration: ratchet tightens on improvement, regression is
  flagged without moving the floor, absent envelope degrades to
  no-reading.
- End-to-end `main()` with `--deadcode`: improvement rewrites
  baseline atomically; regression exits 1 and leaves the floor
  untouched.

## Implementation pointers

- Adapter:
  [`harness/sensors/deadcode_scan.mjs`](../../harness/sensors/deadcode_scan.mjs)
- Metric reader: `deadcodeMetricValue` in
  [`harness/sensors/gate.mjs`](../../harness/sensors/gate.mjs)
- Wiring: `harness/sensors/bin/sensors gate` and `fitness`
  subcommands
- Tests:
  [`harness/sensors/tests/deadcode.test.mjs`](../../harness/sensors/tests/deadcode.test.mjs)
- Baseline:
  [`harness/sensors/baseline.json`](../../harness/sensors/baseline.json)
  (`dimensions.MT01.metrics.unused-export-count.baseline`)
