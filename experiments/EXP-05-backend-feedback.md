# EXP-05 backend feedback
# CLAIM: 2026-06-10T03:15:00Z by Codex

## Hypothesis (frozen)
An agent can discover and call a backend endpoint directly with one command and get a machine-readable response suitable for feedback loops.

## Prediction
Using only docs/commands, API endpoints in the observability stack return structured JSON responses to direct `curl` queries.

## Probe plan
1. Identify endpoint URLs from run instructions in `ws_apps/example-typescript/README.md` and `just stack ports`.
2. Boot stack and capture `VL_PORT` and `VT_PORT`.
3. Run direct query requests and record response shape/status.
