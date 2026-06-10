# Profiling slot

The 12th named harness slot: backend, frontend, and startup performance
profiles that are ADVISORY by default, with an opt-in per-signal
perf-budget gate. Design: PROFILING-SLOT-DESIGN.md in the lab repo
(`experiments/PROFILING-SLOT-DESIGN.md`); gap evidence: EXP-11 (hyperfine
startup bench existed but no API or UI profiler and no justfile front
door). Decision record: `docs/adrs/ADR-0026-profiling-slot.md`.

## Quick start

```sh
just profile --help        # full subcommand reference
just profile startup       # hyperfine cold-start bench, gated vs baseline
just profile api --url=http://localhost:3000/health
just profile ui --url=http://localhost:3000/ --bundle-dir=ws_apps/docs/.next
just profile summary       # verdict table for the newest run
```

Every run writes an artifact directory:

```
.harness/artifacts/profile/<iso_key>--<trace_id>/
  verdict.json             # per-signal gate result; the machine surface
  latency-summary.json     # api: p50/p95/p99/mean + throughput + errors
  trace-correlation.json   # api: trace id + span id sample
  *.cpuprofile             # api: flamegraph inputs when --cpu-prof-dir set
  vm-quantiles.json        # api: VictoriaMetrics snapshot when --vm-url set
  navigation-timing.json   # ui: performance.getEntriesByType('navigation')
  web-vitals.json          # ui: LCP / CLS (INP when the page produced events)
  bundle-size.json         # ui: raw + gzip bytes when --bundle-dir set
  trace.json               # ui: CDP performance trace for chrome://tracing
  hyperfine.json           # startup: raw hyperfine export
```

## Advisory by default, gated by choice

The slot never fails a build out of the box. `harness/profiling/baseline.json`
is the committed floor; a regression beyond tolerance prints an ADVISORY
line and exits 0. To make a signal load-bearing, copy
`budgets.example.toml` to `budgets.toml` (gitignored is fine for local
experiments; commit it to bind CI) and set `gate = true` or an absolute
`budget`. The floor only moves through `--update-baseline`, a reviewable
git edit, mirroring `harness/sensors/gate.mjs` and `harness/perf/gate.mjs`.

This slot composes like the other harness-native slots (sensors, perf):
a CLI under `bin/`, a committed baseline, justfile front door, thin
`scripts/profiling.ts` wrapper honoring `harness.manifest.json` plugin
swaps. It is deliberately NOT an APSS dimension: APSS gates documentation
contracts, not perf budgets.

## OpenTelemetry linkage

`profile api` mints one W3C trace id per run and sends `traceparent` on
every request, so the server's OTEL auto-instrumentation parents its
spans under the run. The trace id is embedded in the artifact directory
name; query VictoriaTraces for it (see the `observability-queries` skill)
and the matching profile is the directory carrying the same id. That is
the trace-becomes-a-profile path in both directions.

## Flamegraph / pprof path

Start the backend under a profiler, then point the runner at the output:

```sh
node --cpu-prof --cpu-prof-dir=/tmp/prof src/main.js &
just profile api --url=http://localhost:3000/ --cpu-prof-dir=/tmp/prof
```

The runner copies every `*.cpuprofile` into the artifact directory; open
them in speedscope or the Chrome DevTools Performance panel for the flame
view. Rust and Python lanes use `cargo flamegraph` and `py-spy record`
respectively; drop their SVG output into the artifact directory next to
the verdict (see ADR-0026 for the per-language tool table).

## Frontend capture

`profile ui` is the `chrome-devtools-deep` skill recipe
(`.claude/skills/chrome-devtools-deep/SKILL.md`) made runnable: a CDP
session via Playwright `context.newCDPSession`, `Tracing.start` with
`transferMode: ReturnAsStream`, stream-collected into `trace.json`.
Navigation timing and buffered PerformanceObserver entries provide TTFB,
DCL, load, LCP, CLS, and INP-when-present. When Playwright or its
Chromium build is missing the runner prints a skip sentinel and exits 0,
matching the `harness/perf/bench.sh` degradation pattern.

## Relationship to harness/perf/

`harness/perf/bench.sh` and `harness/perf/gate.mjs` are untouched and
still wired into their existing hooks. `profile startup` wraps bench.sh
and feeds the generalized signal gate here; the old gate remains as the
compatibility surface for at least one minor release (ADR-0026 records
the deprecation plan).
