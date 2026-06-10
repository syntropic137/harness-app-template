---
name: continuous-delivery
description: "Use when reviewing delivery concerns: DORA four key metrics, pre-merge gating, trunk-based development, fast feedback, single-artifact promotion, health-gated deploys, automated rollback, deploy/release decoupling via feature flags, deploy frequency, runbook freshness, deploy-credential scoping, pipeline bottleneck visibility, supply-chain attestation"
---

# Continuous Delivery

## Overview

Continuous delivery is the practice that makes software changes (features, configuration, bug fixes, experiments) deliverable to production safely, quickly, and sustainably, on demand. It encompasses the integration practices that keep the mainline always-green (the CI side) and the deployment practices that move tested artifacts into production safely and reversibly (the CD side), framed by the organizational disciplines that allow both to function. The leverage point lives in the entire path from `git commit` to "running in production with health signals confirming the change," not in either gate alone.

**Core principle:** The path from commit to production is automated, measured, and reversible. Integration is small-batch and gated against the full suite; deployment is health-gated and decoupled from release; performance is measured with the four DORA metrics and improved continuously.

This skill merges the integration and deployment concerns because in practice they share a substrate: the same pipeline, the same artifact, the same DORA metrics, the same supply-chain trust assumptions, the same fast-feedback discipline. Treating them as one prevents the false dichotomy of "we have CI but no CD" or "our deploy is mature but the gate is unenforced"; the system is only as good as its weakest stage.

## Core Principles

### 1. Measure delivery with the four DORA metrics, not output

The four metrics from `Accelerate` (Forsgren, Humble, Kim, 2018) are: **lead time** (commit to running in production), **deployment frequency** (proxy for batch size), **change failure rate** (percentage of deploys that cause incident or rollback), and **mean time to restore** (failure to recovery). They measure **outcomes, not output**: lines of code, story points, and feature counts are output and do not predict performance.

Distinguish two lead times: **design lead time** (concept to validated solution) is intrinsically variable and measured by hypothesis throughput; **delivery lead time** (committed code to running in production) should have low variance and is the metric this skill optimizes. Conflating the two causes teams to either over-engineer the design phase or under-invest in the delivery path.

### 2. Build quality in: shift left from inspection to prevention

Deming's third point (`Out of the Crisis`) states "cease dependence on inspection to achieve quality." Apply it: the goal is not to catch defects after the fact, but to make the system one in which defects are expensive to introduce. Pre-merge gates, type-checkers, lints, security scans, and unit tests run on every change before integration. Fast feedback at the moment of authoring beats slow feedback at release time by orders of magnitude in cost.

Cross-reference: the [`testing`](../testing/SKILL.md) skill carries the test-quality side of this discipline; the [`types`](../types/SKILL.md) skill carries the static side; the [`security`](../security/SKILL.md) skill carries the shift-left-on-security stance.

### 3. Pre-merge gating, enforced at branch protection (scope: PR-based workflows)

This principle scopes to repositories with PR-based or merge-request workflows. When the scope applies: required status checks (tests, lint, type-check, security scan) are configured at the branch-protection layer of the forge, not as advisory hints. The gate is policy: red cannot merge, admin bypass is not routine, and the configuration is itself reviewed code.

For repositories without PR-based workflows (single-developer prototypes, paired-trunk-only setups), the gate degrades to a pre-push or local-hook discipline; the principle is "the gate exists and is honored," not "branch protection specifically." CI runs on the change being proposed, not only on `main` after the fact: post-merge-only CI inverts the gating model and substitutes rollback for prevention.

### 4. Trunk-based development with small batches and short-lived branches

Reducing batch size is one of the central elements of the lean paradigm. From the brain-dump source `Accelerate` (p. 42-44): "reducing batch sizes reduces cycle times and variability in flow, accelerates feedback, reduces risk and overhead, improves efficiency, increases motivation and urgency, and reduces costs and schedule growth."

Concretely: branches are short-lived (under one day's work), integrated to trunk frequently, and each integration triggers the gate. The empirical case is unambiguous in DORA's *State of DevOps* reports: trunk-based development is one of the strongest predictors of delivery performance. Long-lived branches are the symptom; the disease is slow CI, large stories, or absent flag infrastructure forcing risk into the deploy itself.

### 5. Fast feedback on the gating path (scope: commit-gating CI)

This principle scopes to commit-gating CI (the path that gates a PR or merge). Target sub-10-minute median duration; over 20 minutes is a smell and erodes the practice CI exists to support. Parallelize, shard, cache dependencies, do incremental builds, and split fast tests from slow ones with a compensating gate (nightly full run, pre-merge full run) for the slow set.

Make pipeline duration a first-class observable: track p50/p95 over time, surface stage breakdowns and queue time, and identify bottlenecks the same way you would in a production system. A pipeline whose runtime drifts from 6 minutes to 14 minutes over six months is a measurable regression in the team's delivery capability.

Long-batch jobs (full-matrix, performance regressions, fuzz, mutation) inherit a different speed budget: their job is depth, not gating speed.

Cross-reference: the [`developer-experience`](../developer-experience/SKILL.md) skill carries the local-inner-loop side of the same fast-feedback discipline. The gate runs the same scripts the contributor runs locally (recipes-call-scripts, principle 5 there), so what passes locally passes the gate by construction.

### 6. Flaky tests are quarantined or fixed, not retried into green

A flaky test is either a bug in the test, a bug in the system, or a real race. Retries answer none of those questions and erode trust in the suite (developers stop reading failures, then stop running it locally). The discipline: detect flakes, quarantine them out of the gate so they cannot block work, and fix them on a tracked cadence.

Cross-reference: the [`testing`](../testing/SKILL.md) skill carries the test-quality side of the same discipline.

### 7. Everything that builds, tests, or deploys lives in version control

From `Accelerate` p. 71: "Our application code is in a version control system. Our system configurations are in a version control system. Our application configurations are in a version control system. Our scripts for automating build and configuration are in a version control system." The capability is binary: either every input the pipeline reads is versioned and reviewed, or some are not and the pipeline is not reproducible.

The pipeline's own configuration (workflow files, deploy manifests, IaC) is reviewed code: edits go through PR review, action references are pinned to immutable SHAs (not floating tags), runner images are pinned, and secrets are scoped. Unreviewed pipeline surface is the supply-chain hole.

Cross-reference: the [`configuration`](../configuration/SKILL.md) skill carries the typed-registry-as-source-of-truth stance for runtime config; the [`dependencies`](../dependencies/SKILL.md) skill carries the SHA-pinning discipline for action and base-image references; the [`security`](../security/SKILL.md) skill carries the secret-handling stance.

### 8. Build once, promote one artifact through environments

The artifact CI emitted on the integration commit is the artifact that staging tested and the artifact that ships to production. Per-environment rebuilds resolve dependencies fresh and produce binaries that are not bit-identical, so what was tested is not what was shipped. Build once; promote the artifact through environments by digest.

For high-stakes pipelines (externally distributed binaries, container images, anything that runs with privilege), emit provenance attestation, sign artifacts, and produce an SBOM. The chain from commit to artifact must be answerable downstream.

Cross-reference: the [`environments`](../environments/SKILL.md) skill owns the parity side of this discipline; the [`dependencies`](../dependencies/SKILL.md) skill carries the hash-verification stance for the inputs; the [`security`](../security/SKILL.md) skill carries the artifact-signing stance; the [`versioning`](../versioning/SKILL.md) skill carries the release-flow contract that names which commit becomes which version (trunk + release branch with a release-PR gate, tag-driven from trunk, release-please, etc.) so the promoted artifact has an honest version number.

### 9. Health-gated deploys with automated, exercised rollback (scope: reversible systems)

This principle scopes to systems where rollback is technically possible: the previous artifact is still available, no irreversible data migration has occurred, no external integration has been notified of a one-way change.

When the scope applies: the deploy step completes on "health endpoint returns OK and key SLOs are within bounds for N minutes," not on "process started." Process-start gating misses config errors, dependency unreachability, and latency regressions; health-gated deploys catch the regression at the deploy boundary, where automated rollback is still cheap. The rollback path is scripted, one-step, and exercised on a calendar (game day, staging drill, or recent real incident); runbooks rot silently between exercises.

For deploys that are intrinsically irreversible (forward-only schema migrations, one-way external calls), the discipline shifts to forward-fix rollouts plus stronger pre-deploy gating; the rollback principle does not apply, but the absence of rollback must be acknowledged in the runbook.

Cross-reference: the [`logging`](../logging/SKILL.md) skill determines what signals are available to gate on.

### 10. Decouple deploy from release with feature flags (scope: systems with flag infrastructure)

This principle scopes to systems where feature-flag infrastructure exists or is feasible. When the scope applies: risky changes ship dark behind a flag, then are gradually enabled for 1%, 10%, 100% of users (or per-tenant) with the abort path being a flag flip rather than a redeploy. Deploy is a technical act; release is a product act; conflating them concentrates risk.

For systems without flag infrastructure (small POCs, libraries with no per-user surface), the decoupling principle inherits a weaker form: stage risky changes in a deploy stream that can be reverted independently.

Cross-reference: the [`configuration`](../configuration/SKILL.md) skill carries the feature-flags-as-configuration stance and the default-on / X_DISABLED opt-out shape.

### 11. Deploy frequency, deploy strategy, and rollback mechanism are stated and consistent

Deploy frequency tracks commit frequency: a team committing daily but releasing weekly or monthly is batching risk. The empirical case from DORA is unambiguous: elite performers deploy on demand, recover faster, and have lower change-failure rates because each deploy carries less. (For systems with mandatory change windows, embedded firmware, or regulated releases, the principle is "deploy frequency matches what the rest of the system can sustain," not "deploy daily regardless.")

**Multiple valid deploy strategies exist:** blue/green, canary, rolling, recreate, feature-flag-gated rollout. **Multiple valid rollback mechanisms exist:** automated rollback to previous artifact, runbook-driven rollback, forward-fix-only with stronger pre-deploy gates, feature-flag flip. Pick one strategy per service class, match it to a rollback mechanism, apply uniformly across services in the project. The red flag is "no stated convention," not "did not pick canary."

### 12. Deploy credentials are scoped, short-lived, and rotatable

The deploy step runs with privileges over production. Credentials live in a scoped CI-side secret store, are rotated on a known cadence, and have the least privilege the deploy actually needs. Implicit credentials (developer laptop tokens, plaintext files in the repo, shared service accounts) cannot be rotated, audited, or revoked cleanly; a stolen laptop becomes a production breach. Prefer OIDC federation with short-lived workload identity over long-lived static tokens where the platform supports it.

Cross-reference: the [`security`](../security/SKILL.md) skill for the secret-handling stance; the [`dependencies`](../dependencies/SKILL.md) skill for the SHA-pinning discipline that keeps the credential-bearing surface small.

### 13. Continuous improvement and shared responsibility for the system's outcomes

From the DevOps Handbook's Three Ways (Kim, Humble, Debois, Willis): flow accelerates work from development to operations; feedback enables ever-safer systems of work; continual learning and experimentation foster a high-trust culture. Operationally: development optimizing only for throughput, testing only for quality, and operations only for stability is a department-goal failure pattern (Westrum's bureaucratic typology); these are system-level outcomes that require collaboration across all three to achieve.

Concretely for this skill: the four DORA metrics are visible to the whole team (not buried in dashboards only ops sees); incidents produce blameless postmortems with action items that close (not blame); the team allocates time to improve the pipeline itself (not just features that ride it). Improvement is daily work, not a quarterly initiative.

Cross-reference: the [`developer-experience`](../developer-experience/SKILL.md) skill carries the recipes-call-scripts discipline that keeps local and CI behavior identical (the same script invoked two ways), which is the precondition for fast, trustworthy feedback at the gate.

## Red Flags - STOP

- DORA metrics not measured at all, or measured but not visible to the team; team optimizes for output (story points, commit count) rather than outcomes
- Branch protection allows merging with red or missing CI; required checks are advisory, or admin bypass is routine
- CI runs only on the main branch (post-merge), not on pull requests
- Long-lived feature branches (multi-day, multi-week) integrating large batches; trunk integration is rare and painful
- Median CI duration on the gating path exceeds 20 minutes with no parallelization, caching, or measured trend; pipeline runtime drift goes unnoticed
- Flaky tests retried until green via opaque rerun mechanisms; no flake tracking or quarantine policy
- Workflow file edits land without PR review; runner images or action references are unpinned (floating tags)
- Different artifacts in staging and production (rebuilds rather than promotes); no audit linking the prod artifact to the staging artifact
- High-stakes pipelines emit binaries or images with no provenance attestation, no signing, no SBOM
- No automated rollback path; rollback under pressure is "log into the box and figure it out" or "redeploy the previous tag manually"
- Deploy step completes on process-start, not on health-endpoint plus SLO-within-bounds for a measured window
- Deploy frequency much lower than commit frequency, with no measured rationale
- Rollback runbook documented but not exercised in any game day, drill, or recent incident
- Deploy credentials read from plaintext files, depend on developer local credentials, or use long-lived shared tokens that cannot be rotated
- No stated deploy strategy or rollback mechanism; every service deploys differently with no convention
- The pipeline is owned by "ops" and its problems are not the dev team's problems (or vice versa); blameless postmortems are absent or ritualistic

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "We measure velocity / story points" | Output, not outcome; DORA metrics predict performance, velocity does not |
| "We'll fix the red on main next sprint" | Red on main accumulates; the gate is decoration once it is bypassable |
| "Long branches are how we ship big features" | Long branches batch risk and concentrate merge cost; small batches deliver big features faster |
| "The CI is slow because the suite is comprehensive" | Slow CI batches changes; batches concentrate risk; speed is a precondition |
| "Just rerun it, it passed last time" | Flakes are signal; retrying hides the signal |
| "It's just a workflow file change" | Workflow files run with secrets and publish rights; review them like code |
| "We rebuild for staging to keep the pipeline simple" | Simple pipelines that hide drift cost more than the simplicity saves |
| "Provenance is for paranoid teams" | The next supply-chain incident asks "where did this artifact come from"; provenance is the answer |
| "We can roll back manually if we need to" | Manual rollback under pressure is when ad hoc procedures fail; build it during the calm |
| "The process started, the deploy is fine" | Process-start says nothing about config, dependencies, or latency; gate on health |
| "A flag for that change is over-engineering" | The change was supposed to be safe; flags are how you find out cheaply when it is not |
| "We deploy weekly because that's our rhythm" | Rhythm is downstream of capability; small frequent deploys reduce risk per deploy |
| "The runbook hasn't changed" | The system around it changed; the runbook went stale silently |
| "The deploy token has been working for years" | Long-lived high-privilege tokens are the unrotated key in the broken-window neighborhood |
| "Pipeline performance isn't our problem" | The pipeline is the team's leverage; its bottlenecks are the team's bottlenecks |

## Key Patterns

```
✅ DORA metrics dashboard: lead time, deploy frequency, change failure rate, MTTR, visible team-wide, reviewed weekly
❌ Velocity chart in the standup; nobody knows the deploy frequency or MTTR
```

```
✅ PR workflow runs tests/lint/type-check/security; branch protection enforces required checks
❌ CI is "informational"; admin bypass is routine; red can merge
```

```
✅ Branches under 1 day; integrated to trunk; flag-wrapped behind dark launches
❌ Two-week feature branches; massive merge conflicts at the end; risky big-bang deploy
```

```
✅ Median PR CI under 10 minutes via test sharding + dependency cache + incremental build; p95 tracked
❌ 30-minute uncached CI; developers batch changes to amortize the wait; no duration trend
```

```
✅ Flaky test detected → quarantined out of the gate → tracked → fixed on cadence
❌ retries: 3 buried in workflow config; no dashboard; "just rerun"
```

```
✅ Workflow file edits go through PR review; uses: actions/checkout@<sha>
❌ uses: actions/checkout@v4 (floating tag); workflow edits self-merged
```

```
✅ artifact-sha-abc123 promoted from CI → staging → prod; same digest verifiable at each stage
❌ Each environment runs its own build; staging "passed" a different binary
```

```
✅ Release pipeline emits SLSA provenance, signed image, and SBOM
❌ Release pipeline produces a tarball; no signature, no SBOM, no chain to source
```

```
✅ Deploy gate: health endpoint OK + p99 latency within 10% of baseline for 5 minutes; automated rollback on breach
❌ Deploy gate: process exit code 0 from "service start"; rollback is a manual SSH session
```

```
✅ New payment path ships disabled; flag enables for 1% → 10% → 100%; abort is a flag flip
❌ New payment path wired into request path on deploy; abort is a full rollback
```

```
✅ Quarterly game day exercises rollback; runbook updated when the system changes
❌ Runbook last touched 18 months ago; nobody has run it
```

```
✅ Deploy uses OIDC-federated short-lived credentials scoped to the target environment
❌ Deploy uses a long-lived AWS access key checked into the repo or a shared dev laptop
```

## Why This Matters

Continuous delivery is the discipline that turns delivery from a high-stakes event into a routine, low-stakes activity. The cost of getting it wrong is paid at every release: in stress, in rollback ambiguity, in incidents that compound because recovery is uncertain, in slow CI that pushes teams toward larger less frequent batches (which makes everything worse), in mainline drift that erodes trust in any green signal.

Without disciplined continuous delivery:

- DORA metrics are not measured; the team cannot tell if it is improving or regressing.
- Mainline drifts red; the always-green invariant collapses.
- Long branches concentrate risk into rare big-bang releases; rollback is "what do we revert?"
- Flaky tests train the team to ignore failures; real failures hide among noise.
- Slow CI forces batching; batched changes concentrate risk and merge conflicts compound.
- Process-start gating misses regressions until customers report them.
- Risky changes ride deploys directly; the only kill-switch is rollback, and rollback is expensive.
- Workflow files become the soft underbelly of the supply chain.
- Runbooks rot quietly; the calm-day procedure does not survive the incident-day system.

With disciplined continuous delivery:

- DORA metrics are measured, visible, and improving; the team has shared evidence of capability.
- Trunk stays releasable; the deploy decision is "when," not "is it safe."
- Small frequent commits are cheap; integration risk stays bounded.
- Deploys are routine; small batches concentrate less risk; rollback is exercised and mechanical.
- Health-gated rollouts catch regressions at the deploy boundary, when automated rollback is still cheap.
- Flags decouple risk from deploy; risky changes validate under partial traffic with a flag-flip abort.
- The artifact tested in staging is the artifact in production; what was tested is what shipped.
- The pipeline itself is observed and improved like any other production system.
- The four DORA metrics move together in the right direction, year over year.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** local pre-push hook runs the test suite; deploy is "push to a single host"; rollback is "redeploy the previous commit." No PR workflow, no formal DORA tracking. Awareness that the next contributor or first external user triggers the maturity step that adds a PR gate and an automated reverse path.
- **Growing internal tool:** PR workflow runs tests, lint, type-check; branch protection enforces required checks; mainline-green invariant established. Workflow file edits go through review. Scripted deploy; documented (manual but stepwise) rollback procedure; health-check endpoint exists and the deploy step waits for it. Deploy credentials live in a scoped secret store, not on developer laptops. DORA metrics tracked informally (deploy frequency at minimum).
- **Shared library:** matrix runs across supported runtime versions and platforms; cache and shard to keep PR runs fast; flaky-test policy stated; first dependency-audit step added. Library publishes artifacts on tagged releases; provenance attested; rollback analogue is yank or supersede. The deploy concern is light because there is no running service.
- **Production service:** sub-10-minute gating path with p95 tracked; full-suite compensating gate scheduled; flake quarantine and tracking dashboard; pinned runner images and pinned action references; release pipeline emits provenance and signs artifacts; SBOM published. Automated rollback exercised quarterly; health-gated deploys with SLO bounds; risky changes flag-wrapped; build-once-promote pipeline; DORA metrics tracked and reviewed; deploy credentials short-lived and scoped via OIDC.
- **Safety-critical:** mutation testing and fuzz testing in the gate or as a compensating run; reproducible builds verified across runners; multi-party review for workflow file changes; supply-chain attestation at the highest level the platform supports. Pre-deploy canary analysis on real traffic, automated abort on SLO breach, multi-region progressive rollout, blast-radius limits enforced by the deploy platform, game days exercising the worst-case recovery on a calendar.

## References & rationales

- ***Accelerate: The Science of Lean Software and DevOps* (Nicole Forsgren, Jez Humble, Gene Kim, 2018).** Backs principle 1 (DORA four metrics, design vs delivery lead time), principle 4 (small batches and trunk-based development), principle 7 (everything in version control as the measured capability), and principle 11 (deploy frequency tracks commit frequency). The empirical link between delivery practices and organizational performance.
- ***The DevOps Handbook* (Gene Kim, Jez Humble, Patrick Debois, John Willis, 2nd ed.).** Backs principle 13 (Three Ways: flow, feedback, continual learning) and underwrites the framing that continuous delivery is sociotechnical, not purely technical. Westrum's organizational typology cited within informs the "everyone is responsible" stance.
- ***Continuous Delivery* (Jez Humble, David Farley, 2010).** The foundational text. Backs principle 2 (build quality in, the five CD principles), principle 8 (build once, promote one artifact), principle 9 (automated rollback), and principle 12 (deploy credentials scoped). The deployment-pipeline pattern at the heart of this skill.
- ***Continuous Integration* (Paul Duvall, Steve Matyas, Andrew Glover, 2007).** Backs principle 3 (CI runs on every change before integration) and principle 4 (mainline always-green against the full suite). The foundational text on integrate-early discipline.
- **Martin Fowler's *Continuous Integration* bliki article.** Backs principle 3 as the canonical short-form definition.
- **W. Edwards Deming, *Out of the Crisis*, 14 points for management (point 3).** Backs principle 2 (build quality in; cease dependence on inspection). The lean / TPS root that Humble and Farley adapt for software.
- **DORA's *State of DevOps* reports (2014-present).** Back principle 1 (the four metrics), principle 4 (trunk-based development as predictor), and principle 11 (deploy frequency). The longitudinal empirical record.
- **Trunk-based development (Paul Hammant, trunkbaseddevelopment.com).** Backs principle 4 (short-lived branches) and principle 5 (sub-10-minute gating). Short-lived branches require fast CI; the speed budget is derived from the practice it must support.
- **Google Engineering Practices, Testing on the Toilet on flaky tests.** Backs principle 6 (quarantine or fix, not retry).
- **SLSA framework (slsa.dev).** Backs principle 7 (reviewed pipeline configuration) and principle 8 (provenance attestation for high-stakes artifacts).
- ***Site Reliability Engineering* (Betsy Beyer, Chris Jones, Jennifer Petoff, Niall Richard Murphy, eds., Google, 2016).** Backs principle 9 (health-gated deploys, error budgets) and principle 10 (gradual rollouts via flags). Operational stance behind safe deploys.
- **Charity Majors on observability-driven deploys.** Backs principle 9 (health gating). Deploy is a question; observability is the answer.
- **LaunchDarkly and feature-flag pattern docs.** Back principle 10 (decouple deploy from release).
- **The Knight Capital incident (2012, $440M loss in 45 minutes).** Backs principle 9 (automated rollback) and the runbook-exercise discipline. The canonical bad-deploy parable: ambiguous rollback procedures plus a partial deploy plus a reused feature flag turned a routine release into a near-bankruptcy event.
- **Netflix Chaos Engineering (Casey Rosenthal et al.).** Backs principle 9 (rollback runbook exercised on a calendar). Verify recovery on a cadence, not on a pager.
- **Recent supply-chain incidents (codecov 2021, GitHub Actions tag-mutation 2024-2025, XZ-utils CVE-2024-3094).** Back principle 7 (workflow review and pinned references). Concrete demonstrations of the unreviewed-pipeline-surface attack class.
- **Ron Westrum, "A typology of organizational cultures" (2004).** Backs principle 13 (everyone is responsible). The bureaucratic / generative organizational typology that frames why department-goal optimization fails at system-level outcomes.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific tools; if a tool here is no longer maintained, the patterns transfer to its replacement.

- **DORA metrics tracking:** DevLake, Sleuth, LinearB, Faros AI, Swarmia, GitHub native insights, custom dashboards over forge APIs.
- **Workflow platforms:** GitHub Actions, GitLab CI, CircleCI, Buildkite, Jenkins, Drone, Tekton, Argo Workflows.
- **Pipeline observability and bottleneck detection:** Buildkite Test Analytics, Datadog CI Visibility, Trunk.io, Honeycomb for CI traces, native forge insights for stage-level duration breakdowns. For GitHub Actions specifically, the `gh run list --json` API or the workflow-job-completed webhook feeds a duration time-series.
- **Caching and acceleration:** native cache primitives per platform; remote build caches (Bazel, Turborepo, Nx, Gradle Build Cache); test sharding via runners' matrix features; incremental compilation in language toolchains.
- **Flake tracking:** Buildkite Test Analytics, Datadog CI Visibility, Trunk.io flaky-test detection, GitHub Actions test reporters.
- **Provenance and signing:** SLSA provenance generators, sigstore / cosign for artifact signing, in-toto attestations, syft / trivy / grype for SBOM generation, GitHub Actions artifact attestations.
- **Deploy platforms and GitOps:** ArgoCD, Flux, Spinnaker, Harness, AWS CodeDeploy, Kubernetes Deployments and Rollouts (Argo Rollouts for canary / blue-green primitives).
- **Release manifests:** Helm, Kustomize, Terraform / OpenTofu for infra, Pulumi, Crossplane.
- **Feature flags:** LaunchDarkly, Unleash, Flagsmith, Statsig, OpenFeature for the vendor-neutral SDK shape.
- **Health gating and SLO-aware deploys:** Argo Rollouts analysis templates, Spinnaker Kayenta canary analysis, Datadog deployment tracking, Honeycomb deploy markers, Prometheus + Alertmanager for SLO breach signals.
- **Credential scoping:** OIDC federation (GitHub Actions to AWS / GCP / Azure), HashiCorp Vault dynamic secrets, AWS IAM Roles Anywhere, short-lived workload identity bindings.
- **Game-day and chaos tooling:** Gremlin, Chaos Mesh, AWS Fault Injection Simulator, runbook-as-code platforms.
- **Workflow hardening:** pin actions to commit SHAs (Dependabot can rewrite tags to SHAs), use OIDC federation instead of long-lived secrets where the platform supports it, audit-log analyzers for workflow events.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/continuous-delivery/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
