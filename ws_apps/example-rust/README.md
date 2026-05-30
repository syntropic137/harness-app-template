# example-rust

Minimal Rust hello-world for the `telemetry-sdk` slot per the [Tool-Belt Harness Standard v0.1](../../docs/standard/v0.1.md). Mirrors `example-typescript`.

## What it proves

End-to-end for Rust: scaffold → bootstrap → boot the observability stack → `cargo run --release` → emit one span + one JSON log line → retrieve via the `observability-queries` agent skill.

## Run

```sh
just stack boot                    # bring up Victoria* + OTEL Collector
cargo run --release -p example-rust
```

## Tests

```sh
cargo test -p example-rust
```

Three tests:
- `hello_world_emits_structured_message` — runs with telemetry disabled, asserts the JSON line shape.
- `telemetry_defaults` — confirms env-var defaults match the Standard's HTTP/4318 + service-name conventions.
- `telemetry_enabled_toggle` — confirms `HARNESS_TELEMETRY_DISABLED=1` short-circuits init.

## Config (env vars)

| Var | Default | Purpose |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTEL Collector OTLP HTTP endpoint |
| `OTEL_SERVICE_NAME` | `example-rust` | resource.service.name |
| `HARNESS_TELEMETRY_DISABLED` | unset | set `1` to skip SDK startup (tests use this) |

## Why HTTP/protobuf not gRPC?

Per `docs/adr/ADR-0004-telemetry-sdk.md`: the Rust SDK historically defaults to gRPC/4317, but the polyglot-monorepo template pins HTTP/protobuf (4318) across all language SDKs so a single OTLP endpoint config in `OTEL_EXPORTER_OTLP_ENDPOINT` works identically for Node, Rust, and Python apps.

## Status of opentelemetry-rust as of 2026-05-14

Pre-1.0 still. **Logs + metrics graduated to stable** in 0.27. **Traces still Beta** in 0.31. Breaking changes ship every minor; pin minor in `Cargo.toml` (we use `"0.31"` not `"0.31.x"`).
