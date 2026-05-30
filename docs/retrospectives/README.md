---
name: "Retrospectives — distilled"
description: "Index of distilled retrospectives for measurement-producing arcs in this template"
---

# Retrospectives

Distilled retros for the measurement-producing arcs that landed in this template. Each retro is the short version: what we ran, what we expected, what we found, what we changed, what's still open. For the per-experiment depth, follow the experiment-dir links inside each retro.

The full retro pattern (24 entries, themed across observability / sensors / cross-language / tooling / evidence / infrastructure) lives in the upstream lab at [`agentic-harness-lab/docs/retrospectives/`](https://github.com/NeuralEmpowerment/agentic-harness-lab/tree/main/docs/retrospectives). The lab's pattern is what this directory inherits; the operator's mid-task scope cut for `create-harness-app-n48.16` is that this template seeds with the *distilled* shape, not the full 24-doc port — see [`../gap-analysis/00-consolidated.md`](../gap-analysis/00-consolidated.md) for the reasoning.

## Index

| Retro | Verdict | Experiment / commit | Notes |
|---|---|---|---|
| [001 — `depcruiser-arch-quality`](./001-depcruiser-arch-quality.md) | **GO** | [`experiments/2026-05-30--depcruiser-arch-quality/`](../../experiments/2026-05-30--depcruiser-arch-quality/) | dep-cruiser produces meaningful per-folder/per-module Martin Ca/Ce/I → populated the sensors slot. |
| [002 — `ts-morph-adapter-chain`](./002-ts-morph-adapter-chain.md) | **GO** | commits `a893b33` (abstractness) + `2fc719e`+`487a1f0` (complexity) | One ts-morph install hosts both adapters; aggregator merges per ADR-0017's preservation rule. |

## Adding a retro

When a measurement arc lands (experiment with a verdict, or a feature that closes a fitness-function gap), distill it into a numbered file here using the slim format above. Aim for ~150 lines or less; for the full depth keep it in the per-experiment dir under `experiments/<date>--<slug>/`.

The naming convention is `NNN-kebab-case-topic.md`. NNN is the next unused three-digit number — never reuse, never renumber. Frontmatter carries APSS-style `name` + `description` + `status` (use `accepted` for landed retros; `proposed` is rare for retros).
