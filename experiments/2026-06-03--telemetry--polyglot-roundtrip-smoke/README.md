# Polyglot telemetry roundtrip smoke

## Question

Can the template boot its local observability stack, run the TypeScript, Rust,
and Python examples on the host, and retrieve each service from both
VictoriaLogs and VictoriaTraces through the stack-manager allocated ports?

## Hypothesis

The probe should pass for all three languages after the smoke script sets
`OTEL_EXPORTER_OTLP_ENDPOINT` from `harness/stack/bin/stack ports` and gives
the batch exporters time to flush.

Predictions:

| Prediction | Expected result |
|---|---|
| TypeScript roundtrip | One structured log line and one trace for `observability-smoke-typescript-*` land within 45 seconds. |
| Rust roundtrip | One structured log line and one trace for `observability-smoke-rust-*` land within 45 seconds. |
| Python roundtrip | One structured log line and one trace for `observability-smoke-python-*` land within 45 seconds, possibly slower than TypeScript and Rust. |
| Dynamic ports | The smoke uses `OTEL_OTLP_PORT`, `VL_PORT`, and `VT_PORT` from stack-manager output instead of fixed ports. |

## Setup

- Start from the template root.
- Run `just observability-smoke`.
- The recipe may start Docker containers through `harness/stack/bin/stack boot`.
- The probe writes service stdout JSON lines under `.harness/logs/` for the
  collector filelog receiver.

## Out Of Scope

- This probe does not assert metrics.
- This probe does not require trace-to-log correlation IDs across all
  languages, because the Rust example currently emits service-level log JSON
  without a trace ID field.
