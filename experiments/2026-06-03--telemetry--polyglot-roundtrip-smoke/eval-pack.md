# Eval Pack

## Command

```sh
just observability-smoke
```

## Probe Steps

1. Verify required local tools exist: `curl`, `docker`, `pnpm`, `cargo`, and
   `uv`.
2. Read stack-manager allocated ports from `harness/stack/bin/stack ports`.
3. Boot the observability stack with `harness/stack/bin/stack boot`.
4. For each language example:
   - set a unique `OTEL_SERVICE_NAME`;
   - set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:$OTEL_OTLP_PORT`;
   - run the example with telemetry enabled;
   - append stdout to `.harness/logs/<service>.jsonl`;
   - poll VictoriaLogs for the service name;
   - poll VictoriaTraces Jaeger API for the service name.

## Success Criteria

| Probe | Pass condition |
|---|---|
| TypeScript | Log query and trace query both contain the TypeScript smoke service. |
| Rust | Log query and trace query both contain the Rust smoke service. |
| Python | Log query and trace query both contain the Python smoke service. |
| Unit coverage boundary | A no-live-stack unit test verifies the smoke script plans all three language commands and dynamic port usage without booting Docker. |

## Failure Criteria

- Any required command is missing.
- The stack does not boot.
- Any example exits non-zero.
- VictoriaLogs or VictoriaTraces does not return a matching service within the
  polling window.
