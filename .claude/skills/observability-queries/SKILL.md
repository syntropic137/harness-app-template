---
name: observability-queries
description: Canonical LogsQL, PromQL, and Jaeger-compatible trace queries against the harness Victoria stack. Use when investigating a bug via logs, metrics, traces, building an evidence bundle, or wiring a new alert. Includes copy-pasteable curl examples and gotchas: severity, not level; case-sensitive enum; mandatory `| fields` projection.
allowed-tools: Bash, Read
---

# Observability queries: the 6 shapes you'll actually use

## Discover stack identity and ports

Run from the repository root after `just bootstrap`:

```sh
just stack inspect
eval "$(just stack ports)"
ISO=$(just stack inspect | awk -F: '/Iso key:/ {gsub(/^ +/, "", $2); print $2}')
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${OTEL_OTLP_PORT}"
```

`just stack inspect` is the human-readable status entrypoint. `just stack ports` prints shell-safe `KEY=value` lines for the current worktree, including:

```sh
VL_PORT=...
VM_PORT=...
VT_PORT=...
OTEL_OTLP_PORT=...
```

If `just` is not available in an automation context, use the slot binary directly:

```sh
eval "$(harness/stack/bin/stack ports)"
ISO=$(harness/stack/bin/stack inspect | awk -F: '/Iso key:/ {gsub(/^ +/, "", $2); print $2}')
```

Do not use `pnpm harness inspect` in this template. That lab command is not a root package script here. Host-run apps should set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:${OTEL_OTLP_PORT}` before emitting telemetry.

## Universal gotchas

- **`severity`, not `level`.** Filtering `level:error` silently returns empty.
- **`severity` is case-sensitive.** Pino emits `INFO` and `ERROR` uppercase. Match `severity:ERROR` or use the union `severity:(ERROR OR error)` to handle mixed sources.
- **LogsQL has no `|~` regex-pipe operator.** Use `field:/regex/` or bare `"word"` for text match.
- **Always project with `| fields ...`.** Without it each log returns much larger rows. The projection is mandatory for any query touching more than 10 rows.
- **OTEL to Prom attribute conversion:** dots become underscores. `service.name` in logs becomes `service_name` in PromQL labels. Metric names keep dots in VictoriaMetrics, for example `http.server.duration_bucket`, and must be selected as `{__name__="http.server.duration_bucket"}`.
- `| fields` drops `_stream` and `_stream_id`. If you need full context for one line, re-query that `_time` without projection.

## Q1: LogsQL error scan with `| fields` projection

**Returns:** recent error log lines, projected to 4 fields.

```sh
curl -sG "http://localhost:${VL_PORT}/select/logsql/query" --data-urlencode \
  "query={harness.iso_key=\"$ISO\"} severity:ERROR | fields _time, service.name, severity, _msg | limit 20"
```

Sample response, one NDJSON result per line:

```json
{"_time":"2026-05-14T09:09:10.084033844Z","service.name":"api-cpp","severity":"ERROR","_msg":"migration error: SQL execution timeout"}
```

## Q2: LogsQL structured-field filter by service.name

**Returns:** logs scoped to one service. Use for "what was API doing at T?"

```sh
curl -sG "http://localhost:${VL_PORT}/select/logsql/query" --data-urlencode \
  "query={harness.iso_key=\"$ISO\",service.name=\"api\"} | fields _time, severity, _msg | limit 20"
```

Sample:

```json
{"_time":"2026-05-14T09:09:12.912Z","severity":"info","_msg":"Server listening at http://0.0.0.0:3000"}
```

The stream selector `{service.name="api"}` is cheaper than the post-filter `_stream:{service.name="api"}` because it filters at the index.

## Q3: LogsQL by traceID

**Returns:** every log line emitted under one trace_id. This is the critical step in trace to logs correlation.

```sh
TRACE_ID=d17a6f60131d4c23162495a8e4ae5bc3
curl -sG "http://localhost:${VL_PORT}/select/logsql/query" --data-urlencode \
  "query={harness.iso_key=\"$ISO\"} trace_id:$TRACE_ID | fields _time, severity, _msg, req.url, res.statusCode | limit 50"
```

Sample:

```json
{"_time":"2026-05-14T16:48:00.408Z","trace_id":"d17a6f60131d4c23162495a8e4ae5bc3","_msg":"incoming request"}
{"_time":"2026-05-14T16:48:00.409Z","trace_id":"d17a6f60131d4c23162495a8e4ae5bc3","_msg":"request completed"}
```

Get the trace_id from a failed Playwright response: `response.request().headers()['traceparent']`, then take the second hex segment.

## Q4: PromQL error rate

**Returns:** instant rate of requests grouped by HTTP status over the last 5 minutes.

```sh
curl -sG "http://localhost:${VM_PORT}/api/v1/query" --data-urlencode \
  'query=sum by (http.status_code) (rate({__name__="http.server.duration_count"}[5m]))'
```

Sample:

```json
{"status":"success","data":{"resultType":"vector","result":[{"metric":{"http.status_code":"200"},"value":[1778778648,"0.199"]}]}}
```

The metric name `http.server.duration_count` keeps OTEL dots, so select it through `{__name__="..."}`. Raw `http.server.duration_count` is a PromQL syntax error.

## Q5: PromQL latency p95

**Returns:** 95th-percentile HTTP server latency over the last 5 minutes.

```sh
curl -sG "http://localhost:${VM_PORT}/api/v1/query" --data-urlencode \
  'query=histogram_quantile(0.95, sum by (le) (rate({__name__="http.server.duration_bucket"}[5m])))'
```

Sample:

```json
{"status":"success","data":{"resultType":"vector","result":[{"metric":{},"value":[1778778648,"4.749"]}]}}
```

Add `, service.name` to the `sum by (...)` group to get per-service p95. Values are in milliseconds for the OTEL HTTP semantic convention default.

## Q6: Jaeger-compatible recent traces by service name

**Returns:** the N most recent traces emitted by a given service.

```sh
curl -sG "http://localhost:${VT_PORT}/select/jaeger/api/traces" \
  --data-urlencode "service=api" --data-urlencode "limit=10"
```

For one specific trace:

```sh
curl -s "http://localhost:${VT_PORT}/select/jaeger/api/traces/$TRACE_ID"
```

List services first if unsure:

```sh
curl -s "http://localhost:${VT_PORT}/select/jaeger/api/services"
```

VictoriaTraces exposes the Jaeger HTTP API, not raw TraceQL HTTP. This is by design. The compose template uses VictoriaTraces and the OTEL collector exports to `/api/v2/spans`.

## Composed workflow: failed Playwright response to root-cause log

1. Playwright catches a `requestfailed` event or 5xx `response`.
2. Pull `traceparent` from `response.request().headers()`; the trace_id is segment 2.
3. Run Q3 to fetch the log lines for that trace_id.
4. Run Q1 filtered to that service to pull surrounding ERROR lines for context.
5. Run Q6 and open the trace in the Jaeger-compatible UI at `http://localhost:${VT_PORT}/select/jaeger/...` to see span timing.

See `.claude/skills/before-after-evidence/SKILL.md` for the full trace-correlation recipe.

## Verification

These query shapes were ported from the lab observability skill and adapted to this template's stack-manager entrypoints. For an executable end-to-end smoke against this template, run:

```sh
just observability-smoke
```
