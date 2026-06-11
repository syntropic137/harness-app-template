---
name: "Profiling Slot"
description: "Harness-native profiling slot: backend API latency, frontend Core Web Vitals plus CDP traces, startup bench re-exposed; advisory by default with an opt-in per-signal perf-budget gate; OTEL trace-to-profile correlation; deliberately not an APSS dimension"
status: accepted
---

# ADR-0026: Profiling Slot

**Date:** 2026-06-11
**Category:** Slot
**Next review:** 2026-12-11
**Bead:** create-harness-app-z41

## Context

EXP-11 (profiling gap, lab repo) falsified the strict "no profiling at
all" prediction by surfacing `harness/perf/bench.sh` (hyperfine startup
bench) and `harness/perf/gate.mjs` (25 percent regression gate), and
confirmed everything else missing: no API latency profile, no frontend
perf capture, no flamegraph path, and the startup bench not exposed on
the justfile front door. The full slot design was reviewed as
`experiments/PROFILING-SLOT-DESIGN.md` in the lab repo; this ADR records
the decisions that landed.

## Decision

Add `profiling` as the 12th canonical slot at `harness/profiling/`,
with `just profile {startup|api|ui|summary|gate}` as the front door and
a thin `scripts/profiling.ts` wrapper honoring `harness.manifest.json`
plugin swaps (including `plugin: none`).

### Advisory by default, perf-budget gate by choice

Every run evaluates per-signal readings against the committed
`harness/profiling/baseline.json` and prints PASS / ADVISORY / FAIL per
signal. Without budgets the exit code is always 0. Copying
`budgets.example.toml` to `budgets.toml` opts individual signals into
hard gating via `gate = true` (baseline-regression gating with a
per-signal `tolerance`) or an absolute `budget` ceiling (a floor for
`direction = "higher"` signals such as throughput). The floor moves only
through `--update-baseline`, a reviewable git edit, mirroring the
sensors and perf ratchets.

### Slot input, not an APSS dimension

The slot composes the way the other harness-native slots do (sensors,
perf): CLI under `bin/`, committed baseline, justfile recipe, manifest
entry, doctor probe (`profilingIssues` in `scripts/doctor.ts` checks
manifest entry, entrypoint, and baseline shape). It is deliberately NOT
an APSS doc dimension: APSS gates documentation contracts, not perf
budgets.

### Backend path

`profile api` measures wall-clock latency p50/p95/p99/mean, throughput,
and error count against any HTTP endpoint. Per-language profiler
bindings:

| Lane | Tool | Artifact |
|---|---|---|
| Node / TS | `node --cpu-prof --cpu-prof-dir=DIR` + `--cpu-prof-dir` collection | `*.cpuprofile` (open in speedscope / DevTools Performance) |
| Rust | `cargo flamegraph` | `flamegraph.svg` dropped into the artifact dir |
| Python | `py-spy record --subprocesses` | `flamegraph.svg` dropped into the artifact dir |

`--vm-url` snapshots `http.server.duration` histogram quantiles from
VictoriaMetrics next to the locally measured numbers, reusing the
metric the OTEL HTTP auto-instrumentation already emits rather than
minting a new one.

### Frontend path

`profile ui` wires the `chrome-devtools-deep` skill recipe as a
runnable: Playwright `context.newCDPSession`, `Tracing.start` with
`transferMode: ReturnAsStream`, trace persisted as `trace.json` for
chrome://tracing. Navigation timing and buffered PerformanceObserver
entries yield TTFB / DCL / load / LCP / CLS (INP only when the page
produced events). `--bundle-dir` adds raw plus gzip bundle bytes. The
runner skips with a sentinel and exit 0 when Playwright is missing,
matching the bench.sh degradation pattern.

### OpenTelemetry correlation

Span to profile: each api run mints one W3C trace id, sends
`traceparent` on every request, and embeds the trace id in the artifact
directory name `.harness/artifacts/profile/<iso_key>--<trace_id>/`.
Profile to span: `trace-correlation.json` in the artifact dir carries
the trace id and a span-id sample. Query VictoriaTraces for the trace
id (observability-queries skill) to pivot in either direction.

### Preservation

`harness/perf/bench.sh` and `harness/perf/gate.mjs` are untouched;
`profile startup` wraps bench.sh and feeds the generalized signal gate.
`harness/perf/` remains the compatibility surface for at least one
minor release, then deprecates through the versioning slot.

## Alternatives considered

- **Fold into `inspector`**: rejected; inspector is the evidence-capture
  slot (screenshots, video keyframes), a profile is a quality signal.
- **APSS dimension**: rejected; APSS gates documentation contracts.
- **Always-gating**: rejected; perf numbers on shared CI runners are
  noisy, and a default-on gate would train agents to bump tolerances.
  Advisory default plus explicit budgets keeps the gate trustworthy.
- **Full TOML dependency for budgets**: rejected; budgets are flat
  per-signal tables, so the slot parses a documented TOML subset and
  fails closed on anything outside it.

## Consequences

- Agents get `just profile` feedback on backend latency, frontend
  vitals, and startup cost without any setup, and a one-file opt-in to
  hard budgets.
- `scripts/` coverage stays at 100 percent; the slot logic lives in
  `harness/profiling/src/*.mjs` with its own vitest suites under
  `scripts/tests/profiling-*.test.ts`.
- Open: a committed `ws_apps/example-http` server (closes the EXP-02 /
  EXP-05 missing-API friction) would give `profile api` an in-repo
  default target; tracked as a follow-up, see PROFILING-SLOT-DESIGN.md
  section 5 step 3.
