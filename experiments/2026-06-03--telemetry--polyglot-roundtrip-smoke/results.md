# Results

**Date:** 2026-06-03
**Verdict:** go
**Run evidence:** [`runs/2026-06-03T220826Z-observability-smoke.txt`](runs/2026-06-03T220826Z-observability-smoke.txt)

## Summary

`just observability-smoke` booted the template observability stack and proved
that all three host-run examples roundtrip through VictoriaLogs and
VictoriaTraces.

| Language | Service | VictoriaLogs | VictoriaTraces |
|---|---|---|---|
| TypeScript | `observability-smoke-typescript-1780524517` | pass | pass |
| Rust | `observability-smoke-rust-1780524517` | pass | pass |
| Python | `observability-smoke-python-1780524517` | pass | pass |

## Evidence Excerpt

```text
observability smoke: TypeScript VictoriaLogs round trip ok
observability smoke: TypeScript VictoriaTraces round trip ok
observability smoke: Rust VictoriaLogs round trip ok
observability smoke: Rust VictoriaTraces round trip ok
observability smoke: Python VictoriaLogs round trip ok
observability smoke: Python VictoriaTraces round trip ok
observability smoke: PASS polyglot telemetry round trip ok
```

## Notes

- Stack isolation key: `7c2b10f0`.
- The smoke used the stack-manager allocated ports from
  `harness/stack/bin/stack ports`.
- Python created a local `.venv` on first run and installed 32 packages before
  emitting telemetry.
