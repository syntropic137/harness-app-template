---
name: dependencies
description: "Use when reviewing dependency concerns: lockfile health, version pinning, immutable references, maintenance signals, transitive audit gates, monorepo version skew, reviewable lockfiles, license posture"
---

# Dependencies

## Overview

Dependencies are the part of the codebase the team did not write but ships anyway. Done well, the dependency graph reproduces deterministically, every reference is immutable, advisories are gated in CI, and license posture is documented. Done poorly, an unpinned transitive can change the build silently between two CI runs, and a moved tag can swap a maintainer without anyone noticing.

**Core principle:** The dependency graph is small, reproducible, reviewable, and audited. Provenance and integrity are joined; if you cannot answer where a dependency came from, you cannot answer whether it is safe to ship. Each dependency is presumed to need a justification, not the other way around: fewer, shallower trust relationships beat more, deeper ones, and lightweight entry points stay at zero.

## Core Principles

### 1. The lockfile pins what the manifest does not

A manifest declares the top of the graph; a lockfile pins everything beneath it. Without a committed lockfile, every install resolves the graph fresh, so two contributors (or two CI runs) install different transitive trees from the same manifest. Reproducibility, the precondition for both debugging and supply-chain auditing, is gone.

**Multiple valid pinning styles exist:** exact pins on direct dependencies, or ranges-with-lockfile. The principle is: the resolved graph reproduces deterministically. The red flag is "graph does not reproduce," not "did not pin every direct dep to an exact version."

**Multiple valid lockfile-commit policies exist:** always-committed (the conventional default), or CI-generated and verified. Either is defensible; pick one and apply it consistently.

### 2. No floating ranges without a lockfile

Caret, tilde, or wildcard ranges on direct dependencies in an ecosystem with no committed lockfile mean a transitive change in any sub-dependency can ship to production without anyone noticing. A floating range plus no lockfile turns external maintainers into uncredentialed committers on your build.

### 3. Every external mutable reference is immutable-pinned

This principle scopes to anything the project pulls from outside its own repo where the reference can be moved server-side: dependencies from a git URL or tarball URL, GitHub Actions in CI, container base images, and submodules. When the scope applies: pin to an immutable reference (a commit SHA, a content digest), not a tag or branch.

A tag can be moved. A branch certainly can. The XZ-utils backdoor (CVE-2024-3094, 2024) demonstrated the tag-repointing path against a CI Action: a maintainer with social-engineered trust silently moves the tag, and every repo using the tag executes attacker code on the next push with no diff in their own repository. The same mechanism applies to `git+https://...#main`, to `FROM debian:stable`, and to `git submodule` references that track a branch.

```yaml
# SAFE: SHA cannot be repointed; an update produces a reviewable diff.
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4

# UNSAFE: tag can be moved server-side overnight.
- uses: actions/checkout@v4
```

Cross-reference: the [`continuous-delivery`](../continuous-delivery/SKILL.md) skill carries the gate-enforcement side; this skill carries the immutable-reference shape that makes the gate trustworthy.

### 4. Track maintenance signals on direct dependencies

A direct dependency whose upstream has had no release in two years, is archived, has a single maintainer who has gone silent, or whose homepage 404s is a CVE incubator and a future incident. Trust shifts in projects whose maintenance signals have already degraded; the historical record is consistent on this point. Cross-reference: the [`purpose-and-scope`](../purpose-and-scope/SKILL.md) skill carries the upstream check on whether the dependency belongs in the project at all, which precedes the maintenance-signal check this skill carries.

### 5. Audit the transitive surface in CI

The bulk of vulnerabilities reachable from an application live in transitive dependencies the team never directly chose. A CI step that scans the resolved tree against an advisory database is non-negotiable for any project past the prototype stage. Without an audit gate, vulnerabilities accumulate silently between scans.

This principle scopes to projects with CI; cross-reference the [`security`](../security/SKILL.md) skill for the runtime-CVE side of the same gate, and the [`continuous-delivery`](../continuous-delivery/SKILL.md) skill for the gate-enforcement and pinned-action discipline that makes this audit step a reviewed and trustworthy step of the pipeline.

### 6. One version per dependency in a workspace (scope: monorepos)

This principle scopes to monorepos and workspace-style projects. When the scope applies: a given dependency resolves to a single version across all workspace packages. Version skew inside a single deployable unit means two copies of the same library ship together, doubling attack surface and silently changing behavior at module boundaries. Drift here also defeats license-audit and CVE tooling, which assumes one resolved version per name.

### 7. Lockfiles are reviewable

A lockfile is a code-review artifact: a reviewer must be able to tell whether a PR is bumping one patch version or quietly swapping a maintainer. Binary-only lockfiles save bytes but make the supply chain opaque to code review; a four-line dependency change and a four-thousand-line one look identical in `git diff`.

This principle scopes to ecosystems that admit binary lockfiles; in ecosystems with text-only lockfiles it is satisfied by construction. Where the scope applies, commit a paired text-format lockfile alongside the binary one.

### 8. License posture is declared and gated

License obligations are contractual; a copyleft transitive in a closed-source product can force disclosure or relicensing. A license audit step in CI, plus a documented allowlist or denylist, makes the obligation explicit. Provenance and licensing are joined: the same posture that answers "where did this come from" answers "are we allowed to ship it."

### 9. Quarantine new versions before adoption

Newly published versions of any dependency carry the highest probability of malicious or broken content per unit time. Account-takeover attacks, postinstall payloads, and accidental releases concentrate in the first hours-to-days after publish, before the wider ecosystem has a chance to surface advisories. A cooldown window (a hold of 48 hours to 1 week before a new version is allowed to land in the lockfile) buys the project the benefit of the rest of the ecosystem's scrutiny without writing any of it.

The mechanism is a constraint on the dependency-update bot, not a manual gate: Renovate's `minimumReleaseAge`, Dependabot's `cooldown`, or an equivalent. The constraint applies to every direct and transitive dependency, not just the ones the team thinks are risky. The litellm 1.82.8 incident (2026) and the Shai-Halud campaign (2025) both compromised packages where versions inside the cooldown window would have been quarantined long enough for the malicious release to be yanked before any production install picked it up.

A cooldown is not a substitute for the audit gate (principle 5); it is a multiplier on it. The audit catches what is known; the cooldown buys the time during which an unknown becomes a known.

### 10. Minimize the dependency surface; prefer shallow trees

Every dependency is a trust relationship; every transitive dependency is a trust relationship the team did not explicitly agree to. The durable answer to most dependency-related risk is fewer dependencies, not better ones, and shallower trees rather than deeper ones.

Heuristics that make this principle operational:

- **Zero dependencies for lightweight entry points.** Setup CLIs, install scripts, and other surfaces every user touches first should ship with no runtime dependencies at all. The supply chain risk on those entry points dominates the engineering cost of writing the few lines yourself. Field example: the `syntropic137-npx` setup package enforces a strict zero-dependency rule for exactly this reason. Cross-reference: the [`developer-experience`](../developer-experience/SKILL.md) skill carries the single-command-onboarding stance that makes setup CLIs valuable in the first place; the supply-chain stance here is what keeps that command trustworthy.
- **Prefer one-layer-deep over deep transitive trees.** A direct dependency that itself has zero dependencies (Zod is the canonical example) is materially safer than one that pulls in a hundred transitives. When evaluating two libraries that solve the same problem, the transitive count is a first-class signal. A package with three direct deps that pulls in 150 transitives is a red flag; a package that solves 80% of the problem with zero transitives is usually the right choice.
- **Plan dependencies at design time, not at coding time.** In the AI-assisted era, "I need this small utility" is no longer the same as "I need to add this package." A 50-line utility the project owns and reviews is safer than a package with hundreds of transitives. The default move is to write the helper, not to install the package; the package is the answer when the problem is large or genuinely shared.
- **Question heavy transitive trees.** `pnpm why <package>`, `uv tree --depth 3`, and equivalents make the tree visible. Any dependency that visibly inflates the tree should earn its keep; if the choice is between two libraries with similar value, the one with the smaller blast radius wins.
- **Watch for abandonware adjacency.** A direct dependency on a small, single-maintainer transitive is a maintenance bet whether the team made it explicitly or not. Cross-reference principle 4 (maintenance signals); the count and the maintenance posture compound.

This principle is not a vow of poverty; large, well-maintained dependencies (frameworks, runtimes, ORMs) earn their place. It is the default stance: each dependency is presumed to need a justification, and the justification is the question, not the answer. See [dependency-minimization/README.md](dependency-minimization/README.md) for the heuristics worked through with examples.

Where a project commits to a specific minimization rule (zero runtime dependencies for a setup CLI, maximum transitive depth of N for a library, a hard cap on transitive count), the rule is enforced as a fitness function in CI: a script that fails the build when the rule is violated. A commitment that is not mechanically checked is not a commitment, only an aspiration; the fitness-function move is what keeps the surface from drifting one PR at a time. Cross-reference: see the [`architecture`](../architecture/SKILL.md) skill's [fitness-functions deep-dive](../architecture/fitness-functions/README.md) for the broader framing; this skill carries the dependency-specific instances.

### 11. Block install-time and runtime code execution by default

Several ecosystems execute third-party code as part of installing or importing a package, before any of the project's own code runs. Each is a path by which a poisoned transitive can run arbitrary code with the privileges of the installing or importing user, including CI's secret-bearing token.

- **npm/pnpm/yarn `postinstall` and `preinstall` hooks** run on every package in the tree by default. A blanket block (`npm ci --ignore-scripts`) is right for projects that do not need native binaries. Where native binaries are legitimate (esbuild, sharp), an explicit allowlist (pnpm's `onlyBuiltDependencies`) is the smaller, auditable surface.
- **Python `.pth` files** placed in `site-packages` execute on interpreter startup, before any import. The litellm 1.82.8 attack used this path, which `--ignore-scripts` does not address (it is a Python runtime feature, not an install hook). The defense is hash verification (principle 12) and dependency minimization (principle 10), which together reduce the probability that a poisoned package reaches `site-packages` at all.
- **Python `__init__.py` injection** runs on first import. Same defense set.

Block-by-default is the rule; per-package exceptions are explicit and reviewed. The cost of a one-line review on a new exception is much smaller than the cost of one undetected postinstall payload reaching CI.

Cross-reference: the [`security`](../security/SKILL.md) skill carries the runtime-CVE and secrets-exposure side of supply-chain risk; this skill carries the install-time-execution side.

### 12. Verify content integrity, not only version

A version pin alone says "the resolver picked the artifact named X.Y.Z." It does not say "the bytes I am installing are the bytes that were reviewed when that version was added to the lockfile." If a package registry is compromised and the artifact for an existing version is replaced with a malicious one, version-only pinning installs the new bytes without complaint.

Hash verification closes that gap. Most modern lockfiles already record content hashes (`go.sum`, `Cargo.lock`, npm's `package-lock.json`, pnpm's `pnpm-lock.yaml`); the discipline is to use the lockfile-honouring install command (`npm ci`, `pnpm install --frozen-lockfile`, `cargo build --locked`, `go mod download` with `GOFLAGS=-mod=readonly`) and to fail closed if the hash does not match. For Python, `uv export --hashes` plus `pip install --require-hashes` provides the equivalent integrity check; without `--require-hashes`, missing hashes silently fall back to unverified installs.

Where the registry serves over HTTPS to a trusted certificate authority, the typical attack is not in transit; it is at the registry itself. Hash verification defends against both. Cross-reference principle 1 (lockfiles pin what the manifest does not): the hashes belong in the same lockfile that pins the version.

Cross-reference: the [`developer-experience`](../developer-experience/SKILL.md) skill consumes the setup-CLI / bootstrap pattern this skill documents (the syntropic137-npx zero-runtime-dep example), pairing the supply-chain stance with the single-command-onboarding stance for end-user-facing setup surfaces.

## Red Flags - STOP

- Lockfile not committed in an ecosystem that has one, or out of sync with the manifest
- Floating ranges on direct dependencies in an ecosystem with no lockfile pinning the resolved tree
- Git-URL or tarball-URL dependencies with no commit SHA (a tag or branch reference is not enough)
- GitHub Actions, container base images, or submodules referenced by mutable tag, branch, or `latest` rather than commit SHA or content digest
- Direct dependencies with no release in 24+ months, archived upstream, single-maintainer-gone-silent, or 404'd homepage
- CI configuration with no step scanning the resolved tree against an advisory database
- Dependency-update bot configured to land new versions immediately on publish (no cooldown / `minimumReleaseAge` window)
- Lightweight entry points (setup CLIs, install scripts, vendored bootstrappers) that ship with non-trivial runtime dependency trees
- A direct dependency that visibly inflates the transitive tree (e.g. brings 100+ transitives) when a lighter alternative exists, with no stated reason for the choice
- A stated minimization rule (zero deps, max tree depth, transitive count cap) that is not enforced by a CI fitness function; the rule decays one PR at a time
- `npm install` / `pnpm install` in CI without `--ignore-scripts` or a reviewed `onlyBuiltDependencies` allowlist
- Python install path with `pip install` rather than `pip install --require-hashes` against a hashed export, so a compromised PyPI artifact at a pinned version installs silently
- Monorepo where the same dependency resolves to multiple versions across workspace packages without a documented reason
- Binary lockfile committed without a paired text-format counterpart in an ecosystem that admits one
- No license audit gate in CI; no `LICENSES.md` or equivalent posture document; copyleft transitive shipped into a proprietary product without legal review

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "The manifest is the lockfile" | It is not; a manifest declares the top of the graph, the lockfile pins the rest |
| "We'll add the audit gate later" | Vulnerabilities accumulate between scans; later is not free |
| "The tag won't move" | Tags move; the historical record agrees |
| "The package hasn't been updated because it's stable" | Stable and unmaintained look identical from the outside; the difference is whether a patch ships if needed |
| "Version skew in the monorepo is harmless" | Two copies double the attack surface and break audit tooling |
| "The binary lockfile is fine; trust the diff" | Reviewers cannot review what they cannot read |
| "Licenses are a legal problem, not an engineering one" | The obligation is engineered when the dependency lands; legal can only triage what engineering exposes |
| "We need the latest version the day it ships" | The first 48 hours of a release are when malicious or broken content is most likely; the cost of waiting a week is much smaller than the cost of catching a poisoned release |
| "Just one more dependency for this small thing" | Each dependency is a trust relationship that compounds; the AI-era cost of writing the small thing is much lower than the lifetime cost of trusting a transitive tree |
| "We can't avoid postinstall hooks; we have native deps" | Allowlist the specific packages that need build steps; do not leave the door open for every transitive |
| "Version pinning is enough" | A registry compromise can serve different bytes for the same version; hash verification is the integrity check version pinning does not provide |
| "Fewer dependencies means reinventing the wheel" | Large, well-maintained dependencies earn their place; the principle is the default stance, not a vow of poverty |
| "We agreed on a zero-dep rule; everyone knows" | Without a CI fitness function checking the rule, the next contributor adds a dep with no review prompt and the rule is gone |

## Key Patterns

```
✅ Manifest + committed lockfile; clean install on a fresh machine reproduces the tree
❌ Manifest only; every install resolves fresh; transitive drift ships silently
```

```
✅ "foo": "^1.2.3" with a committed lockfile pinning the resolved subtree
❌ "foo": "*" or "^1" with no lockfile
```

```
✅ git+https://example.com/repo#abcdef0123456789... (immutable commit SHA)
❌ git+https://example.com/repo#main (branch, mutable)
```

```
✅ CI step: audit gate scans the resolved tree on every PR
❌ Audits run quarterly by hand, if at all
```

```
✅ Monorepo: lodash@4.17.21 across all workspace packages
❌ pkg-a uses lodash@4.17.20; pkg-b uses lodash@4.17.21; no stated reason
```

```
✅ Binary lockfile committed alongside text-format counterpart for review
❌ Only the binary lockfile is committed; PR diffs are opaque
```

```
✅ License allowlist enforced in CI; LICENSES.md tracks transitive license posture
❌ Licenses unaudited; first awareness of a copyleft transitive is in legal review
```

```
✅ uses: actions/checkout@11bd7190...683 # v4   (immutable SHA)
❌ uses: actions/checkout@v4                      (mutable tag; XZ-utils path)
```

```
✅ Renovate / Dependabot configured with minimumReleaseAge of 7d
❌ Bot lands every new version the hour it publishes
```

```
✅ Setup CLI / install script ships with zero runtime dependencies
❌ "Lightweight" entry point pulls in a 200-package transitive tree
```

```
✅ CI fitness function fails the build when package.json adds a runtime "dependencies" entry
❌ Zero-dep rule documented in CONTRIBUTING.md, never mechanically enforced; decays one PR at a time
```

```
✅ Adopt zod (zero transitives) over a similar library that pulls 50+
❌ Pick the first hit on the ecosystem search, accept whatever transitives come
```

```
✅ npm ci --ignore-scripts; pnpm install with explicit onlyBuiltDependencies allowlist
❌ npm install in CI; every transitive's postinstall hook runs in the secret-bearing job
```

```
✅ uv export --hashes ... | uv pip install --require-hashes
❌ pip install (no hashes); a registry-compromised artifact for a pinned version installs silently
```

## Why This Matters

Dependencies are where the supply chain meets the codebase. The cost of getting them wrong is paid in incidents (a moved tag, an unpublished package, a malicious update), in compliance exposure (a copyleft transitive in a SaaS), and in slow erosion (CVEs accumulating between manual scans).

Without disciplined dependency management:

- Builds reproduce only by accident; the same manifest installs different trees on different machines.
- Transitive vulnerabilities accumulate silently; the next CVE breach is the audit you did not run.
- Moved tags and abandoned upstreams turn external maintainers into uncredentialed committers.
- License obligations surface for the first time during a compliance review, with no remediation path that does not require legal.
- Monorepo version skew ships two copies of the same library and breaks audit tooling.

With disciplined dependency management:

- Every install reproduces the same tree; debugging and auditing both work.
- The advisory database is queried on every PR; CVEs surface with patches, not headlines.
- External references are immutable; what was built today rebuilds tomorrow.
- License posture is explicit and gated; obligations are engineered in, not discovered.
- Workspace packages share a single resolved version per dependency; tooling can keep up.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** a manifest exists; the lockfile is committed where the ecosystem provides one. CI Actions pinned to SHA from day one (the cost is low and the path-of-least-resistance habit sticks). No audit gate yet, but awareness that the supply chain becomes a concern as the project gets users.
- **Growing internal tool:** lockfile reviewed in PRs; first audit step in CI; install hooks blocked by default; abandoned-or-archived upstream check happens at least at upgrade time. Dependency-update bot configured with a cooldown window of several days. License posture is acknowledged even if not yet gated.
- **Shared library:** dependency surface kept narrow on principle; transitive count tracked. New direct dependencies are evaluated for maintenance signals and transitive depth before adoption. License audit gates new dependencies.
- **Production service:** committed lockfiles with content hashes verified in install (`--require-hashes` or equivalent); immutable references for every external source including CI Actions; advisory-database scan on every PR; install-hook allowlist explicit; cooldown window enforced; license allowlist enforced; monorepo version-skew detection in CI.
- **Safety-critical:** vendored dependencies with attested provenance; SBOMs generated and reviewed; supply-chain levels (build integrity, source integrity, provenance) explicit per dependency; cooldown windows extended; lightweight entry points (installers, bootstrappers) maintained at zero runtime dependencies; license obligations tracked per release artifact.

## References & rationales

- **The Twelve-Factor App, factor II ("Dependencies").** Backs principles 1 (lockfile pins the rest) and 2 (no floating without a lockfile). Explicit declaration and isolation; manifests pin the top of the graph, lockfiles pin the rest.
- **The 2016 left-pad incident.** Backs principle 2 (no floating without a lockfile). The canonical demonstration that floating ranges plus no lockfile turn external maintainers into uncredentialed committers on your build.
- **SLSA (Supply chain Levels for Software Artifacts) spec.** Backs principle 3 (immutable references for external sources). Source integrity at SLSA Build L2 and above requires immutable references as the precondition for build provenance.
- **The 2021 ua-parser-js, 2022 colors.js, and 2024 xz-utils incidents.** Back principle 4 (track maintenance signals). Each is a reference case for trust shifting in projects whose maintenance signals had already degraded before the compromise.
- **Snyk, *State of Open Source Security* (annual reports).** Backs principle 5 (audit the transitive surface). Empirical data showing that the bulk of reachable CVEs live in deps the team never directly chose; cross-reference the [`security`](../security/SKILL.md) skill for runtime-CVE handling.
- **OWASP Top 10 for Open Source Software (2024).** Backs principle 6 (one version per workspace) and provides the structured taxonomy for classifying findings (known vulnerabilities, unmaintained software, name confusion, unapproved changes).
- **Reviewable-lockfile rationale.** Backs principle 7. Binary lockfiles save bytes but make the supply chain opaque to code review; ecosystems with binary formats typically provide a paired text format precisely so that reviewers can read what they are approving.
- **Cassie Crossley, *Software Supply Chain Security* (2024).** Backs principle 8 (license posture is declared and gated). SLSA framing and provenance as the basis for both license and integrity posture.
- **The litellm 1.82.8 (2026) and Shai-Halud (2025) incidents.** Back principle 9 (cooldown) and principle 10 (minimization). Both exfiltrated credentials via transitive packages whose poisoned versions were live in registries for hours-to-days; a quarantine window plus a smaller dependency surface would have shrunk the attack window and the blast radius.
- **The XZ-utils backdoor (CVE-2024-3094, 2024).** Backs the broadened scope of principle 3 (mutable references) into the CI domain. The same tag-repointing mechanism that compromises a build dependency compromises a CI Action; the immutable-reference rule covers both.
- **The event-stream (2018) and ua-parser-js (2021) incidents.** Back principle 11 (block install-time code execution by default). Postinstall hooks ran in the secret-bearing context of every install, including CI.
- **PyPA / pip documentation on hash-checking mode.** Backs principle 12 (verify content integrity, not only version). `--require-hashes` is the discipline that makes a registry compromise at a pinned version detectable.
- **John Ousterhout, *A Philosophy of Software Design* (2nd ed., 2021), "deep modules."** Backs principle 10 (minimize the surface). A dependency is a module across an organization boundary; the same shallow-modules-are-bad / deep-modules-are-good calculus applies, with the additional cost that the maintainer is outside the trust boundary.
- **Field example: syntropic137-npx setup package.** Illustrates principle 10 (zero-dependency entry points). The setup CLI is the first surface every user touches; the strict zero-runtime-deps rule is justified by the supply-chain risk concentrating on first-touch surfaces.
- **Cross-reference: the [`architecture`](../architecture/SKILL.md) skill's [fitness-functions deep-dive](../architecture/fitness-functions/README.md).** Backs the enforcement clause of principle 10. A minimization rule is an architectural characteristic of the project; the same fitness-function discipline that keeps coupling and dependency direction enforced keeps zero-dep and tree-depth rules enforced.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific tools; if a tool here is no longer maintained, the patterns transfer to its replacement.

- **JS/TS:** `npm audit`, `pnpm audit`, `yarn audit`, or `bun audit` for advisory scanning; `license-checker` for license audits; `bun.lock` (text) committed alongside `bun.lockb` (binary) for reviewable lockfiles.
- **Python:** `pip-audit` for advisory scanning; `pip-licenses` for license inventory; lockfiles via `poetry`, `uv`, `pdm`, or `pip-tools` (`requirements.txt` with hashes).
- **Rust:** `cargo audit` (advisory database), `cargo deny` (license + advisory + duplicate detection); `Cargo.lock` always committed for binaries, optionally for libraries.
- **Go:** `go mod` with `go.sum` for resolved hashes; `govulncheck` for advisory scanning; `go-licenses` for license inventory.
- **JVM:** Maven Enforcer Plugin and OWASP Dependency-Check; Gradle's `dependency-locking`.
- **Cross-language:** SBOM generation (CycloneDX, SPDX); attestation tooling (in-toto, sigstore); dependency-update bots (Dependabot, Renovate) configured with a cooldown / `minimumReleaseAge` window of at least several days, and to surface upgrades for human review rather than auto-merging.
- **CI / Actions integrity:** SHA-pinning resolved with `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`; OSV Scanner action; dependency-review-action for PR-time gating; OpenSSF Scorecard for upstream posture signals.
- **Install-hook control:** `npm ci --ignore-scripts`, pnpm `onlyBuiltDependencies` allowlist in `package.json`, yarn `--ignore-scripts`. For Python, awareness that `--ignore-scripts` does not exist; the equivalent defenses are hash verification, dependency minimization, and isolation (pinned interpreter, ephemeral CI environment).
- **Dependency-tree review:** `pnpm why <package>`, `npm ls`, `uv tree --depth N`, `cargo tree`, `go mod graph`. `deptry` (Python) and `depcheck` (Node) for unused-dependency detection.
- **Hash verification:** `uv export --hashes` plus `uv pip install --require-hashes` for Python; `npm ci` (uses `package-lock.json` integrity field); `pnpm install --frozen-lockfile`; `cargo build --locked`; `go mod download` with `GOFLAGS=-mod=readonly`.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/dependencies/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
