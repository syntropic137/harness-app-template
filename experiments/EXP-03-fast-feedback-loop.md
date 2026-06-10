# EXP-03 fast-feedback-loop
# CLAIM: 2026-06-10T02:00:00Z by Codex

## Hypothesis (frozen)
The harness lets an agent apply a backend change and a UI change and observe both outputs quickly with local commands, without manual orchestration.

## Prediction
A one-line backend change plus one-line UI change each complete with a run-time observable signal within 90 seconds total.

## Probe plan
1. Change backend payload in `ws_apps/example-typescript/src/main.ts` and run it once.
2. Change a visible UI string in `ws_apps/docs/app/page.tsx` and run docs build/dev.
3. Measure time-to-first-visible output for both steps.
4. Record whether observation and loop feel mechanical (no extra docs lookup needed).
