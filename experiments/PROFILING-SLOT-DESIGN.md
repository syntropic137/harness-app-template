# Profiling slot design

Author: CobaltCoast (claude-opus-4-7), 2026-06-10, branch feat/apss-integration.
Status: design draft for review by orchestrator + peers.
Evidence: see [EXP-11 profiling-gap](./EXP-11-profiling-gap.md) (verdict
PARTIAL, hyperfine startup bench exists but no API or UI profiler).
EXP-11 falsified the strict "no profiling at all" prediction by surfacing
`harness/perf/bench.sh` (startup-time hyperfine bench) and
`harness/perf/gate.mjs` (25 percent regression gate), but everything else
is missing: no API latency profile, no frontend perf capture, no
flamegraph path, and the existing startup bench is not exposed via the
justfile front door. This document proposes the missing slot.

## 1. What the slot measures

### 1.1 Backend

| Signal | Metric / artifact | Source | Default budget |
|---|---|---|---|
| Request latency | OTEL `http.server.duration_bucket` histogram, p50/p95/p99 | Application OTEL SDK -> Collector -> VictoriaMetrics | advisory only |
| Throughput | requests-per-second over a 30 second window | `oha` or `vegeta` load output + VM `rate()` | advisory only |
| Cold-start | hyperfine mean wall-clock | `harness/perf/bench.sh` (exists today) | 25 percent over baseline |
| CPU flamegraph | Node `--cpu-prof` JSON + flamegraph SVG, or `cargo flamegraph`, or `py-spy record` | per-language tool, picked in ADR | artifact only, no gate |
| Regression detection | the gate compares the current run against `baseline.json` per benchmark | `harness/perf/gate.mjs` extended | configurable tolerance per signal, default 25 percent for cold-start, 50 percent for p99 |

A request-handler flamegraph is the deliverable that closes the EXP-11 gap.
Today the hyperfine bench answers "did adding a dep make boot slower";
the slot extends that to "where does the request spend its time".

### 1.2 Frontend

| Signal | Metric / artifact | Source | Default budget |
|---|---|---|---|
| Navigation timing | `domContentLoaded`, `loadEventEnd`, TTFB | Playwright `page.evaluate(() => performance.getEntriesByType('navigation'))` | advisory |
| Core Web Vitals | LCP, INP, CLS | Playwright + the `web-vitals` library injected into the page | gate when budget set |
| Bundle size | per-route JS + CSS byte count, gzipped | `next build` output + `du` over `.next/` | advisory; turns into a gate when a budget file exists |
| Performance trace | Chrome DevTools Protocol `Tracing.start` JSON, plus per-frame screenshot pair | `chrome-devtools-deep` recipe wired into a runnable script | artifact only |
| Regression detection | LCP and bundle size compared against `baseline.json` | extension of `harness/perf/gate.mjs` | advisory by default |

The frontend half consumes the existing `chrome-devtools-deep` snippet
recipe (EXP-08 confirmed it lives only as a JS snippet today) and wraps
it as a runnable.

## 2. Wiring profiling to OpenTelemetry

Today's telemetry sdk slot already emits spans from the example apps
into VictoriaTraces (EXP-05 verified `example-typescript` shows up in
`/select/jaeger/api/services`). The profiling slot piggybacks on that
without inventing a parallel transport.

Two correlation paths:

1. **Span -> profile**: every `just profile api` and `just profile ui`
   run starts an outer parent span on the OTEL SDK, captures the
   profile artifact (flamegraph SVG or trace JSON), and writes the
   trace-id into the artifact directory name:
   `.harness/artifacts/profile/<iso_key>--<trace_id>/`.
   The agent who later queries VictoriaTraces for that trace can pull
   the matching profile straight off disk; the
   `before-after-evidence` skill already documents this correlation
   pattern for screenshots, so the slot reuses the convention.

2. **Profile -> span**: when the profile is captured in-process
   (Node `--cpu-prof`, `cargo flamegraph` against a span-instrumented
   binary, `py-spy record --subprocesses`), the span-id is read from
   the active OTEL context and written into the profile's metadata
   header (`profile.metadata.trace_id`, `profile.metadata.span_id`).
   That lets a downstream viewer (chrome://tracing, speedscope) pivot
   from a hot stack to the originating request trace without an extra
   index.

The slot does NOT mint a new histogram metric name; it consumes the
`http.server.duration` histograms already produced by the OTEL HTTP
auto-instrumentation. Backends that do not emit that histogram (today
all three example apps, because none runs an HTTP server) need a tiny
HTTP server example added under `ws_apps/`, which also removes the
EXP-02 / EXP-05 missing-API friction.

## 3. Slot composition fit

The slot is **harness-native** and **advisory by default**.

| Question | Answer |
|---|---|
| Where in the 11-or-12 named slots? | Add `profiling` as the 12th canonical slot. Folding into `inspector` is rejected because `inspector` is the evidence-capture slot (screenshots, video keyframes); a profile is a quality signal, not an evidence artifact. |
| Sensors-gate vs APSS dimension? | Sensors-gate input. The slot writes a JSON verdict per run into `harness/sensors/inputs/profiling/<iso_key>.json` that the existing sensors-gate aggregates with depcruise / ts-morph / hyperfine results. Profiling is NOT an APSS doc dimension; APSS gates documentation contracts, not perf budgets. |
| Gate vs advisory? | Advisory by default (writes a verdict, never fails the build). Opt-in `perf-budget` gate per signal lives in `harness/perf/budgets.toml`. When a budget is set, the sensors-gate consumes it and turns the verdict into a hard failure. |
| Fitness-gate fit? | The slot REPLACES `harness/perf/gate.mjs` with a slightly generalized version that compares per-signal means against `baseline.json` and respects per-signal tolerance from `budgets.toml`. The startup-time gate becomes the first wired signal; latency p99 and LCP follow. |
| ADR? | New `docs/standard/decisions/profiling.md` picks per-language tools (Node CPU profile, `cargo flamegraph`, `py-spy`, Chrome DevTools Protocol), pins versions, and links back to this design doc + EXP-11. |

## 4. Concrete recipes and layout

### 4.1 Repo layout

```
harness/
  profiling/
    README.md                         # adopter front door for the slot
    bin/profile                       # thin dispatcher: profile {api|ui|startup}
    src/
      api.ts                          # backend profile runner
      ui.ts                           # frontend profile runner (uses playwright + CDP)
      startup.ts                      # wraps the existing harness/perf/bench.sh
      budgets.ts                      # parse harness/perf/budgets.toml
      gate.ts                         # generalized version of harness/perf/gate.mjs
    budgets.toml                      # per-signal tolerance + budget (gitignored example)
    budgets.example.toml              # committed template
    baseline.json                     # per-signal baseline; updated only by --update-baseline
  perf/                               # kept for compatibility; bench.sh + gate.mjs stay as-is for now
                                       # and the new slot imports them
```

The slot lives next to `harness/perf/` rather than replacing it
in-place; the migration is additive, not destructive (mirrors the
preservation-first pattern called out in `harness/perf/gate.mjs`
itself).

### 4.2 justfile recipes

Added to the top-level `justfile`:

```just
# Profile recipes (advisory by default; see harness/profiling/budgets.toml)
profile *args:
    harness/profiling/bin/profile {{args}}

profile-api app="example-http":
    harness/profiling/bin/profile api {{app}}

profile-ui route="/docs/":
    harness/profiling/bin/profile ui {{route}}

profile-startup:
    harness/profiling/bin/profile startup
```

`just --list` then surfaces the recipes on the front door. AGENTS.md
adds one line in the Quick runbook:

```sh
just profile --help   # backend, frontend, startup profiles + per-signal budgets
```

### 4.3 What an agent runs

Backend profile of a hello-world HTTP server example:

```sh
just stack boot
eval "$(just stack ports)"
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${OTEL_OTLP_PORT}"

# boot the example HTTP server (to be added under ws_apps/example-http)
pnpm --filter @example/http start &
APP_PID=$!

# run the profile: starts an outer parent span, hits the server with oha,
# pulls http.server.duration histograms from VictoriaMetrics, captures
# a Node --cpu-prof flamegraph for the handler, writes everything to
# .harness/artifacts/profile/<iso_key>--<trace_id>/
just profile api example-http

kill $APP_PID
```

The artifact directory then contains:

```
flamegraph.svg
cpu-prof.json
latency-summary.json       # p50/p95/p99 + throughput, pulled from VM
trace-correlation.json     # parent trace_id + matching span_ids
verdict.json               # against budgets.toml; advisory unless gate set
```

Frontend profile of a docs route:

```sh
just stack boot
eval "$(just stack ports)"

# boot the docs dev server (the existing ws_apps/docs)
pnpm --filter @harness/docs dev &
NEXT_PID=$!

# run the profile: opens chrome under playwright, captures a Tracing.start
# performance trace for the navigation, samples web-vitals, snapshots the
# .next/ bundle size, writes everything to .harness/artifacts/profile/...
just profile ui /docs/

kill $NEXT_PID
```

The artifact directory then contains:

```
trace.json                 # CDP Tracing.start JSON, openable in chrome://tracing
web-vitals.json            # LCP, INP, CLS from the page
bundle-size.json           # per-route + total .next/ byte count
navigation-timing.json     # performance.getEntriesByType('navigation')
verdict.json               # against budgets.toml; advisory unless gate set
```

Startup profile (existing hyperfine bench, re-exposed):

```sh
just profile startup
# Reads harness/perf/bench.sh output, compares against
# harness/profiling/baseline.json, writes verdict.json.
```

### 4.4 How the agent reads results

The slot writes `verdict.json` in the same shape the sensors-gate
already consumes (one JSON per signal, with `actual`, `baseline`,
`tolerance`, `pass`, plus an `artifacts` array). An agent that wants a
human summary runs:

```sh
just profile summary .harness/artifacts/profile/<iso_key>--<trace_id>/
```

which prints a terse table to stdout. For deeper inspection: open
`flamegraph.svg` in a browser, or open `trace.json` in
`chrome://tracing`, or `curl` the trace-id straight against
VictoriaTraces (the `observability-queries` skill already documents
that endpoint shape).

## 5. Migration steps and order

1. Land this design doc (this commit), cite EXP-11.
2. Add `docs/standard/decisions/profiling.md` ADR. Pin per-language
   tools and reference this design doc + EXP-11.
3. Add `ws_apps/example-http/` -- minimal HTTP server with OTEL HTTP
   auto-instrumentation. Closes the EXP-02 / EXP-05 / EXP-11 missing-API
   friction together.
4. Scaffold `harness/profiling/` with `bin/profile`, `budgets.example.toml`,
   `baseline.json`, and wire the three recipes into the justfile.
5. Implement `just profile startup` first as a wrapper around
   `harness/perf/bench.sh`. Smallest scope; verifies the verdict.json
   shape end-to-end.
6. Implement `just profile api`. Generalize `harness/perf/gate.mjs`
   into `harness/profiling/src/gate.ts`. Stop touching `harness/perf/`
   in this step.
7. Implement `just profile ui`. Wire the `chrome-devtools-deep` snippet
   recipe as a real Playwright script. Add `web-vitals` as a docs-app
   devDep.
8. Add the sensors-gate consumer that turns `verdict.json` entries with
   a budget into a hard failure. Default config has no budgets, so the
   gate is a no-op for adopters who do not opt in.
9. Update AGENTS.md to add the slot under the Quick runbook and
   enumerate `profiling` as the 12th named slot.

Each step is one commit, two if the change is load-bearing on cost or
wall-clock claims (running-experiments skill, two-commit rule).

## 6. Open questions

- Node CPU profile vs `0x` flamegraph: which produces a flamegraph SVG
  that fits the slot contract with fewest moving parts? Needs an
  experiment.
- Whether to record `Tracing.start` traces for EVERY UI test by default
  (cheap with `transferMode: ReturnAsStream` per chrome-devtools-deep)
  or only when `just profile ui` runs. Default: on-demand only; full
  traces are heavy.
- Whether `harness/perf/` should be folded into `harness/profiling/` or
  kept as a backward-compat alias. Recommendation: keep for at least
  one minor release, then deprecate via the versioning slot.
- How `budgets.toml` interacts with the existing sensors-gate config;
  needs an ADR.

## 7. Anti-goals

- The slot is NOT a synthetic load generator. `just profile api` runs
  enough traffic to fill OTEL histograms (default 10 second oha run);
  full perf testing remains the job of a separate harness.
- The slot is NOT an APM. It writes artifacts and verdicts; it does NOT
  ship a live dashboard. VictoriaMetrics + Grafana via the existing
  observability slot remain the live view.
- The slot is NOT an APSS doc dimension. APSS gates documentation
  contracts, not perf budgets.
