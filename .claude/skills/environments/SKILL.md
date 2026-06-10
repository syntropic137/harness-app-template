---
name: environments
description: "Use when reviewing environment concerns: dev/staging/prod parity, declarative environment manifests, build vs runtime separation, environment promotion path, secret-loader parity across environments, reproducible local setup, ephemeral / preview environments per PR with auto-teardown, data parity (shape-realistic seed and anonymized prod copies), mechanically enforced parity rules"
---

# Environments

## Overview

An "environment" is the substrate the code runs on: OS, runtime, dependencies, datastores, secrets, network. The leverage point lives at the boundaries between dev, CI, staging, and production. When the same artifact reproduces across all of them, deploys are routine and bugs are local. When environments drift, every promotion is a new experiment and production becomes the only place a class of bug can be observed.

**Core principle:** Environments are declarative, reproducible, and at parity. Variation between dev, staging, and production lives in config, not in code or in the environment's substrate.

## Core Principles

### 1. Dev/staging/prod parity (scope: systems with multiple environments)

This principle scopes to systems that run in more than one environment. When the scope applies: keep dev, CI, staging, and production as similar as feasible. Same OS family, same runtime version, same dependency lockfile, same datastore family. The smaller the gap, the smaller the class of bugs that hide in the gap.

A pure-local POC inherits a weaker form: there is only one environment, but the POC should not bake assumptions that block parity later (hard-coded local paths, dev-only init scripts, host-specific binaries).

Cross-reference: the [`developer-experience`](../developer-experience/SKILL.md) skill carries the local-dev-loop side of this concern. Dev stacks must be parameterized so parallel worktrees can run side-by-side without port or container-name collisions; the same parameterization pattern that enables parallel local work also enables ephemeral CI environments and review-app preview deploys.

### 2. Variation lives in config, not in business logic

Code that branches on `env == "production"`, on hostnames, or on cloud-metadata signals makes production a different program from dev. The path that runs in prod is the path no test exercises, so the first time anyone sees it is during an incident. Variation between environments belongs behind explicit feature flags or typed config (cross-reference: [`configuration`](../configuration/SKILL.md) skill), where the variation is visible, reviewable, and testable.

### 3. Build environment is isolated from runtime environment

The image, package, or bundle that ships to production carries only what the production process needs. Compilers, package managers, shell debuggers, test fixtures, and source maps belong to the build stage and stay there. Every extra binary in the runtime image is attack surface and forensic noise; minimal images make "what is running" answerable.

### 4. Environments are declared and reproducible from the repo

The environment is checked into the repo as declarative manifests: containerization, runtime version pins, infra-as-code, devcontainer or equivalent. A new contributor (or a new CI runner) reconstructs the environment from the repo without tribal knowledge. Without declarative environments, every machine drifts independently and "fix the environment" becomes a recurring tax.

**Multiple valid containerization approaches exist:** Docker / OCI containers, language-native image formats, or VM-based images. The principle is "declared and reproducible," not "use containers." Pick one and apply it consistently across the project.

**Multiple valid orchestration approaches exist:** managed Kubernetes, ECS-style services, Nomad, serverless functions, or single-host systemd. The choice is shaped by scale and operational appetite; the rule is "stated convention, applied uniformly," not a specific orchestrator.

### 5. Promotion path is explicit (scope: multi-environment systems)

This principle scopes to systems with more than one environment. When the scope applies: there is a documented, automated path that moves a change from dev through staging to production. Who promotes, what gates apply, which artifact moves, where rollback lives. Without an explicit path, every deploy is a snowflake and audits cannot answer "what is in prod and how did it get there." Cross-reference: the [`continuous-delivery`](../continuous-delivery/SKILL.md) skill owns the deploy mechanics; this skill owns the parity of environments the deploy traverses.

### 6. Single artifact promoted, not rebuilt per environment

The artifact built once on the integration commit is the artifact promoted through staging and into production. Per-environment rebuilds resolve dependencies fresh and produce binaries that are not bit-identical, so the artifact tested in staging is not the artifact in production. Build once, promote.

### 7. Secrets are loaded with parity across environments

Dev may read from a `.env` file, staging from a Kubernetes secret, production from a managed vault, but the loader, the variable names, and the shape are uniform. A missing prod-only secret should be detectable in dev. Cross-reference: see the [`configuration`](../configuration/SKILL.md) skill for the loader pattern itself and the [`security`](../security/SKILL.md) skill for secret-handling stance.

Cross-reference: the [`developer-experience`](../developer-experience/SKILL.md) skill carries the parallel-worktree side of environment parameterization (per-worktree namespacing of ports, container names, databases) so contributors can run multiple feature-branch stacks locally without collision; the same parameterization shape extends to ephemeral CI and review environments.

### 8. Ephemeral environments per PR, with auto-teardown (scope: systems with a deployable surface and a forge that supports preview deploys)

This principle scopes to systems where a per-PR ephemeral environment is technically feasible: a deployable artifact, a forge or platform that supports preview deploys (Vercel preview, Netlify, Render, Heroku review apps, Argo Rollouts preview, ephemeral Kubernetes namespaces). When the scope applies: every PR spins up an isolated environment running the proposed change, accessible to reviewers via a deterministic URL, with automated teardown on PR close or after a TTL.

The pattern composes with the parameterization stance from principle 1's cross-reference: the same `INSTANCE_ID`-shaped parameterization that lets parallel local worktrees run also lets ephemeral environments stand up without collision.

Auto-teardown is the often-skipped half. Spin-up without teardown produces a slow leak: stale environments accumulate, costs grow, abandoned environments become attack surface (unpatched, half-configured, sometimes still pointing at production data). The teardown trigger is a PR-close hook plus a TTL safety net (a daily reaper that closes any environment older than N days regardless), and the inventory is observable: a contributor or operator can list every live ephemeral environment without grepping cloud consoles.

Cross-reference: the [`continuous-delivery`](../continuous-delivery/SKILL.md) skill carries the deploy-mechanics side; this skill owns the parity property that makes the ephemeral environment a faithful preview rather than an alternate-reality test.

### 9. Data parity: dev/staging exercise production-shape data

Code parity is half of dev/prod parity. The other half is data shape: row counts, column distributions, foreign-key density, query plans. A development database with 50 hand-crafted rows runs queries that take milliseconds; the same query against the production table with 50 million rows takes minutes or returns malformed results because an unindexed column was tolerable at the dev scale. The "production-only" bug is often a data-shape bug masquerading as a code bug.

The discipline:

- **Schema migrations are tested against production-shape datasets**, not dev seed data. A migration that runs in 200ms on dev and locks the production table for 40 minutes is a discoverable failure if the test set is shape-realistic.
- **Seed data is realistic enough to surface query-plan differences**: distributions, cardinalities, and row counts approximate production within an order of magnitude where feasible.
- **Anonymized production copies (or synthetic data with realistic distributions) feed staging.** Anonymization preserves shape while removing the regulated content; the [`security`](../security/SKILL.md) skill carries the constraints on what can be copied and how.
- **Read replicas, sample queries, or shadow traffic** validate the staging-to-prod transition for query workloads that depend on data shape.

This principle scopes to systems where a database, search index, or other shape-sensitive datastore is part of the runtime. The red flag is "tests pass on a 100-row fixture; production has 100 million rows; nobody has tested that transition," not "did not adopt a particular anonymization tool."

### 10. Mechanically enforce parity rules as fitness functions (scope: rules the project commits to)

When the project commits to a specific parity rule (the `python` runtime version is identical across dev/CI/prod, the production image carries no compilers, the staging seed dataset is at least N rows, the prod-resolved dependency tree matches CI's), the rule belongs in CI as a fitness function: a script that fails the build when the rule is violated. A parity rule that lives only in `CONTRIBUTING.md` decays one PR at a time. The fitness-function pattern is the same shape adopted in `dependencies` (zero-runtime-dep checks, transitive-count caps), `types` (escape-hatch detectors), and `security` (security-rule enforcement). Cross-reference: the [`architecture`](../architecture/SKILL.md) skill's [fitness-functions deep-dive](../architecture/fitness-functions/README.md) for the broader framing; this skill carries the parity-specific instances (runtime-version diff, image-content audit, dependency-tree drift).

## Red Flags - STOP

- `if env == "production"` style branches embedded in handlers, services, or domain modules
- Different runtime versions or dependency lockfiles per environment (Node 18 in CI, Node 20 in prod; `requirements.txt` for dev and a separately resolved `requirements-prod.txt`)
- Production images that include compilers, package managers, shell debuggers, test fixtures, or source maps
- No declarative environment in the repo: no container manifest, no runtime pin, no devcontainer; onboarding is tribal-knowledge install steps
- No explicit promotion path from staging to production; deploys triggered ad hoc, no record of which artifact is currently where
- Different artifacts in staging vs production (rebuilds rather than promotes); no audit linking the prod artifact to the staging artifact that was tested
- Secrets injected with a different loader, variable shape, or naming convention per environment, with no parity audit
- Project supports preview deploys but has no auto-teardown: stale ephemeral environments accumulate, costs grow silently, abandoned environments become unpatched attack surface; nobody can list every live environment without grepping cloud consoles
- Schema migrations and slow-query tests run only against tiny dev fixtures; production-shape data is never exercised before the migration runs in prod
- Project commits to a parity rule (runtime-version match, image-content audit, dependency-tree drift, seed-data minimum) but enforces it only via reviewer attention; no fitness function in CI catches the violation

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "We'll containerize later" | Drift accumulates faster than parity is bolted back on |
| "It's just a small env-name check" | Untested branches concentrate in the branch that runs in production |
| "Staging is close enough to prod" | Close enough is what bites at 3am during the incident |
| "The tag we promoted is the same code" | Code is not artifact; rebuild can resolve a different transitive |
| "The dev secret is fine to differ in shape" | The shape mismatch fails on the prod-only secret, in production |
| "Prod has tools because we sometimes debug there" | Debug tools in prod are an attack surface and a forensic-noise generator |
| "Preview environments are spun up; teardown will happen eventually" | Eventually is when the cloud bill arrives; auto-teardown plus a reaper TTL is the durable answer |
| "Tests pass against the dev fixture, that's enough" | Production data has different shape; the "production-only" bug is usually a data-shape bug |
| "The parity rule is in our docs" | Docs decay; mechanically check it or expect drift |

## Key Patterns

```
✅ feature_enabled = config.bool("RISKY_FEATURE_ENABLED")
❌ if hostname.startswith("prod"): risky_feature()
```

```
✅ Multi-stage build: builder stage compiles; runtime stage carries only the artifact
❌ Single-stage image carries compiler, source, and test fixtures into prod
```

```
✅ Same artifact SHA promoted: dev → staging → prod; each stage references the same digest
❌ Each environment rebuilds from source; binaries differ; no provenance link
```

```
✅ Repo includes container manifest + runtime pin + devcontainer; clean clone reproduces env
❌ "Run npm install, then brew install postgres@13, then..." onboarding doc
```

```
✅ Documented promotion path: PR merge → CI artifact → staging deploy → manual gate → prod
❌ "Deploy by running this script on someone's laptop"
```

```
✅ Loader reads from a single config interface; backing store differs by environment
❌ Dev reads .env; prod reads Vault via different code path; rename breaks one path silently
```

```
✅ PR opens → preview env at https://pr-123.preview.example.com → PR closes → env auto-torn-down; daily reaper closes any env older than 7 days
❌ "We deploy a preview when reviewers ask"; stale environments accumulate; nobody knows which are still live
```

```
✅ Migration test runs against a 10M-row anonymized snapshot; the slow-query plan surfaces in CI
❌ Migration tested on 50 hand-crafted rows; production lock-out discovered at deploy time
```

```
✅ scripts/check-runtime-version.mjs diffs the python pin in pyproject.toml, the CI workflow, and the prod Dockerfile; CI fails on drift
❌ The pin is in three files; one falls behind; "works on my machine" returns
```

## Why This Matters

Environments are where the team's discipline meets reality. The cost of environment drift is paid every time a change moves between dev, staging, and prod, and it compounds: the longer drift is tolerated, the larger the class of "production-only" bugs grows, and the lower the team's confidence in any deploy becomes.

Without environment parity:

- Production-only bugs become routine; local repro takes hours and sometimes never works.
- Deploys are stressful events because each one re-discovers an environment difference.
- Onboarding takes days because the dev environment is reconstructed from tribal knowledge.
- Rollback is undefined because the previous environment state was never declarative.
- Compliance and audit cannot answer "what is in prod and how did it get there."

With environment parity:

- The artifact tested in staging is the artifact in prod; class of "drift bug" closes.
- New contributors and new CI runners reproduce the environment from the repo in minutes.
- Promotion is mechanical and auditable; rollback is the inverse of a known path.
- Production stays minimal: what runs is what was intended to run.
- Variation between environments is visible in config, reviewable, and testable.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** one environment (your laptop). A runtime pin checked in. Awareness that variation will need to live in config later, so no hostname branches.
- **Growing internal tool:** dev plus a single deployed environment. Declarative environment manifest checked in; runtime version pinned. Promotion path documented even if manual: which artifact, who pushes, where it lands.
- **Shared library:** library does not run in environments, but its CI matrix exercises supported runtime versions explicitly. Reproducibility of the build is the parity discipline that applies.
- **Production service:** dev, staging, and prod with declarative manifests for each. Build once, promote the artifact. Documented promotion path with automated gates. Secret loader uniform across environments. Multi-stage builds keep the runtime image minimal. Per-PR preview environments with auto-teardown; staging exercises production-shape data; committed parity rules backed by fitness functions in CI.
- **Safety-critical:** all of the above plus reproducible builds (bit-identical artifacts from the same source), attested provenance from build through promotion, parity audits as a recurring discipline, and game days that exercise the promotion and rollback paths on a calendar.

## References & rationales

- **The Twelve-Factor App, factor X ("Dev/prod parity").** Backs principle 1 (parity across environments). The foundational stance: keep dev, staging, and prod as similar as possible; treat divergence as drift.
- **Adam Wiggins on twelve-factor parity rationale.** Backs principle 2 (variation in config, not code). Frames the gaps that matter (time, personnel, tools) and why parity reduces them.
- ***Continuous Delivery* (Jez Humble and David Farley, 2010).** Backs principle 6 (build once, promote). The deployment pipeline as artifact promotion; same artifact through every environment.
- ***The Phoenix Project* (Gene Kim, Kevin Behr, George Spafford, 2013).** Backs principle 4 (declarative, reproducible environments). The parable of environment fragility and the cost of unowned setup.
- ***The DevOps Handbook* (Gene Kim, Jez Humble, Patrick Debois, John Willis, 2016).** Backs principle 5 (explicit promotion path). Flow, feedback, and how disciplined promotion replaces ad hoc deploys.
- **Reproducible Builds project (reproducible-builds.org).** Backs principle 3 (build/runtime isolation) and principle 6 (single artifact). Determinism as the basis for trust: same source plus same build environment yields a bit-identical artifact.
- **The Twelve-Factor App, factor X (parity extends to secrets).** Backs principle 7 (parity at the secret-loader boundary). Cross-reference the [`configuration`](../configuration/SKILL.md) skill for the loader pattern and the [`security`](../security/SKILL.md) skill for the handling stance.
- **Heroku Review Apps, Vercel Preview Deployments, Argo Rollouts preview pattern, GitHub deployments API.** Back principle 8 (ephemeral environments per PR with auto-teardown). The platform-native and forge-native instances of the per-PR preview-env pattern; the durable property is automated spin-up plus automated teardown, not the specific platform.
- **Database Reliability Engineering (Laine Campbell, Charity Majors, 2017).** Backs principle 9 (data parity). The framing that production data shape, not just code, is what tests must exercise before a migration ships.
- **Building Evolutionary Architectures (Ford, Parsons, Kua, Sadalage).** Backs principle 10 (fitness functions for committed parity rules). The mechanical-enforcement framing already adopted by `dependencies`, `types`, and `security`; cross-link to the [`architecture`](../architecture/SKILL.md) skill's deep-dive for the broader pattern.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific tools; if a tool here is no longer maintained, the patterns transfer to its replacement.

- **Containerization:** Docker / OCI images, BuildKit for multi-stage builds, distroless or chiseled base images for minimal runtime.
- **Local-environment reproducibility:** devcontainers, Nix flakes, mise / asdf for runtime version pinning, `.tool-versions` / `.nvmrc` / `.python-version` files.
- **Orchestration:** Kubernetes (EKS / GKE / AKS / self-hosted), Amazon ECS, HashiCorp Nomad, AWS Lambda / Cloud Functions / Cloud Run for serverless contexts.
- **Infra-as-code:** Terraform / OpenTofu, Pulumi, AWS CDK, Crossplane.
- **Secret stores (cross-reference `security` and [`configuration`](../configuration/SKILL.md) skilles):** HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager, sops with age or KMS, External Secrets Operator for Kubernetes contexts.
- **Cross-cutting:** SLSA provenance attestation for build/promotion integrity; cosign / sigstore for image signing.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/environments/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
