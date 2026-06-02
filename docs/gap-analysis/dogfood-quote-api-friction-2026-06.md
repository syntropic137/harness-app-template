# Dogfood friction journal

A brutally honest log written while building a tiny `GET /quote` HTTP service
against this template, as a fresh developer would. Recorded in real time, not
sanitized after the fact.

Test subject: build a minimal HTTP service with `GET /quote` returning a
random quote from a hardcoded list, with one test, exercising the harness
feedback loop end to end (test command, sensors gate, observability stack,
trace check).

Working tree: `/data/projects/dogfood-quote-api` on branch `main`. Date:
2026-06-02.

## TL;DR

| # | What | Severity |
|---|---|---|
| F-001 | `AGENTS.md` / `GEMINI.md` / `.codex/` / `.gemini/` symlinks missing from a "fresh-after-`just init`" tree even though the docs say they exist. | high — silently breaks every non-Claude vendor |
| F-002 | README does not say which task-running surface (`pnpm`, `turbo`, `just`) is the supported per-member invocation. | low |
| F-003 | `ws_apps/docs` is a workspace member, not a docs folder; not signposted. | low |
| F-004 | `just bootstrap` reports `pnpm install failed with undefined` instead of `missing required tools: pnpm`. | medium — misleading first error |
| F-005 | Even after installing `pnpm`, `just bootstrap` fails inside `esbuild@0.21.5`'s postinstall (binary/cache version mismatch). Required a manual `cp` workaround. | high — blocks a clean bootstrap |
| F-006 | `just bootstrap` claims to install vendor symlinks per CLAUDE.md but does not. | medium — docs vs. code drift |
| F-007 | Per-app 100% coverage gate lives inside a comment in `example-typescript/vitest.config.ts`, not in a doc or gate; new ws_apps members silently inherit a different policy. | low |
| F-008 | `just test` fails out of the box because `@harness/inspector` declares `vitest run` but ships no `tests/` directory. | high — canonical entrypoint is red on a clean clone |
| F-009 | Adding any non-trivial new app trips the sensors gate on the MD01 instability counter; expected fix (`--update-baseline`) is documented but the gate's verdict line is buried under an ASCII-art banner and unrelated info findings. | medium |
| F-010 | The shipped collector config has no filelog receiver and the Node SDK does not export logs, so stdout JSON lines never reach VictoriaLogs even though the example code comments imply they will. | medium — half the dogfood goal blocked |
| F-011 | `just stack --help` prints help text and then exits 1. | low |

Traces and metrics through the full pipeline worked: spans for `GET /quote`
(with `quote.author` attribute) and Node runtime metrics
(`nodejs.eventloop.delay.*`, `v8js.memory.*`) round-tripped from the
`quote-api` app, through the collector, into VictoriaTraces and
VictoriaMetrics.

---

## 0. Reading the docs cold

### F-001 — README mentions `AGENTS.md` / `GEMINI.md` symlinks that do not exist

CLAUDE.md says: "Other vendors (Codex, Gemini, Cursor, ...) read it via
symlinks (`AGENTS.md`, `GEMINI.md`, etc.). Edit only this file." README §
"Where this template differs" repeats: "`AGENTS.md`, `GEMINI.md`, `.codex/`,
`.gemini/` are symlinks pointing at it."

Reality at repo root, fresh after the dogfood fork:

```
$ ls -la AGENTS.md GEMINI.md
ls: cannot access 'AGENTS.md': No such file or directory
ls: cannot access 'GEMINI.md': No such file or directory
```

`.codex/` and `.gemini/` are also absent (only `gemini.mcp.json` and
`cursor.mcp.json` files at root). A Codex or Gemini user landing here
would silently miss the agent context. CLAUDE.md says
"`just bootstrap` # install vendor symlinks + validate cross-cutting deps"
but `just bootstrap` does not actually do that (see F-006).

### F-002 — Two task-running surfaces, no obvious primary

The README banner advertises `just` as the canonical entrypoint. The
`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `bun.lock`,
`pyproject.toml`, `uv.lock`, `Cargo.toml`, `go.work` all coexist at the
root. Without reading the ADR index, it is not obvious whether
`pnpm -F @example/typescript test`, `turbo run test`, or `just test` is
the supported invocation for a single workspace member. I picked
`pnpm --filter` based on the example app's inline comment
(`# Run with: pnpm --filter @example/typescript start`), but this is a
guess.

### F-003 — `ws_apps/docs` is a workspace member that looks like documentation

`ls ws_apps` shows `docs example-python example-rust example-typescript`.
The README says "`ws_apps/` holds deployable units; `ws_packages/` holds
shared libraries." `ws_apps/docs` reads as a documentation folder, not a
deployable unit, and the friction is that on first scan I did not know
whether the new quote app went next to it or whether the examples should
be deleted first. Ended up adding `ws_apps/quote-api` alongside, but it
was a guess.

## 1. `just bootstrap` fails on a fresh dogfood machine

### F-004 — `just bootstrap` blows up with an unhelpful `pnpm install failed with undefined`

First command after onboarding:

```
$ just bootstrap
bun run scripts/bootstrap.ts
1.3.14
...
error: pnpm install failed with undefined
      at runInherit (/data/projects/dogfood-quote-api/scripts/lib/git.ts:41:15)
      at main (/data/projects/dogfood-quote-api/scripts/bootstrap.ts:5:3)
error: recipe `bootstrap` failed on line 10 with exit code 1
```

Root cause: `pnpm` is not on `PATH`. The README only mentions `bun`, `pnpm`,
`cargo`, `uv` as required prerequisites inside the description of
`scripts/init.ts` ("Fails fast if `bun`, `pnpm`, `cargo`, or `uv` aren't on
`PATH`"); that fail-fast behavior is for `just init`, not `just bootstrap`.
A returning developer (or this dogfood test, which skipped `just init`
because the template was already initialised) gets a misleading "failed
with undefined" instead of "pnpm not found".

`just doctor` does diagnose this cleanly: `missing required tools: pnpm` —
which is great. But nothing in `README.md` or `CLAUDE.md` tells a new
contributor to run `just doctor` before `just bootstrap`. Resolved by:

```
$ npm install -g pnpm     # manual
$ just doctor             # "doctor: required tools present"
```

Suggestions:
- `scripts/bootstrap.ts` should `which` its tools and print the same
  `missing required tools: pnpm` line `doctor.ts` does, before invoking
  `pnpm install`.
- README "Get started" step 5 should mention `just doctor` ahead of
  `just bootstrap`.

### F-005 — `just bootstrap` fails again after pnpm is installed, this time inside the `esbuild` postinstall

Second attempt after `npm i -g pnpm`:

```
.../esbuild@0.21.5/node_modules/esbuild postinstall: Error: Expected "0.21.5" but got "0.27.7"
.../esbuild@0.21.5/node_modules/esbuild postinstall: Failed
 ELIFECYCLE  Command failed with exit code 1.
error: pnpm install failed with 1
```

What I found by poking around:
- The root `bun.lock` is checked in, but `pnpm-workspace.yaml` is what
  `pnpm` consults; the install used pnpm's content-addressable store and
  laid down three esbuild trees (`0.21.5`, `0.27.7`, `0.28.0`).
- `node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild` is
  an 11 MB native binary that reports `--version` = `0.27.7`. The
  postinstall's `validateBinaryVersion` correctly throws on the mismatch.
- The sibling tree `@esbuild+linux-x64@0.21.5/.../bin/esbuild` is the
  right binary (`--version` = `0.21.5`).

Workaround that unblocked me (manual, undocumented, would never occur to a
newcomer):

```sh
cp -f node_modules/.pnpm/@esbuild+linux-x64@0.21.5/node_modules/@esbuild/linux-x64/bin/esbuild \
      node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild
```

After that, `just bootstrap` ran through `pnpm install`, `cargo check`
(built the full opentelemetry tree, 41s), and `uv sync`, ending cleanly.

This is not a unique-to-this-repo bug, but the template ships a `bun.lock`
plus a `pnpm-workspace.yaml` and pins esbuild ranges via three different
vite versions. The dual-locker situation invites this class of cache
pollution. A checked-in `pnpm-lock.yaml` would let pnpm reproduce its own
install deterministically; right now we are at the mercy of whatever the
pnpm store happens to contain on the dev machine.

### F-006 — `just bootstrap` does not actually create the vendor symlinks CLAUDE.md says it does

After a clean run of `just bootstrap`:

```
$ ls AGENTS.md .gemini .codex
ls: cannot access 'AGENTS.md': No such file or directory
ls: cannot access '.gemini': No such file or directory
ls: cannot access '.codex': No such file or directory
```

But CLAUDE.md says verbatim: "`just bootstrap` # install vendor symlinks +
validate cross-cutting deps." And the README says "`.codex`, `.gemini`,
`AGENTS.md`, `GEMINI.md` are symlinks pointing at `.claude`." Inspecting
`scripts/bootstrap.ts`, the script only runs `bun --version`,
`pnpm install`, `cargo check`, and `uv sync` — no symlink work at all.

The CLAUDE.md sentence about vendor symlinks is therefore wrong, and the
README section "Where this template differs" overstates what ships out of
the box. This is a docs vs. code drift worth filing.

## 2. Test command friction

### F-007 — Per-app 100% coverage gate is a hidden convention

`ws_apps/example-typescript/vitest.config.ts` enforces 100% lines /
branches / functions / statements via `UNIT_COVERAGE_THRESHOLDS`, with a
"PROTECTED: do not adjust" header. There is no documentation telling a
new `ws_apps/` member author whether the same gate is required for them.

In practice the new `ws_apps/quote-api` ships its own `vitest.config.ts`
with no coverage thresholds — and `just test` does not call the per-app
coverage runner anyway, so the looser gate is silently fine. The policy
lives in a comment inside the example, not in the sensors gate or in a
doc. I noted this in `vitest.config.ts` for the new member, but a future
contributor copy-pasting the example will inherit the 100% gate without
realizing it is optional.

### F-008 — `just test` is broken by `@harness/inspector`, which has zero tests

Running `just test` (the canonical entrypoint per CLAUDE.md) fails like:

```
@harness/inspector:test: include: tests/**/*.test.{ts,mts,mjs}
@harness/inspector:test: No test files found, exiting with code 1
@harness/inspector:test:  ELIFECYCLE  Test failed.
 ERROR  @harness/inspector#test: command exited (1)
 ERROR  run failed: command exited (1)
error: pnpm turbo run test failed with 1
error: recipe `test` failed on line 16 with exit code 1
```

The harness inspector slot ships a `package.json` whose `scripts.test` is
`vitest run` but ships no `tests/` directory:

```
$ ls harness/inspector
README.md  bin  keyframe-grid.mjs  node_modules  package.json
record-flow.mjs  screenshot-pair.mjs  vitest.config.ts
```

The "canonical entrypoint" therefore exits non-zero on a clean clone,
even before a consumer adds a single line of code. My new app's test
passes cleanly when invoked directly:

```
$ pnpm --filter @quote/api test
... 1 passed (1)
```

so I am unblocked, but the friction is real.

## 3. Sensors gate

### F-009 — Sensors gate fails on the first add of any non-trivial new app

Adding the quote-api scaffold (4 source files: `quotes.ts`, `server.ts`,
`main.ts`, `telemetry.ts`) triggered:

```
sensors gate: FAIL
regressions:
  MD01 instability-out-of-range-count: 4.000 -> 7.000 (+3.000)
```

Three new modules with `I > 0` (`src/main.ts` at I=0.667, `src/server.ts`
at I=0.500, `src/quotes.ts` at I=0.0 borderline) bumped the
out-of-range counter from 4 to 7.

This is "working as designed" per CONTRIBUTING.md: "Lowering a baseline is
a deliberate act: `just sensors gate --update-baseline` and commit the
resulting `harness/sensors/baseline.json` as part of the same change."
Fixed by running that command and committing the new baseline.

Friction nuance worth filing:
- The very common case is "fresh contributor adds a new app." Right now,
  every such change requires a baseline bump as a separate sub-step.
  Neither README nor CONTRIBUTING explicitly warns "expect this on the
  first add of any non-trivial module."
- The output of `just sensors gate` is very loud (a full ASCII-art banner
  from the UBS module, plus a JSONL info-level finding about
  `writeFileSync` in `scripts/lib/fs.ts` that has nothing to do with my
  change). The `PASS` / `FAIL` line is buried at the bottom under multiple
  empty `── Combined Summary ──` sections. On first read I scanned past
  the verdict.

## 4. Observability slot: end-to-end trace + metric round-trip

`just boot up -d` worked first try once Docker was available. Four
containers (`otel-collector`, `victorialogs`, `victoriametrics`,
`victoriatraces`) came up cleanly, exposed on ports 4318 / 9428 / 8428 /
10428.

Smoke probes:

```
$ curl -s http://127.0.0.1:8080/quote
{"text":"In the middle of difficulty lies opportunity.","author":"Albert Einstein"}
$ curl -s http://127.0.0.1:8080/quote
{"text":"Make it work, make it right, make it fast.","author":"Kent Beck"}
```

Trace round-trip via VictoriaTraces (port 10428):

```
$ curl -s http://127.0.0.1:10428/select/jaeger/api/services
{"data":["quote-api"], ...}
```

Spans included the manual attribute `span_attr:quote.author`
(e.g. `"Albert Einstein"`) attached to the `GET /quote` span, plus the
OTEL Node auto-instrumentation resource attributes
(`telemetry.sdk.language: nodejs`, `scope_name: quote-api`).

Metric round-trip via VictoriaMetrics (port 8428):

```
$ curl -s http://127.0.0.1:8428/api/v1/label/__name__/values
{"status":"success","data":[
  "nodejs.eventloop.delay.max", "v8js.gc.duration_bucket",
  "v8js.memory.heap.limit", ...
]}
```

Node runtime metrics flowed through the collector. The
`keep-essential` transform in `harness/observability/otel-collector.yaml`
preserved the right resource attributes (`service.name`, `host.name`,
`telemetry.sdk.*`) and dropped the rest.

### F-010 — Logs never reach VictoriaLogs

`ws_apps/example-typescript` and my new `ws_apps/quote-api` both emit a
Pino-shaped JSON log line to stdout. The collector config does not declare
a `filelog` receiver (an inline comment in `example-typescript/src/main.ts`
implies it does: "we emit a Pino-shaped log line on stdout that the OTEL
Collector's filelog receiver can scrape"), and the Node telemetry SDK in
the example only configures traces + metrics, not logs. Querying
VictoriaLogs returns nothing for the `quote-api` service:

```
$ curl -s http://127.0.0.1:9428/select/logsql/query \
   --data-urlencode 'query=service.name:"quote-api" | limit 3'
(empty)
```

So the "trace and metric appear for a request" half of the dogfood task
is green; the "log appears" half cannot be done with the shipped
collector config. To plug the gap a contributor must either add a
`filelog` receiver that scrapes container stdout, or wire up
`@opentelemetry/sdk-logs` in the application. Neither path is hinted at
in the slot docs.

### F-011 — `just stack --help` exits 1

```
$ just stack --help
bun run scripts/stack.ts --help
Usage: harness <boot|inspect|ports|stop|destroy|doctor> [...args]
error: harness/stack/bin/stack --help failed with 1
error: recipe `stack` failed on line 40 with exit code 1
```

The usage text prints to stdout, but `harness/stack/bin/stack` exits
non-zero when called with `--help`, so `runInherit` in
`scripts/lib/git.ts` turns the recipe into a failure. Standard CLI
convention is that `--help` exits zero; this one does not. Friction for
any contributor trying to discover what the stack manager can do via
`--help`.

---

## Things that worked well

This list is also load-bearing: the principle from the upstream
`feedback`-memory guidance is to record success alongside friction so we
do not drift away from validated approaches.

- `just doctor` printed a precise diagnostic for the missing `pnpm` and
  saved me from reading bootstrap.ts to find the root cause.
- The lefthook pre-commit gate ran in ~25s including UBS, biome, and the
  doc-validator on the first commit, with no spurious findings against
  my new code. Biome auto-fixed import order and small style nits on
  commit (I noticed only because the post-commit reminder cited the
  fixed file).
- `harness/observability/compose.harness.yml` came up first try and the
  four-service ingest path worked end to end. The `transform/keep-essential`
  processor's resource-attribute allow-list kept query payloads small
  and predictable.
- The OTEL Node auto-instrumentation produced rich `nodejs.*` /
  `v8js.*` runtime metrics with zero application-side work. The manual
  `span_attr:quote.author` attribute on the `GET /quote` span made
  attribute-shaped queries trivially possible against VictoriaTraces.
- `just sensors gate` reported a precise per-folder regression with the
  exact remediation command in its error message. Once I found the
  verdict line at the bottom, the iteration loop was tight.
- `just sensors report --format md` produced an easy-to-read per-folder
  Martin table that made it obvious why my new app moved the I counter.
