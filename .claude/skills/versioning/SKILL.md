---
name: versioning
description: "Use when reviewing versioning concerns: declared scheme (semver/calver/ZeroVer), changelog hygiene, deprecation policy and migration paths, public-API stability classification, version-bump automation, manifest-drift across multiple files, release process (cut-a-release flow, release branches, release gates)"
---

# Versioning

## Overview

Versioning is the social contract a released artifact carries with its consumers. Done well, the versioning scheme is declared, the changelog names user-visible changes, deprecations precede removals, the public surface is explicitly classified, and version bumps cannot drift across manifest files. Done poorly, breaking changes hide behind patch bumps, the changelog says "various improvements," removals surprise consumers at upgrade time, and version edits drift between `package.json` and `pyproject.toml` because nobody automated the bump.

**Core principle:** Versioning is a stated contract, applied consistently, with deprecation as the bridge between accretion and breakage. The scheme matters less than the discipline of stating it and following it.

## Core Principles

### 1. Declare the versioning scheme; apply it consistently (scope: publicly-versioned APIs)

This principle scopes to artifacts versioned for consumers other than the producing team: published libraries, public APIs, deployable artifacts whose version consumers pin on. When the scope applies: the project declares which versioning scheme it follows, in `README` or release docs, and applies it without exceptions.

**Multiple valid versioning schemes exist:**

- **Semver (semantic versioning):** MAJOR.MINOR.PATCH; MAJOR for incompatible changes, MINOR for additions, PATCH for fixes.
- **Calver (calendar versioning):** YYYY.MM or YY.MM.PATCH; the version encodes when, not what.
- **ZeroVer (0.x.y permanent):** explicitly opting out of stability commitments; legitimate for projects that document the stance.

The principle is: state the scheme, apply it consistently, document the choice. The red flag is "no stated scheme" or "inconsistent application," not "did not pick semver." For semver specifically: a breaking change at minor or patch is a contract violation regardless of the changelog.

### 2. Changelog names user-visible changes per release (scope: any released artifact)

This principle scopes to any artifact with versioned releases (libraries, services with API versions, deployable artifacts with rollback semantics). When the scope applies: a `CHANGELOG.md`, release notes, or equivalent names the user-visible changes per release. Entries describe the user-facing impact, not the implementation detail.

**Multiple valid changelog formats exist:** Keep a Changelog (six categories: Added / Changed / Deprecated / Removed / Fixed / Security), conventional-commits-generated changelog, custom format, or release-notes paragraphs. The principle is: pick one, populate it with user-visible language, keep it current. The red flag is "various improvements" entries or empty release sections, not "did not use Keep a Changelog specifically."

### 3. Deprecate before removing; document the migration path

A function, flag, or config key removed in version N must have been marked deprecated in N-1 (or earlier), with a named removal version and a documented migration path. An undocumented removal forces every consumer to discover the change at upgrade time, often in production.

Deprecation is the bridge between accretion (safe to add) and breakage (not safe to remove). The deprecation discipline is one minor cycle of warnings before removal at the next major; that is the cheapest possible migration aid.

### 4. Public surface is explicitly classified

A library or API that exports every internal helper alongside its public types makes every export a de facto stability commitment. Naming the surface (whether by `@public`/`@internal` annotation, underscore prefix, an `__all__`/index file, or a documented stability list) is the prerequisite for honest semver: the maintainer can refactor internals safely only when "internal" is stated.

### 5. Version bumps are automated or scripted across all manifest files

A single source of truth (a `bump-version` script, a release-please bot, a workspace tool) keeps every manifest in lockstep with one command. Manual edits drift; drifted versions confuse consumers, package managers, and observability.

**Multiple valid bump mechanisms exist:** commit-driven automation (release-please, semantic-release based on conventional commits), tag-driven (`git tag` triggers a release pipeline), manual bump via a single script that updates every manifest. The principle is: one command updates every manifest. The red flag is "version field edited by hand in some manifests but not others," not "did not adopt release-please."

### 6. Commit-message convention supports release tooling (scope: projects with automated release tooling)

This principle scopes to projects using automated changelog or version-bump tooling that derives intent from commit messages. When the scope applies: a stated convention governs commit messages so the tool can categorize changes correctly.

**Multiple valid commit conventions exist:** Conventional Commits (`feat:`/`fix:`/`feat!:`), gitmoji, project-defined prefixes, or PR-label-driven categorization. The principle is: state the convention, enforce it (commit hook or PR check), let the release tool consume it. The red flag is "automation expects a convention but commits ignore it," not "did not use Conventional Commits."

### 7. Half-automation is worse than none

A `release-please` or `semantic-release` setup that bumps the version cleanly but produces a generic or empty changelog produces the appearance of release discipline without the content. If automation produces opaque entries, fix the commit messages, the config, or the categorization rule, do not ship the empty changelog.

### 8. The release process is part of the contract: state how a version is cut and gate it

Versioning is not only "what number goes next"; it is also "how does a commit become a released version." A project's release process belongs in the same SLP because the scheme cannot be honored without a flow that produces honest version numbers. The flow names: where active development lands, where the version bump happens, who or what gates it, and where the released artifact comes out.

**Multiple valid release flows exist:**

- **Trunk + release branch.** Active work merges to `main`; cutting a release means opening a PR from `main` into a long-lived `release` branch (or a `release/*` branch per major). The version bump and changelog finalization happen in that PR. The PR is gated by the full CI suite and any manual approvals before merging into `release`. Releases are then tagged and built off the `release` branch. This separates "is this safe to integrate" from "is this safe to ship," with the release-PR gate concentrating release-specific checks. This is a low-risk shape: trunk stays fast, release is deliberate, the bump is reviewed in one focused PR.
- **Tag-driven from trunk.** No release branch; cutting a release means tagging a commit on `main`. The tag-trigger workflow runs the release pipeline. Simpler; works well when trunk is always-green and every commit is shippable.
- **Release-please (or semantic-release) on trunk.** A bot maintains a long-running PR that accumulates the next version bump and changelog as commits land; merging that PR is the release. The bot enforces commit-convention-driven categorization.
- **Per-package versioning in a monorepo (changesets, Lerna).** Each package versions independently; the release flow batches version bumps per affected package.

The principle is: state the flow, document where the bump happens and what gates it, and apply it consistently. The red flag is "no stated flow" or "the flow exists but the gate is decorative" (the release PR merges with red, the tag is pushed without CI, the release-please PR is rubber-stamped). Without the gate, the version number is whatever the last person to push happened to write.

Cross-reference: the [`continuous-delivery`](../continuous-delivery/SKILL.md) skill carries the gate-enforcement and pipeline mechanics that make any of these flows trustworthy. Versioning sets the *contract*; continuous-delivery sets the *gate*. The release-PR pattern in the trunk + release branch shape is a specific instance of "gate the change against the full suite before it crosses a meaningful boundary," which is the same shape as the pre-merge gate the CD skill carries.

## Red Flags - STOP

- No stated versioning scheme; consumers cannot tell whether MAJOR-MINOR-PATCH means semver, calver, or something else
- Breaking change shipped at minor or patch under semver; signature changed, export removed, or config schema incompatibly altered without a major bump
- Changelog entries that say "various improvements," "internal cleanup," or "bug fixes" with no specific user-visible items, or release sections empty
- Deprecation removed without a prior warning release, or removed without a documented migration path
- Library or API exports every internal helper alongside its public types with no `@public`/`@internal` distinction or stability classification
- Version edited by hand in some manifest files but not others (`package.json` and `pyproject.toml` and `__init__.py` drifted)
- Project adopts conventional-commits or release-please but commit messages routinely ignore the convention; the changelog is a lie
- Project past its first production users still on `0.x.y` permanently with no documented stance on why and no plan to ship 1.0 (or to declare ZeroVer explicitly)
- No stated release flow: contributors cannot answer "how does a commit on `main` become a released version" without asking; the version-bump location, the release gate, and the artifact-build trigger are tribal knowledge
- Release flow exists but the gate is decorative: release PRs merge with red CI; tags are pushed without the full suite running; the release-please PR is approved without anyone reading the changelog diff

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "It's a small change, minor is fine" | Consumers pin on the contract; "small" at minor still breaks pinned builds |
| "Nobody reads the changelog" | The next person debugging a regression reads it; populate it for them |
| "We deprecated it in chat" | Chat is not a release artifact; the deprecation is in the warning released to consumers |
| "The version is in `package.json`, that's enough" | Until `pyproject.toml` and the docs site config drift; the public version is whichever consumer hits which manifest first |
| "0.x means we can change anything" | Real users are pinned anyway; the version is an honesty marker, not a license |
| "Conventional commits are too rigid" | Half-following them produces wrong changelogs; commit fully or pick a different convention |
| "Internal/public is obvious from context" | Until a refactor of "obvious internals" breaks a consumer that imported them; classify the surface |
| "We just tag main when we feel ready" | Without a stated flow and gate, the version number is whichever push happened to land first; document the trigger and the gate |
| "The release PR doesn't need full CI; main was green yesterday" | Yesterday's main is not today's release artifact; the release gate exists to verify the specific commit being shipped |

## Key Patterns

```
✅ README: "This project follows Semantic Versioning 2.0.0."
❌ No stated scheme; version 1.4.0 → 1.5.0 contains a breaking signature change
```

```
✅ ## [2.3.0] - 2026-04-28
   ### Added
   - `parseStrict` option on `validate()` rejects unknown keys
   ### Deprecated
   - `legacyParse()`; will be removed in 3.0.0; use `parse({ strict: true })`
❌ ## 2.3.0
   - Various improvements and bug fixes
```

```
✅ Version 1.x emits DeprecationWarning on `oldFn()`; 2.0 removes it; migration named in CHANGELOG
❌ Version 2.0 removes `oldFn()` with no prior warning; consumers discover at upgrade
```

```
✅ Public exports listed in index; internal modules underscore-prefixed; stability documented
❌ Every internal helper exported; refactoring internals breaks consumers
```

```
✅ One command bumps version in package.json, pyproject.toml, __init__.py, and docs config
❌ Version edited by hand in three manifests; one is forgotten; published version drifts
```

```
✅ Trunk merges to main; cutting a release: PR main → release with version bump; full CI + release-checklist gate; merge produces tag and artifact
❌ "Just push a tag whenever main looks good"; no release-PR review, no release-specific gate
```

## Why This Matters

Versioning is the contract every consumer reads when deciding whether to upgrade. The cost of getting it wrong is paid in broken downstream builds, surprise outages at upgrade time, and the slow erosion of trust that the version number means anything.

Without disciplined versioning:

- Consumers cannot pin safely; every upgrade is a roulette wheel.
- Breaking changes hide in patch releases and detonate at the worst times.
- Deprecations surprise consumers in production because nothing was announced.
- Internal refactors break consumers who imported "obvious internals."
- Manifest drift means the published version disagrees with itself.
- Half-automated release tooling produces opaque changelogs that consumers learn to ignore.
- The release flow is undocumented; cutting a version is a tribal-knowledge ritual; the bump and the gate happen in different places under different rules each time.

With disciplined versioning:

- Consumers know what a version bump means and can plan accordingly.
- Breaking changes carry a major bump and a documented migration path.
- Deprecations precede removals by at least one cycle, with named alternatives.
- Public surface is classified; internal refactors are safe by construction.
- Every manifest stays in lockstep with one command.
- The changelog is a release artifact consumers actually read.
- The release flow is documented and gated; cutting a version is a deliberate, reviewed act, not a guess about which commit was good.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** version field exists; the README states the project's stance (pre-release, no stability promised, or stated scheme). Awareness that consumers will need a changelog before the first external user.
- **Growing internal tool:** versioning scheme declared; changelog populated per release with user-visible entries; first deprecation discipline (warning before removal) established; version-bump script keeps manifests in lockstep.
- **Shared library:** public surface classified; deprecation policy documented in CONTRIBUTING; changelog follows a stated format; commit-message convention enforced; release tooling produces meaningful entries from commit messages.
- **Production service:** versioned API contract (URL prefix or header); breaking changes go through deprecation cycle; changelog reviewed before release; release tooling is automated; manifest drift is impossible by construction; release flow is documented (trunk + release branch, tag-driven from trunk, or release-please) and the release gate runs the full CI suite plus any release-specific checks.
- **Safety-critical:** version is part of the release artifact's signed manifest; deprecation cycles are formally tracked; migration paths are tested as part of CI; changelog is reviewed and approved as a release artifact, not generated and forgotten.

## References & rationales

- **Tom Preston-Werner, Semantic Versioning 2.0.0 (semver.org).** Backs principle 1 (declare and apply the scheme). The canonical semver contract: MAJOR for incompatible, MINOR for additions, PATCH for fixes. Section 4 covers the pre-1.0 license that principle 1's ZeroVer alternative names explicitly.
- **Olivier Lacan and contributors, Keep a Changelog (keepachangelog.com).** Backs principle 2 (changelog names user-visible changes). The canonical changelog format with six named categories and the discipline of user-facing language.
- **Rich Hickey, "Spec-ulation" (2016).** Backs principle 3 (deprecate before removing). The social contract of versioning: accretion and relaxation are safe, breaking is not, and deprecation is the bridge between them.
- **Andrew Hunt and David Thomas, *The Pragmatic Programmer*.** Backs principle 4 (classify the public surface). Stability and explicit versioning as design principles; the public/internal distinction as a precondition for honest evolution.
- **Conventional Commits (conventionalcommits.org).** Backs principle 5 (automated bumps) and principle 6 (commit-message convention). The commit-driven version-bump and changelog-generation hook.
- **Linus Torvalds, "we don't break userspace" (Linux kernel mailing list).** Backs principle 1 and principle 3. The upper bound of versioning discipline; the kernel's stability promise as the thought experiment for library maintainers deciding how strict their own contract should be.
- **David Heinemeier Hansson, on the cost of premature 1.0; the inverse argument on permanent 0.x.** Backs principle 1 from both sides. Both premature 1.0 and permanent 0.x are failure modes of the same axis: state the stance and apply it.
- **Vincent Driessen, "A successful Git branching model" (nvie.com, 2010), and Scott Chacon, GitHub Flow.** Back principle 8 (release flow is part of the contract) from opposite ends. Driessen's `develop` / `release` / `main` model and GitHub Flow's "branch off main, ship from main" both work; the principle is to pick a flow and gate it, not to pick Driessen's specifically.
- **Jez Humble and David Farley, *Continuous Delivery* (2010).** Backs principle 8 (release gate) from the deployment-pipeline side: a release is a specific build that passes a specific gate; the version number names the build that passed.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific tools; if a tool here is no longer maintained, the patterns transfer to its replacement.

- **Versioning schemes:** Semantic Versioning 2.0.0 (semver.org), Calendar Versioning (calver.org), ZeroVer (0ver.org for the explicitly-permanent-0.x stance).
- **Changelog formats:** Keep a Changelog (manually maintained with six categories), conventional-changelog generators (auto-derived from commit messages), towncrier (Python; per-PR snippets merged at release), changesets (JS/TS monorepos).
- **Release automation (commit-driven):** release-please (Google), semantic-release (commitlint + plugin ecosystem), changesets (per-package versioning in monorepos).
- **Release automation (tag-driven):** GoReleaser (Go), cargo-release (Rust), `npm version` plus a CI tag-trigger workflow.
- **Commit-message conventions:** Conventional Commits, gitmoji, project-defined prefix conventions enforced via commitlint or a pre-commit hook.
- **Public-surface classification:** TypeScript `@public`/`@internal` JSDoc tags via API Extractor; Python `__all__` plus underscore-prefix convention; Rust `pub(crate)` vs `pub`; Go's capitalization-as-visibility rule plus `internal/` directories.
- **Deprecation tooling:** language-native deprecation warnings (`@deprecated` JSDoc, Python `DeprecationWarning`, Rust `#[deprecated]`); migration-tool generators where the change is mechanical (codemods, `jscodeshift`, Rust's `cargo fix --edition`).

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/versioning/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
