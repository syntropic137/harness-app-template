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
