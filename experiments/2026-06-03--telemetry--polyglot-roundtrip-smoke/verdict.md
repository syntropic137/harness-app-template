# Verdict

Status: go.

The template now has a one-command live smoke that proves TypeScript, Rust, and
Python example telemetry crosses process, network, collector, and backend
boundaries.

## Hypothesis Scorecard

| Prediction | Observed | Score | Notes |
|---|---|---|---|
| TypeScript roundtrip | Log and trace found for `observability-smoke-typescript-1780524517`. | Correct | Evidence in `runs/2026-06-03T220826Z-observability-smoke.txt`. |
| Rust roundtrip | Log and trace found for `observability-smoke-rust-1780524517`. | Correct | Rust compiled in the clean clone, then emitted successfully. |
| Python roundtrip | Log and trace found for `observability-smoke-python-1780524517`. | Correct | First run created `.venv` and installed 32 packages, then emitted successfully. |
| Dynamic ports | Smoke read `OTEL_OTLP_PORT`, `VL_PORT`, and `VT_PORT` from `harness/stack/bin/stack ports`. | Correct | No fixed 4318, 9428, or 10428 assumptions in the smoke path. |

## Follow-Up

Metrics remain out of scope for this probe. A future telemetry-sdk hardening
bead should add metrics emitters before extending the smoke to VictoriaMetrics.
