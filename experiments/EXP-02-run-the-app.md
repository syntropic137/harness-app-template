# EXP-02 run-the-app
# CLAIM: 2026-06-10T01:45:00Z by Codex

## Hypothesis (frozen)
An agent following AGENTS.md and installed skills can start the default app stack and run at least one app binary from root commands without manual source diving.

## Prediction
`just stack boot`, `just stack ports`, and `pnpm --filter @example/typescript start` are discoverable and runnable with clear feedback, and the app can emit telemetry observable in stack query endpoints.

## Probe plan
1. Use AGENTS.md + available skills to identify start workflow.
2. In a clean checkout, run `just stack boot`.
3. Get stack ports and start `@example/typescript`.
4. Query at least one configured telemetry endpoint.

## Probe output
```text
$ just stack boot
Booting harness_harness-exp02-opyd--feat-apss-integration_9159a31c (branch=feat/apss-integration, iso=9159a31c)
...
STACK_BOOT_ELAPSED:11.57 sec

$ just stack ports
VL_PORT=37803
VT_PORT=37805
OTEL_OTLP_PORT=37806

$ OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:${OTEL_OTLP_PORT} pnpm --filter @example/typescript emit
$ node --import tsx --import ./src/telemetry.ts src/main.ts
{"time":"2026-06-10T01:46:58.503Z","severity":"INFO","service":"example-typescript","traceId":"e6ca68fad68c9e705475a248fc5c5e54","msg":"hello from example-typescript"}

curl -s "http://localhost:${VT_PORT}/select/jaeger/api/services"
{"data":["example-typescript"],"errors": null,"limit": 0,"offset": 0,"total":1}

curl -sG "http://localhost:${VL_PORT}/select/logsql/query" --data-urlencode \
  'query={service.name="example-typescript"} | fields _time, severity, _msg, trace_id | limit 5'
<empty response>
```

## Verdict
PARTIAL

Prediction outcome:
- AGENTS.md path and skills were enough to find startup commands.
- `just stack boot` required an initial `just bootstrap`.
- Full application start worked after bootstrap and produced a telemetry trace in the traces endpoint.
- Local log query returned no rows for the tested trace-id query in one run window.

Evidence count:
- N=1, low
