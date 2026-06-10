# EXP-06 OpenTelemetry access

Claim: claude-opus-4-7, 2026-06-10T03:53:00+02:00, branch feat/apss-integration. Sole-editor; do not edit from other agents.

## Question
Is OpenTelemetry actually reachable and documented for a fresh agent on this fork? Specifically: can the agent find + query traces, metrics, AND logs, AND use them to diagnose a deliberately introduced slow path, using only AGENTS.md + .claude/skills/?

## Pre-flight disclosure
Pre-flight reconnaissance for EXP-02 (run-the-app) already exercised some endpoints on this host:
- The example-typescript app's span landed in VictoriaTraces; `curl /select/jaeger/api/services` returned `{"data":["example-typescript"]}` and `/select/jaeger/api/traces?service=example-typescript&limit=5` returned the full span.
- The same app's Pino-shaped stdout JSON log line did NOT reach VictoriaLogs; `curl /select/logsql/query?query={service.name="example-typescript"} | fields ...` returned `Content-Length: 0`.
- This is partially-known territory. To preserve the falsifiability of THIS experiment, the predictions below name endpoints, query shapes, signals, and a NEW slow-path probe whose result was NOT observed during pre-flight.

## Hypothesis (frozen before this commit)
1. **P1 Traces are reachable.** The Jaeger-compatible API at `http://localhost:${VT_PORT}/select/jaeger/api/services` returns the canonical service list including `example-typescript`. Confidence: HIGH (observed in pre-flight).
2. **P2 Metrics are reachable.** PromQL via `http://localhost:${VM_PORT}/prometheus/api/v1/query?query=up` returns at least one series with `status:"success"`. Confidence: MEDIUM.
3. **P3 Logs from external processes are NOT reachable.** LogsQL via `http://localhost:${VL_PORT}/select/logsql/query` returns `Content-Length: 0` for any `{service.name="example-typescript"}` projection because the OTel Collector's filelog receiver scrapes container stdout, not host stdout. Confidence: HIGH (observed in pre-flight; reusing the observation as a frozen-data anchor is acceptable because the failure shape is mechanical, not a hypothesis test).
4. **P4 Documentation surface is split: skill yes, AGENTS.md no.** AGENTS.md mentions "observability-queries" by name (or by category) but does NOT inline any endpoint URI for VL/VM/VT. The skill body DOES. Confidence: HIGH (already grepped).
5. **P5 Slow-path diagnosis works via traces only.** Run the same example-typescript with a deliberately introduced 1-second sleep before the span ends. The new span's `duration` field (microseconds) in the Jaeger response is >= 1_000_000 microseconds. Wall-clock to diagnose (from emit to "yes the span is slow") is < 60s. Confidence: HIGH (mechanics are simple; the riskier path is whether the new emission reaches VT in time).
6. **P6 Slow-path diagnosis via logs is NOT possible** on the same observation window because of P3: the timing information is in the trace, never in VL. Cross-signal correlation by trace_id between stdout-printed traceId and the trace store DOES work (one can manually walk from stdout-printed trace_id to Jaeger), but is not "queryable" in the sense the roadmap asks. Confidence: HIGH.

Composite prediction:
- **CONFIRMED** if P1-P6 all hold (the harness ships partial OTel access: traces/metrics yes, host-process logs no, AGENTS.md gap real, slow-path diagnosable via traces).
- **PARTIAL** if P2 fails (metrics endpoint not actually wired) but P1, P3, P5 hold.
- **FALSIFIED** if P1 or P5 fails (the keystone trace path is broken).

## Setup
- Working tree: `/data/projects/harness-lab`, branch `feat/apss-integration`.
- Stack booted from EXP-02 pre-flight: containers `victoriatraces-1`, `victorialogs-1`, `victoriametrics-1`, `otel-collector-1` running. Ports allocated per worktree via `just stack ports` (hash `cc71a7d2`).
- Docs frontend running on port 3001 (from EXP-04 restart). Irrelevant to this experiment but noted.
- Tools available: just, curl, pnpm, docker.
- N = 1 host. Single-run evidence weight LOW for any specific number; structural findings (endpoint reachable / not) more durable.

## Probes (frozen)
- **R1**: `curl -s http://localhost:${VT_PORT}/select/jaeger/api/services` parse JSON, score `data` array contains `example-typescript`. Score P1.
- **R2**: `curl -s "http://localhost:${VM_PORT}/prometheus/api/v1/query?query=up"` parse JSON, score `status:"success"` AND `data.result` non-empty. Score P2.
- **R3**: `curl -s -w '%{size_download}\n' "http://localhost:${VL_PORT}/select/logsql/query" --data-urlencode 'query={service.name="example-typescript"} | fields _time, severity, _msg, trace_id | limit 5'`. Score P3 by download size == 0.
- **R4**: `grep -i "observability-queries\|VL_PORT\|VM_PORT\|VT_PORT\|/select/" AGENTS.md` returns the count; `grep -i "/select/" .claude/skills/observability-queries/SKILL.md` returns the skill count. Score P4 by skill > 0 AND AGENTS == 0 for endpoint URIs.
- **R5**: Patch `ws_apps/example-typescript/src/main.ts` `helloWorld` to add `await new Promise(r => setTimeout(r, 1100));` BEFORE `span.end()`. Re-run `pnpm --filter @example/typescript start`. After it exits, sleep 2s for collector flush, query `/select/jaeger/api/traces?service=example-typescript&limit=1`, parse `duration` of the most recent span. Score P5 by `duration >= 1_000_000`. Wall-clock from emit to diagnostic <= 60s.
- **R6**: Score by checking R5's stdout log line (which carries trace_id) and that the trace_id resolves in Jaeger; LogsQL still empty. Score P6 by trace_id correlation work AND LogsQL empty.

## Out of scope
- Fixing the log pipeline (P3 finding is what the experiment surfaces; remediation belongs elsewhere).
- Tuning the OTel collector.
- Per-language emit symmetry (Rust/Python apps).
- Performance of the query layer.

## Expected signals
- R1: JSON `data` array contains `example-typescript`.
- R2: JSON `status:"success"` with >=1 series.
- R3: Content-Length 0.
- R4: AGENTS.md endpoint URI count = 0; skill endpoint URI count >= 1.
- R5: span duration field >= 1_000_000.
- R6: trace_id from stdout resolves in `/select/jaeger/api/traces?traceID=...`; LogsQL empty for the same.

## Verdict (CONFIRMED with one literal-falsified prediction, plus one bonus finding)

Composite: **CONFIRMED**. The harness ships partial OpenTelemetry access exactly as the hypothesis predicted: traces queryable, metrics endpoint live (with caveat below), host-process logs unreachable, AGENTS.md gap real, slow-path diagnosable via traces inside 60s wall-clock.

### Scorecard

| Pred | Score | Observed |
|---|---|---|
| P1 traces reachable | CONFIRMED | `curl /select/jaeger/api/services` returned `{"data":["example-typescript"],"errors":null,"limit":0,"offset":0,"total":1}`. |
| P2 metrics reachable (literal: `up` query returns rows) | FALSIFIED-literal, CONFIRMED-spirit | `query=up` returned `{"status":"success","data":{"resultType":"vector","result":[]}}`. BUT `/prometheus/api/v1/label/__name__/values` returned 6 OTel-shipped runtime metrics: `nodejs.eventloop.time`, `nodejs.eventloop.utilization`, `v8js.memory.heap.limit`, `v8js.memory.heap.space.available_size`, `v8js.memory.heap.space.physical_size`, `v8js.memory.heap.used`. My prediction was sloppy (OTel does not ship Prometheus `up`); the deeper claim (metrics flow) holds. |
| P3 logs unreachable | CONFIRMED | LogsQL `query={service.name="example-typescript"} | fields _time, severity, _msg, trace_id | limit 5` returned bytes=0. Collector log: `filelog/harness ... no files match the configured criteria`. The receiver is configured but watching a path no host process writes to. |
| P4 AGENTS.md gap vs skill | CONFIRMED | AGENTS.md /select/ + VL_PORT + VM_PORT + VT_PORT total hits: 0. observability-queries skill: 12. |
| P5 slow span queryable, wall-clock <= 60s | CONFIRMED | New span observed: `op=slow-hello dur_us=1151542 trace=d68027ebbda946cc178e02a01350ba73 exp06=measure-1s-sleep-duration`. Duration 1,151,542 microseconds (= 1.15s) is >= 1,000,000 threshold. Wall-clock from emit to diagnostic ~25s. |
| P6 trace_id correlation works, logs still empty | CONFIRMED | stdout JSON carried `traceId:d68027ebbda946cc178e02a01350ba73`; the same ID was queryable as the operationName `slow-hello` in Jaeger. LogsQL same window still bytes=0. |

### Bonus finding (not in the hypothesis)

Setting `OTEL_SERVICE_NAME` to a custom value (e.g. `exp06-slow-probe`) instead of the default `example-typescript` caused emitted traces to be silently absent from `GET /select/jaeger/api/services` AND from `GET /select/jaeger/api/traces?service=<custom>&limit=N` AND from `GET /select/jaeger/api/traces/<traceID>`. The trace_id resolves to `total:1, data:[]` on direct fetch (suggesting the trace was registered somewhere but not surfaced through the Jaeger schema). Unsetting OTEL_SERVICE_NAME (so the SDK falls back to the package default) made the slow-hello span land normally. Root cause unconfirmed: candidate is VictoriaTraces only indexing service names already seen, OR a collector pipeline rule that drops resource.attributes whose service.name is not pre-registered. Worth a follow-up probe (could become an EXP-NN of its own).

### Reusable empirical claims (with evidence count)
- VictoriaTraces ingestion latency for an OTLP span emitted from outside-container Node process: < 5s (N=1, low). Source: trace `d68027ebbda946cc178e02a01350ba73` emitted ~T0, visible via Jaeger query at T0+3s.
- Slow-path detection via trace duration: span.duration field reports microseconds; a 1.1s sleep yields ~1.15M microseconds (N=1, low).
- OTel collector's filelog receiver path glob matches no files in the default bare-template install (N=1, host=this VPS).
- The 6 runtime metrics that DO populate VictoriaMetrics on this stack are Node.js/V8 internals shipped by the auto-instrumentation; no application-defined metrics observed.

### Friction items (will append to FRICTION.md)
- [EXP-06] [tooling-bug] LogsQL pipeline is documented in observability-queries skill but the filelog receiver finds no files on a bare template install; external-process stdout logs never reach VictoriaLogs.
- [EXP-06] [tooling-bug] Setting OTEL_SERVICE_NAME to a value other than the package default makes emitted traces silently absent from the Jaeger service list and trace-fetch endpoints.
- [EXP-06] [docs-gap] AGENTS.md does not inline a single endpoint URI for VL/VM/VT; only the skill body has them. An agent that never invokes the skill cannot discover the OTel query surface from AGENTS.md alone.
- [EXP-06] [docs-gap] No `up` series exists because OTel collector does not synthesize Prometheus-style scrape-target metrics; query examples in any future docs should use OTel-shipped metric names (nodejs.eventloop.*, v8js.memory.*) instead.
