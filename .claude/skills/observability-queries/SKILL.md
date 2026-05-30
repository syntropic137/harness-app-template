---
name: observability-queries
description: Canonical LogsQL/PromQL/TraceQL queries against the harness Victoria stack — error scan, structured filter, trace↔logs correlation, error-rate, p95 latency, traces-by-service. Use when investigating a bug via logs/metrics/traces, building an evidence bundle, or wiring a new alert. Includes copy-pasteable curl examples and the gotchas (severity, not level; case-sensitive enum; `| fields` projection mandatory).
allowed-tools: Bash, Read
---

# Observability queries — the 6 shapes you'll actually use

## Discover ports

```sh
pnpm harness inspect
# VL_PORT  → VictoriaLogs   (LogsQL,   /select/logsql/query)
# VM_PORT  → VictoriaMetrics (PromQL,   /api/v1/query)
# VT_PORT  → VictoriaTraces  (Jaeger-compat, /select/jaeger/api/...)
```

`ISO=$(pnpm harness inspect | awk '/Iso key:/ {print $3}')` pins queries to the current branch's stack.

## Universal gotchas (read these first)

- **`severity`, not `level`.** Filtering `level:error` silently returns empty (retro 002).
- **`severity` is case-sensitive.** Pino emits `INFO`/`ERROR` (uppercase). Match `severity:ERROR` or use the union `severity:(ERROR OR error)` to handle mixed sources.
- **LogsQL has no `|~` regex-pipe operator.** Use `field:/regex/` or bare `"word"` for text match.
- **Always project with `| fields …`.** Without it each log returns ~2.3 KB; with projection ~200 B. Measured saving on this stack: 6.0× on a 5-row sample, 11.9× on the EXP-1 1k-row scan.
- **OTEL→Prom attribute conversion:** dots → underscores. `service.name` (in VL) becomes `service_name` in PromQL labels. The metric names themselves keep dots in VictoriaMetrics (e.g. `http.server.duration_bucket`) and must be quoted: `{__name__="http.server.duration_bucket"}`.
- `| fields` drops `_stream` and `_stream_id`. If you need full context for one line, re-query that `_time` without projection.

## Q1 — LogsQL: error scan with `| fields` projection

**Returns:** recent error log lines, projected to 4 fields.

```sh
curl -sG "http://localhost:$VL_PORT/select/logsql/query" --data-urlencode \
  "query={harness.iso_key=\"$ISO\"} severity:ERROR | fields _time, service.name, severity, _msg | limit 20"
```

Sample response (one line per result, NDJSON):
```
{"_time":"2026-05-14T09:09:10.084033844Z","service.name":"api-cpp","severity":"ERROR","_msg":"migration error: SQL execution timeout"}
```

**Token cost:** with projection ~135 B/row. Without `| fields` ~810 B/row (6.0× measured on this stack, 11.9× on larger scans). The projection is non-optional for any query touching >10 rows.

## Q2 — LogsQL: structured-field filter (by service.name)

**Returns:** logs scoped to one service. Use for "what was API doing at T?"

```sh
curl -sG "http://localhost:$VL_PORT/select/logsql/query" --data-urlencode \
  "query={harness.iso_key=\"$ISO\",service.name=\"api\"} | fields _time, severity, _msg | limit 20"
```

Sample:
```
{"_time":"2026-05-14T09:09:12.912Z","severity":"info","_msg":"Server listening at http://0.0.0.0:3000"}
```

**Note:** the stream selector `{service.name="api"}` is cheaper than the post-filter `_stream:{service.name="api"}` because it filters at the index, not after match.

## Q3 — LogsQL: by traceID (links a trace to its log lines)

**Returns:** every log line emitted under one trace_id — the critical step in trace↔logs correlation.

```sh
TRACE_ID=d17a6f60131d4c23162495a8e4ae5bc3
curl -sG "http://localhost:$VL_PORT/select/logsql/query" --data-urlencode \
  "query={harness.iso_key=\"$ISO\"} trace_id:$TRACE_ID | fields _time, severity, _msg, req.url, res.statusCode | limit 50"
```

Sample:
```
{"_time":"2026-05-14T16:48:00.408Z","trace_id":"d17a6f60131d4c23162495a8e4ae5bc3","_msg":"incoming request"}
{"_time":"2026-05-14T16:48:00.409Z","trace_id":"d17a6f60131d4c23162495a8e4ae5bc3","_msg":"request completed"}
```

Get the trace_id from a failed Playwright response: `response.request().headers()['traceparent']` → second hex segment.

## Q4 — PromQL: error rate (HTTP status grouped over 5m)

**Returns:** instant rate of requests grouped by status code. Spike on 5xx → page someone.

```sh
curl -sG "http://localhost:$VM_PORT/api/v1/query" --data-urlencode \
  'query=sum by (http.status_code) (rate({__name__="http.server.duration_count"}[5m]))'
```

Sample:
```json
{"status":"success","data":{"resultType":"vector","result":[{"metric":{"http.status_code":"200"},"value":[1778778648,"0.199"]}]}}
```

**Gotchas:** the metric name (`http.server.duration_count`) keeps OTEL dots; it must be selected via `{__name__="..."}` because raw `http.server.duration_count` is a syntax error in PromQL. Label keys (`http.status_code`) also keep dots and need bracket-quoting in some clients.

## Q5 — PromQL: latency p95

**Returns:** 95th-percentile HTTP server latency over the last 5 minutes.

```sh
curl -sG "http://localhost:$VM_PORT/api/v1/query" --data-urlencode \
  'query=histogram_quantile(0.95, sum by (le) (rate({__name__="http.server.duration_bucket"}[5m])))'
```

Sample:
```json
{"status":"success","data":{"resultType":"vector","result":[{"metric":{},"value":[1778778648,"4.749"]}]}}
```

Add `, service.name` to the `sum by (…)` group to get per-service p95. Values are in milliseconds (OTEL HTTP semconv default).

## Q6 — TraceQL / Jaeger: recent traces by service name

**Returns:** the N most recent traces emitted by a given service.

```sh
curl -sG "http://localhost:$VT_PORT/select/jaeger/api/traces" \
  --data-urlencode "service=api" --data-urlencode "limit=10"
```

For one specific trace:
```sh
curl -s "http://localhost:$VT_PORT/select/jaeger/api/traces/$TRACE_ID"
```

List services first if unsure:
```sh
curl -s "http://localhost:$VT_PORT/select/jaeger/api/services"
# {"data":["api"], ...}
```

VictoriaTraces exposes the Jaeger HTTP API, not raw TraceQL HTTP — this is by design (compose template uses VictoriaTraces and the OTEL collector exports to `/api/v2/spans`).

## Composed workflow: failed Playwright response → root-cause log

1. Playwright catches a `requestfailed` or 5xx `response`.
2. Pull `traceparent` from `response.request().headers()`; the trace_id is segment 2.
3. Q3 — fetch the log lines for that trace_id.
4. Q1 (filtered to that service) — pull surrounding ERROR lines for context.
5. Q6 — open the trace in Jaeger UI at `http://localhost:$VT_PORT/select/jaeger/...` to see span timing.

See `.claude/skills/before-after-evidence/SKILL.md` for the full trace-correlation recipe.

## Verified-parsing footnote

Every query above was smoke-tested against a live harness stack on 2026-05-14 (iso `f4bc37f2`, branch `feat/harness-lab-mvp`). Results captured in `experiments/2026-05-14--observability-queries-skill/results.md`.
