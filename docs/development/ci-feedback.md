# CI feedback and template publishing

Product consumers should validate their application, not prove they can
publish another reusable template on every PR. The fork/scaffolder jobs
run by default only when GitHub marks the repository as a template.
Consumers can opt in with the repository variable RUN_TEMPLATE_CHECKS=true
or the workflow_dispatch boolean input template_checks.

Within that boundary, harness/scripts/workflow changes and build/dependency
configuration select the publishing jobs; product source, styles, data, and
docs alone do not. Weekly and manual runs select the full template suite.
Unknown Git comparisons fail safe to full checks. Job names remain present
as skipped checks on inapplicable runs; no workflow-level path filter leaves
required check contexts pending. Superseded test runs cancel automatically.

Both publishing jobs cache Cargo registry/git downloads and compiled
artifacts at a stable runner-temp path with distinct job keys. Turbo forwards
CARGO_TARGET_DIR to child tasks; otherwise its strict environment causes QA
to miss the bootstrap cache. Cargo still validates fingerprints and tests
still run. Cache misses remain correct. Tauri system libraries install only
when a tauri.conf.json exists. Type checking builds dependency outputs first
so a clean checkout does not depend on local dist artifacts.

QA runs typecheck and lint, then architectural fitness and secrets, then the
same full tests. Dependency build output remains available to the sensors.
Failures in fitness/security surface before the longest test phase.

## Evidence and limits

The hypothesis-first downstream [CI probe](https://github.com/StratoGarage/grail-nova/tree/feat/grailnova-design-and-measurement/experiments/2026-09-21--ci--template-feedback)
measured one same-commit cold/warm pair. Fork time fell from 7m49s to 6m00s;
scaffolder time fell from 10m02s to 6m44s, including cache transfer. This
missed the predicted sub-six-minute target. That pair predates the Turbo
environment-forwarding correction, so it is not a benchmark of the final
patch. No two-minute or p95 claim is established. The consumer opt-in
boundary removes publishing jobs from app PRs regardless of their duration.

Validation: workflow syntax, 13 real-Git selector cases (including renamed
paths and missing refs), the QA command-order test, and sensor regression
tests. The composite-score correction is a separate policy change described
in [ADR-0029](../adrs/ADR-0029-fitness-metric-size-invariance.md); numeric floors
are not loosened by this patch.
