---
title: "AI coding has made CI a bottleneck, so we reworked ours to keep up"
author: "Mufeez Amjad"
publisher: "Linear"
source_url: "https://linear.app/now/ci-bottleneck-reworked"
published: "2026-09-21"
accessed: "2026-09-23"
content_type: "attributed-summary"
---

# Linear CI case study

Read for context behind the CI optimization recommendations and the original source.

Attribution: Mufeez Amjad, Linear. [Read the original article](https://linear.app/now/ci-bottleneck-reworked).
This is a selective paraphrased summary, not an archived copy of the article.

## Findings

Linear measured PR waiting time separately from runner consumption. Despite
substantial test growth, it reduced waiting and approximately halved runner time
per test.

- Improve prerequisite jobs: narrow checkouts, address stalled fetches, and move
  bookkeeping outside the merge gate.
- Reduce repeated setup through prepared images, scoped dependency installs,
  schema snapshots, and consolidation of short checks.
- Measure caches against rebuilding. Linear found one dependency cache slower
  to restore than a scoped installation.
- Balance test files before adding shards. Shared module state required explicit
  eligibility and cleanup; incompatible tests retained isolation.

## Use with this skill

Open this reference for the case-study context behind the optimization menu.
Consult the original for detailed measurements and implementation caveats.
Treat its results as hypotheses to test locally, not expected savings or
permission to weaken validation. [Return to CI Optimization](../SKILL.md).
