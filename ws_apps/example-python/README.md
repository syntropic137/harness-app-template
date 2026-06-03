# example-python

Minimal Python hello-world for the `telemetry-sdk` slot per the [Tool-Belt Harness Standard v0.1](../../docs/standard/v0.1.md). Mirrors `example-typescript` and `example-rust`.

## What it proves

End-to-end for Python: scaffold -> bootstrap -> boot the observability stack -> `pip install -e . && example-python` -> emit one span plus one JSON log line -> retrieve via the `observability-queries` agent skill.

## Run

```sh
just stack boot
eval "$(just stack ports)"
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${OTEL_OTLP_PORT}"
pip install -e ws_apps/example-python
example-python
```

Then query (see `.claude/skills/observability-queries/`):

```sh
curl -sG "http://localhost:${VL_PORT}/select/logsql/query" --data-urlencode \
  'query={service.name="example-python"} | fields _time, severity, _msg, trace_id | limit 20'
curl -s "http://localhost:${VT_PORT}/select/jaeger/api/services"
```

## Tests

```sh
pip install -e 'ws_apps/example-python[test]'
pytest ws_apps/example-python
```

Seven tests; all run with telemetry disabled so the OTEL SDK isn't required to install for the unit-test path.

## Config (env vars)

| Var | Default | Purpose |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTEL Collector OTLP HTTP endpoint. For the template stack, set it to `http://localhost:${OTEL_OTLP_PORT}` from `just stack ports`. |
| `OTEL_SERVICE_NAME` | `example-python` | resource.service.name |
| `HARNESS_TELEMETRY_DISABLED` | unset | set `1` to skip SDK startup (tests use this) |

## Why HTTP/protobuf not gRPC?

Per `docs/adrs/ADR-0004-telemetry-sdk.md`: the Python SDK historically defaults to gRPC/4317, but the polyglot-monorepo template pins HTTP/protobuf (4318) across all language SDKs so a single OTEL endpoint config works identically for Node, Rust, and Python apps.

## Zero-code instrumentation

The dependency on `opentelemetry-distro` enables the zero-code CLI:

```sh
opentelemetry-instrument example-python
```

This wraps the same entry point with auto-instrumentation for popular libraries (requests, httpx, sqlite, etc.) without code changes. See the decision doc for the current state of this feature.
