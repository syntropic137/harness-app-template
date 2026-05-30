# example-python

Minimal Python hello-world for the `telemetry-sdk` slot per the [Tool-Belt Harness Standard v0.1](../../docs/standard/v0.1.md). Mirrors `example-typescript` and `example-rust`.

## What it proves

End-to-end for Python: scaffold → bootstrap → boot the observability stack → `pip install -e . && example-python` → emit one span + one JSON log line → retrieve via the `observability-queries` agent skill.

## Run

```sh
just stack boot                              # bring up Victoria* + OTEL Collector
pip install -e ws_apps/example-python        # install (creates the `example-python` console script)
example-python                               # emit one trace + one log line
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
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTEL Collector OTLP HTTP endpoint |
| `OTEL_SERVICE_NAME` | `example-python` | resource.service.name |
| `HARNESS_TELEMETRY_DISABLED` | unset | set `1` to skip SDK startup (tests use this) |

## Why HTTP/protobuf not gRPC?

Per `docs/adr/ADR-0004-telemetry-sdk.md`: the Python SDK historically defaults to gRPC/4317, but the polyglot-monorepo template pins HTTP/protobuf (4318) across all language SDKs so a single OTEL endpoint config works identically for Node, Rust, and Python apps.

## Zero-code instrumentation

The dependency on `opentelemetry-distro` enables the zero-code CLI:

```sh
opentelemetry-instrument example-python
```

This wraps the same entry point with auto-instrumentation for popular libraries (requests, httpx, sqlite, etc.) without code changes. See the decision doc for the current state of this feature.
