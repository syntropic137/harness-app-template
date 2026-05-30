# Gap Analysis: Lab Learnings and Examples Not Ported

**Status:** Draft
**Date:** 2026-05-30

This document inventories the valuable documentation, empirical evidence, and concrete examples present in the upstream `agentic-harness-lab` repository that were NOT ported into the `harness-app-template`. 

## 1. Retrospectives (`docs/retrospectives/`)
The lab contains 24 detailed retrospectives that form the empirical foundation of the harness. These are missing from the template, depriving consumers of the "why" and the proof behind the design.
*   **`023-harness-dogfood-claude-p-steering.md`**: Contains 5 paired trials detailing exactly how to steer `claude -p` effectively using the harness (flag sets, prompt templates, hard gates).
*   **`022-polyglot-monorepo-sensor-arc.md`**: Documents the real-world performance of the `sensors` slot across different languages and monorepo configurations (fan-outs, submodule ignores).
*   **`024-cha-extraction-swarm.md`**: Details the multi-agent swarm process used to extract the template, highlighting where autonomy failed and human framing was required.

## 2. Leverage Reviews (`docs/leverage-review/`)
The lab instituted regular architectural audits. The template lacks this practice and the specific findings.
*   **`2026-05-15-polyglot-template.md`**: Identified specific "headline gaps" in the template that may still be relevant or serve as a blueprint for future audits:
    *   Sentinels declared in manifests but not enforced in CI recipes.
    *   Missing integration/E2E test tiers (`tests/integration/otel-roundtrip.*`).
    *   Weak TypeScript strict-mode enforcement (missing `tsconfig.base.json` sentinels).
    *   Rust `#![forbid(unsafe_code)]` claimed in `Cargo.toml` but missing from source files.

## 3. Evolution Documents (`docs/evolution/`)
The lab tracks architectural shifts over time. These documents explain major capability unlocks.
*   **`v0.4.0-evolution.md`**: Explains the shift to a language-neutral allow-list OTEL processor and the 4-category `--evidenceMode` taxonomy. This context is crucial for users trying to understand the observability stack's design.

## 4. Experiments Index (`experiments/`)
The lab contains over 80 concrete experiment directories (e.g., `2026-05-13--logsql--token-efficiency`, `2026-05-13--visual-bug--e2e-video`, `2026-05-14--sentrux-signal-validity`).
*   While the template ships the `running-experiments` skill, it lacks these concrete examples. These raw experiments serve as a reference library for how to correctly formulate hypotheses, gather metrics, and write conclusions. Without them, users must learn the experiment structure from scratch.

## Recommendation
Selectively port the most instructional retrospectives (like `023` and `022`), key evolution summaries, and a curated subset of 3-5 high-quality experiments to serve as reference examples in the template. Establish a placeholder or standard for leverage reviews.