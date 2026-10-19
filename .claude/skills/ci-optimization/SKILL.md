---
name: ci-optimization
description: "Use when diagnosing slow CI or excessive runner costs, optimizing validation pipelines, reviewing caching and sharding, or comparing hosted and self-hosted runners. Deployment and release policy belong to continuous-delivery."
---
# CI Optimization

## Overview

Preserve the evidence required to merge while reducing waiting and resource use.
Keep repo-specific timings and conventions in calibration documents.

## Outcomes we are looking for

- Faster useful validation. Evidence: successful required-check completion times
  on equivalent workloads, plus time to the first actionable failure.
- Less resource waste. Evidence: runner consumption and actual billed cost,
  reported separately from elapsed time.
- Trustworthy validation. Evidence: unchanged coverage and isolation guarantees,
  plus passing cache-invalidation and merge-gate failure-path checks.

## Principles

### 1. Measure comparable work

Distinguish commit-to-required-check completion, first actionable failure, queue
and execution time, runner-minutes, and billed cost because they answer different
questions. Separate outcomes (successful, failed, cancelled, retried, skipped),
events (PR, main, release, scheduled), and cold versus warm caches; faster failure
is not faster successful validation. State dates and sample size, and record
runner OS, architecture, toolchain, dependency pins, test count, and cache outcome.
Reconstruct the merge-critical dependency path from job/step timestamps and logs,
including required checks in other workflows. Treat workflow update time as a
screening proxy, not exact merge latency.

### 2. Prove cache freshness and benefit

Key binary caches by source revision, compiler, target architecture, build
configuration, and relevant environment; source changes invalidate them even
without version bumps. Use broad fallback keys only for build inputs that the
build system revalidates. Inspect subsequent build logs because restoring a
directory does not prove compilation was avoided. Reusing test results requires
complete input identity, including dependencies, generated inputs, configuration,
and external services. Test both invalidation and reuse: file existence alone
proves neither freshness nor a passing suite.

### 3. Preserve every validation guarantee

Before removing duplicate checks, map the remaining owner of every guarantee,
so faster execution cannot silently omit coverage. Exercise the final gate with
failed, cancelled, and unexpectedly skipped required jobs, with explicit policy
for expected conditional skips. Cover shared dependencies, tool/config changes,
generated inputs, and submodule pins in path filters; unknown diffs must run
validation. Keep one truthful local entry point so splitting CI does not strand
checks outside local QA.

### 4. Reduce repeated setup before adding parallelism

Measure setup and test distribution before increasing shards, because each shard
replicates initialization and consumes concurrency. Balance work at the test
runner's actual scheduling unit, not an assumed unit. Retain test isolation unless
explicit eligibility and reliable cleanup establish safe state sharing, as in
[Linear's case study](references/ci-bottleneck-reworked.md).

### 5. Evaluate runners as an operational choice

Confirm current pricing and repository visibility before claiming savings;
compare throughput under concurrent PRs rather than one warm laptop run.
Include power, maintenance, queue contention, network, and cache lifecycle in
that comparison. On personal hardware, isolate disposable workers from home,
credentials, the Docker socket, and LAN because public PR code is untrusted even
without injected secrets. Verify platform and image architecture support:
native macOS cannot replace Linux service-container jobs. Explore runners when
requested, but obtain authorization before registering a persistent runner,
purchasing compute, or changing repository trust; a performance review alone
does not authorize those changes.

### 6. Return evidence that supports the claim

Provide baseline run links, the measured bottleneck and its share, ranked changes,
and validation results so another reviewer can assess the comparison.
Distinguish expected latency, resource, and correctness effects, labeling estimates
and unmeasured outcomes. Test failure paths and compare equivalent hosted runs
after deployment before claiming achieved speedups. Set a project-specific
budget and regression trigger because one team's target is not universal.

## Anti-patterns

- Claims of lower cost based only on wall time or runner-minutes.
- More shards without measuring replicated setup and available concurrency.
- Cache hits followed by full builds, or stale binaries accepted after pin changes.
- Required checks that pass when a prerequisite fails or is cancelled.
- Performance changes that weaken test isolation or remove gates without evidence.
- Hardware migration proposed before identifying where time is spent.

## Recommended tools and practices (as of 2026-09-23)

These candidates draw on [Mufeez Amjad's Linear case study](references/ci-bottleneck-reworked.md).
Validate them on the target workload; they are not promised speedups.

### Outcome: faster useful validation

- Use CI job/step timestamps to locate gating work, then narrow prerequisite
  checkouts and move bookkeeping off the merge path to reduce waiting.
- Compare runner and toolchain alternatives on identical workloads to determine
  whether compute or tooling limits feedback.
- Balance measured test execution units and split oversized files to reduce the
  slowest shard, rather than adding shards without a setup profile.

### Outcome: less resource waste

- Use suitable images, scoped installs, and batched short checks to amortize
  repeated setup; measure their transfer and maintenance costs too.
- Compare cache save/restore with rebuilding to identify caches that add work.
- Reuse unchanged initialization only when input identity and equivalence are
  established, so avoided work does not become stale validation.

### Outcome: trustworthy validation

- Exercise cache-hit, miss, and invalidation paths alongside gate failure paths
  to show the optimization preserves current-source validation.
- Use explicit state-sharing eligibility and cleanup checks; retain isolation
  for incompatible tests so throughput gains preserve test meaning.

## References

- [CI bottleneck reworked: Linear case study](references/ci-bottleneck-reworked.md): read on demand for the optimization menu's context and the original article link.
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions): verify current economics.
- [Self-hosted runner reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners): platform constraints.
- [Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use): runner trust boundaries.

For deployment and release policy, see [continuous-delivery](../continuous-delivery/SKILL.md).

## Continual improvement

Propose evidence-backed improvements at
https://github.com/syntropic137/software-leverage-points/blob/main/skills/ci-optimization/SKILL.md.
Follow the repository's authoring-skills guidance when changing these principles.
