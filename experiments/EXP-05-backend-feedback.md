# EXP-05 backend feedback
# CLAIM: 2026-06-10T03:15:00Z by Codex

## Hypothesis (frozen)
An agent can discover and call a backend endpoint directly with one command and get a machine-readable response suitable for feedback loops.

## Prediction
Using only docs/commands, API endpoints in the observability stack return structured JSON responses to direct `curl` queries.

## Probe output
```text
$ just stack ports
VL_PORT=35943
VT_PORT=35945
OTEL_OTLP_PORT=35946

$ curl -s "http://localhost:${VT_PORT}/select/jaeger/api/services"
{"data":["example-typescript"],"errors": null,"limit": 0,"offset": 0,"total":1}

$ curl -sG "http://localhost:${VL_PORT}/select/logsql/query" --data-urlencode 'query={_msg=~"hello"} | limit 3'
<empty>

$ env OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${OTEL_OTLP_PORT}" pnpm --filter @example/typescript emit
{"time":"2026-06-10T01:57:26.312Z","severity":"INFO","service":"example-typescript","traceId":"031c30713c6754094858a026dd19fd62","msg":"hello harness loop probe"}

$ curl -sG "http://localhost:${VL_PORT}/select/logsql/query" --data-urlencode 'query={service.name="example-typescript"} | limit 5'
{"data":["example-typescript"],"errors": null,"limit": 0,"offset": 0,"total":1}
```

## Verdict
PARTIAL

Prediction outcome:
- Endpoint discovery from `just stack ports` and README-style paths was straightforward.
- Structured trace response was available and parsable on `VT_PORT`.
- Loki log-sql endpoint did not return row data in this run despite a generated message payload.

Evidence count:
- N=1, low
