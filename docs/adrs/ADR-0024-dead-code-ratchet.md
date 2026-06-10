---
name: "Dead-Code Ratchet"
description: "Add a knip-based unused-export / unused-file / unused-type ratchet to the sensors gate; floor auto-tightens on improvement, fails on regression. The 'no broken windows' rot gate."
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

A static analyzer that walks the workspace import graph and surfaces
the unused tail closes that loop. Knip is the modern choice for the
TS / JS lane (oxc-backed since v6, March 2026; see
[knip.dev/blog/knip-v6](https://knip.dev/blog/knip-v6)) and reads
unused **files**, **exports**, and **types** rather than only
exports — the larger surface for AI-introduced rot. ts-prune is the
legacy fallback but only sees exports, so this ADR pins knip.

## Decision

Add an MT01 metric `unused-export-count` to
[`harness/sensors/baseline.json`](../../harness/sensors/baseline.json):

| Field | Value |
|---|---|
| dimension | `MT01` (Maintainability) |
| direction | `max` (smaller is better; ratchet tightens toward 0) |
| `fail_on_regression` | `true` |
| baseline | current count from a clean scan (`2` at landing time) |
| reading source | `harness/sensors/deadcode_scan.mjs` envelope |
| flow into gate | `--deadcode=<path>` flag on `harness/sensors/gate.mjs` |

The adapter
([`harness/sensors/deadcode_scan.mjs`](../../harness/sensors/deadcode_scan.mjs))
spawns `npx --yes knip@<pinned> --reporter json
--no-progress --include files,exports,types --workspace <each ws_apps/* and
ws_packages/*>` and rolls every entry's `files` / `exports` /
`types` array length into one `total_unused` integer. Other knip
issue categories (`unlisted`, `unresolved`, `duplicates`,
`enumMembers`, etc.) are dependency-hygiene concerns and are NOT
counted here — they belong in a separate metric if surfaced at all.

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
   degrades the gate to "no reading" rather than a false zero so a
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

- **Code rot now fails CI.** A PR that lands a new orphaned export
  in `ws_apps/*` or `ws_packages/*` flips the ratchet — the gate
  exits non-zero and auto-merge stalls. Same mechanical guarantee
  that the complexity ratchet gives for `max-cognitive`.
- **Floor auto-tightens.** When a refactor reduces the unused count,
  `just sensors gate --update-baseline` (or the CI workflow's same
  invocation) rewrites the baseline at the new lower number.
  Atomic-baseline discipline carries over — there is no path to
  silently lower the floor without an audited edit to
  `baseline.json`.
- **Network dependency at gate time.** Knip is invoked via `npx
  --yes`, which downloads the package on first run. The pin is in
  `harness/sensors/deadcode_scan.mjs`
  (`KNIP_VERSION = "6.16.1"`). On an air-gapped runner the adapter
  soft-skips (envelope sets `available: false`) and the gate
  reports `unused-export-count` as no-reading — the gate does not
  fail closed on a missing scanner. Forks that need fail-closed
  semantics here should preinstall knip into `node_modules` and
  swap the spawn path.
- **False positives are absorbed into the floor.** The starting
  baseline of `2` reflects two fumadocs framework convention files
  in `ws_apps/docs` that knip cannot statically detect as referenced
  by Next.js. The ratchet floor sits at the current real count, so
  the gate fails the moment a new unused export lands rather than
  the moment any unused export exists. Fork operators who want a
  lower floor can add a `knip.json` (or per-workspace `knip.json`)
  with `ignore` / `entry` overrides for their framework conventions
  and re-run `just sensors gate --update-baseline`.
- **Scope is `ws_apps/*` and `ws_packages/*`.** This matches the
  canonical workspace filter used by
  [`harness/sensors/complexity.mjs`](../../harness/sensors/complexity.mjs)
  and `abstractness.mjs`. Tool code (`scripts/`, `harness/`) is not
  scanned, because those entry points are invoked from the
  `justfile` and look unused to a static analyzer — covering them
  would re-introduce the false-positive class without adding
  signal.

## Details

### Why count files + exports + types

A single integer keeps the ratchet authority unambiguous. The
adapter envelope still exposes the per-category breakdown
(`unused_files`, `unused_exports`, `unused_types`) so a fork can
add a tighter sub-metric without changing the contract — same shape
as the sentrux envelope exposing every sub-score even though only
one composite signal feeds the ratchet today.

### Why not a `knip.json` config at root

Knip auto-discovers entry points from each workspace package's
`package.json` (`main`, `bin`, `exports`). The two false positives
in `ws_apps/docs` would require a fumadocs-specific
`ignore` list that an upstream template shouldn't dictate to forks.
The ratchet handles this gracefully via the starting baseline. If a
future workspace package routinely tripped knip and the baseline
floor crept up to mask a real regression, this decision should be
revisited and a curated `knip.json` added — but not until then.

### When to re-evaluate

- If knip is replaced by an oxc-native binary that does not need
  `npx`, swap the spawn path and drop the soft-skip
  documentation. The contract stays.
- If a fork's primary workspace is non-TS / non-JS, this dimension
  reports `total_unused: 0` over no workspaces and never fires.
  Such forks can either remove the entry from `baseline.json` or
  port a lane-appropriate adapter (`vulture` for Python, `cargo
  machete` for Rust) behind the same envelope shape.

## Self-validation

The sensor's self-validation is the test suite at
[`harness/sensors/tests/deadcode.test.mjs`](../../harness/sensors/tests/deadcode.test.mjs)
(12 tests), which exercises the FAIL-on-synthetic-regression and
PASS-on-clean paths end-to-end against `gate.mjs main()`.
Specifically:

- `deadcode: main() with --deadcode flag — regression fails and
  leaves floor untouched` — proves a regression is mechanically
  detected and the baseline is not rewritten.
- `deadcode: main() with --deadcode flag tightens baseline.json on
  improvement` — proves the floor tightens atomically on
  improvement.
- The adapter-level tests (`summarizeKnipPayload`,
  `runDeadcodeScan`) prove the soft-skip / malformed-input contract
  without needing a live knip install.

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
