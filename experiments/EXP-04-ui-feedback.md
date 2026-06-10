# EXP-04 UI feedback
# CLAIM: 2026-06-10T03:00:00Z by Codex

## Hypothesis (frozen)
The stack can capture a frontend UI assertion via the inspector toolchain in an agent-visible way.

## Prediction
A screenshot or flow capture against the docs app succeeds and produces evidence files for later review.

## Probe plan
1. Start the docs app (`@harness/docs dev`).
2. Capture UI evidence using `just inspector screenshot-pair`.
3. Verify artifacts and check for explicit capture success in output.
