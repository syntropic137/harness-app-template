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

## Verdict
TBD until probes run. See VERDICT section appended after the run.
