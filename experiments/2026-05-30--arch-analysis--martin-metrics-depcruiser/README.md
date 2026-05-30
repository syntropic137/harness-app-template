# Experiment: 2026-05-30--arch-analysis--martin-metrics-depcruiser

## Question
Does dependency-cruiser version 17.4.0 successfully report Robert C. Martin metrics (Ca, Ce, I) and abstractness signals per folder and per module when run against the `ws_apps/example-typescript` workspace, and can we parse these to decide whether to adopt the Rust aggregator for the sensors slot?

## Hypothesis
dependency-cruiser will emit a JSON report containing metrics for modules and folders. Specifically:
- It will report non-zero Afferent Coupling (Ca) and Efferent Coupling (Ce) for modules.
- It will calculate an Instability (I) metric between 0 and 1.
- We will be able to parse this JSON to produce a short metrics report without errors.

## Setup
- Tool: `dependency-cruiser@17.4.0`
- Target: `ws_apps/example-typescript/src`
- Command: `npx dependency-cruiser@17.4.0 ws_apps/example-typescript/src --metrics --output-type json > experiments/2026-05-30--arch-analysis--martin-metrics-depcruiser/runs/metrics.json`