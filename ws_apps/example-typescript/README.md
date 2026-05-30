# example-typescript

Minimal TypeScript hello-world for the `telemetry-sdk` slot per the [Tool-Belt Harness Standard v0.1](../../docs/standard/v0.1.md).

Strict TS (`strict: true`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`) per `tsconfig.base.json`. Vitest for unit + integration. Biome for lint/format. Matches the lab's TS workspaces.

## What it proves

End-to-end: scaffold → bootstrap → boot the observability stack → run this app → emit one span + one Pino-shaped JSON log line → retrieve via the `observability-queries` agent skill.

## Run

```sh
# from project root
just stack boot                              # bring up Victoria* + OTEL Collector
pnpm --filter @example/typescript start      # emit one trace + log line
```

Then query (see `.claude/skills/observability-queries/`):

```sh
curl 'http://localhost:9428/select/logsql/query' --data-urlencode 'query=service:"example-typescript" | fields severity,msg,traceId'
curl 'http://localhost:9428/select/tempo/api/search?service=example-typescript'
```

## Config (env vars)

| Var | Default | Purpose |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTEL Collector OTLP HTTP endpoint |
| `OTEL_SERVICE_NAME` | `example-typescript` | resource.service.name |
| `HARNESS_TELEMETRY_DISABLED` | unset | set `1` to skip SDK startup (tests use this) |

## Why HTTP/protobuf default?

Per `docs/adr/ADR-0004-telemetry-sdk.md`: Node SDK 0.218 defaults to HTTP/protobuf on port 4318. The template pins this default to avoid the cross-SDK transport mismatch gotcha (Rust/Python default to gRPC/4317).
