---
name: purpose-and-scope
description: "Use when reviewing purpose-and-scope concerns: stated project purpose, declared in-scope and out-of-scope, non-goals, plan-purpose alignment, scope-creep within a single change, project-level bounded contexts, dependency-purpose linkage"
---

# Purpose and Scope

## Overview

A project's purpose is the anchor that every plan, PR, and dependency hangs from. Done well, the purpose lives in one canonical artifact, names goals and non-goals, and every plan traces back to it. Done poorly, contributors extrapolate purpose from code, scope creeps PR by PR, and the project quietly grows a second identity nobody signed up for.

**Core principle:** Purpose is stated in one canonical place, non-goals are stated alongside goals, and every plan or PR traces back to the stated purpose. Scope changes get the same explicit decision capture as architecture changes.

The deeper anchor, from Kanat-Alexander: **software exists to help people**. Every line that does not serve a stated user need is waste, and the cheapest place to refuse waste is at the scope decision before code is written. The non-goals list is the operational form of that refusal.

## Core Principles

### 1. The project has a stated purpose document (scope: projects with multiple contributors or external users)

This principle scopes to any project beyond a single-author throwaway: as soon as a second contributor or an external user appears, conceptual integrity needs an anchor. Solo prototypes inherit a weaker form (a one-line README is enough until someone else shows up).

When the scope applies: a written purpose statement names the problem, the users, and the non-goals. Without it, every contributor extrapolates from the code, and extrapolations diverge.

**Multiple valid locations exist for the purpose document:** README purpose section at the top, dedicated `PURPOSE.md`, project-charter `ADR-0001`, plugin manifest with a purpose field, repo description plus a linked doc. The principle is: pick one canonical home and link to it from the others. The red flag is "purpose lives in three places saying three different things," not "did not pick a particular file name."

### 2. Non-goals are stated alongside goals

Non-goals are the highest-leverage scope discipline. They prevent drift the README cannot otherwise prevent, because they let contributors notice when a plan has drifted toward something the project deliberately said it would not do. A project with goals but no non-goals leaves contributors no way to detect drift until after the work has shipped.

Quietly violating a stated non-goal is worse than never having stated it: future contributors trust the stated non-goal and the surprise is more expensive. If the non-goal is genuinely changing, change the document first.

### 3. Plans and PRs trace back to the stated purpose

Every plan or PR should answer: which user, which goal, which stated need does this serve? A plan whose motivation is "would be nice," "for completeness," or "while we are here" with no link to the purpose document is unanchored scope debt. It consumes the same review and maintenance budget as anchored work but produces no purposeful value.

The Lean stance is to call this waste and refuse it at the plan stage, before code is written.

### 4. Scope-creep within a PR triggers a decomposition decision (scope: any change above a project-stated line threshold)

This principle scopes to changes large enough that a reviewer cannot hold the full diff in working memory. Set an explicit threshold per project: a common starting heuristic is 400 lines changed across non-generated files. Below the threshold, mixed concerns are noise; above it, mixed concerns are a reviewability failure.

When the scope applies: one PR per axis of change. A PR titled "fix login bug" should not also reformat the codebase, refactor the auth module, and add a feature flag. The discipline is to extract the additional changes into their own PRs. If the additional work is genuinely valuable, it deserves its own scope decision.

### 5. New dependencies justify themselves against the stated purpose

A dependency is a permanent commitment and a supply-chain surface. Adding one without a purpose-link justification ("we needed X" with no reference to which user-facing or stated-purpose need it serves) drifts the project toward tool-of-the-week syndrome and bloats the dependency graph reviewers must reason about.

Cross-reference: see the [`dependencies`](../dependencies/SKILL.md) skill for supply-chain cost; this skill carries the purpose-linkage check.

### 6. Project-level bounded contexts are honored (scope: multi-context systems)

This principle scopes to systems large enough to plausibly contain multiple bounded contexts: a monorepo of services, a library that could absorb a CLI runtime, a data-pipeline repo growing a web UI. Single-context POCs inherit only the loosest form.

When the scope applies: each repo or top-level package evolves on its own clock with its own constraints. Blurring contexts (a "data pipeline" repo growing UI surface; a "library" growing a heavyweight runtime) collapses autonomy and forces every contributor to reason about both contexts simultaneously. Crossing the boundary deserves an ADR or a new repo, not a smuggled commit.

### 7. Scope changes get the same decision capture as architecture changes

When the project does decide to expand its scope, the change is captured the same way an architecture change is captured: a short ADR, a PR description that names the prior scope and the new one, or an update to the purpose document. Opportunistic scope creep ("since we are touching this area") that ships without capture is the failure mode this principle prevents.

## Red Flags - STOP

- No written statement of purpose; the README opens with install instructions but never names the problem the project solves or the users it serves
- No stated non-goals; the project's "we do not do X" is tribal knowledge, not a document
- Purpose lives in two or more places saying different things, with no canonical source linked from the others
- Plan or PR introduces a feature with no link to a stated user, problem, or goal in the purpose document
- New dependency added without justification against the stated purpose
- PR exceeds the project's stated change-size threshold and bundles multiple axes of change with no decomposition
- Out-of-scope work added "while we are here" with no scope-decision capture
- Stated non-goals quietly violated without updating the document first
- Project-level bounded contexts blurred (a repo absorbing a concern it was deliberately separated from) with no ADR

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "Everyone knows what this project does" | Until the third contributor extrapolates a different purpose and ships toward it |
| "Non-goals are obvious" | Until they are quietly violated and the surprise is expensive |
| "It's a small extra change, not worth its own PR" | Reviewability collapses in proportion to mixed scope; the extra change hides bugs |
| "We need this dependency, trust me" | The dependency outlives the trust; the justification is what makes it reviewable later |
| "While we are here, let me just fix this too" | Either it is in scope (then capture the expansion) or it is its own PR |
| "We can document the scope expansion later" | Later doesn't come; the scope drift is now invisible |
| "This repo can absorb that concern, it's all the same domain" | Until the two domains' release cadences collide |

## Key Patterns

```
✅ README opens with: "This project does X for Y users. Non-goals: A, B, C."
❌ README opens with install instructions and never names the problem
```

```
✅ Purpose lives in PURPOSE.md; README links to it; plugin manifest links to it
❌ Three docs say three different things about what the project is for
```

```
✅ Plan: "Implement bulk export. Serves goal G2 in PURPOSE.md."
❌ Plan: "Add bulk export. Would be nice for completeness."
```

```
✅ PR: "Fix login bug." Diff: only login fix. Refactor noted as follow-up PR.
❌ PR: "Fix login bug." Diff: fix + reformat + refactor + new feature flag.
```

```
✅ New dep PR: "Adds parquet support; required by goal G3 (analytical exports)."
❌ New dep PR: "Adds parquet; we needed it."
```

```
✅ Scope expansion: ADR-0007 "Project now also covers X; rationale; updates PURPOSE.md."
❌ Scope expansion: smuggled in via three PRs over a month, no capture
```

## Why This Matters

Purpose-and-scope is the cheapest leverage in the entire plugin. A one-paragraph purpose statement plus a non-goals list prevents an entire class of drift that no amount of code review catches downstream.

Without a stated purpose:

- Contributors extrapolate purpose from code; extrapolations diverge.
- Plans drift toward speculative or unanchored work; review budget burns on scope debt.
- Dependencies accumulate by inertia; the supply-chain surface grows without justification.
- Bounded contexts blur; one repo quietly becomes two.
- Releases get larger and rarer because each one carries unrelated concerns.

With a stated purpose and disciplined scope:

- Every plan answers "which goal" before writing code.
- PRs stay reviewable because each one names one axis of change.
- Dependencies are reviewable because each one is justified.
- Repos stay context-coherent; releases stay focused.
- Contributors (human and agent) calibrate to the project's actual identity, not to an extrapolation.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** a one-line README naming the problem and the user. Non-goals can be implicit. Awareness that the purpose document will need to be findable as the second contributor approaches.
- **Growing internal tool:** a real purpose section in the README, with goals and non-goals enumerated. New dependencies start carrying a one-line justification. PRs stay small enough that mixed scope is a smell.
- **Shared library:** purpose and non-goals are part of the published surface (README header, package metadata). Scope expansions are captured as ADRs because consumers need to reason about contract changes.
- **Production service:** dedicated purpose document linked from the README; bounded-context boundaries are explicit (this service does X, not Y); scope-expansion ADRs are routine; dependency additions are reviewed against the purpose.
- **Safety-critical:** purpose, scope, and non-goals are part of the release artifact and the certification record. Scope changes go through change control with sign-off; opportunistic scope creep is a process violation, not a style note.

## References & rationales

- **Frederick Brooks, *The Mythical Man-Month* (1975).** Backs principle 1 (stated purpose) and principle 2 (non-goals as conceptual integrity discipline). Conceptual integrity is named the most important consideration in system design; the purpose document is its cheapest possible anchor.
- **Mary and Tom Poppendieck, *Lean Software Development* (2003).** Backs principle 3 (plans trace to purpose). Eliminating waste means refusing unanchored features at the plan stage.
- **John Ousterhout, *A Philosophy of Software Design* (chapter 9, "Better Together or Better Apart?").** Backs principle 4 (scope-creep decomposition). The canonical argument that crammed scope makes a change unreviewable in proportion to the cramming.
- **Donald Reinertsen, *Principles of Product Development Flow* (2009).** Backs principles 3, 5, and 7. The cost of work-in-progress and the discipline of explicit acceptance criteria for every unit of work, including scope changes.
- **Eric Evans, *Domain-Driven Design* (2003), strategic patterns.** Backs principle 6 (project-level bounded contexts). Strategic context boundaries are deliberate decisions; crossing one deserves explicit capture.
- **Michael Nygard, ADR practice.** Backs principle 7 (scope-change capture). Architecture Decision Records generalize from architecture to scope: any consequential decision deserves the same lightweight capture format.
- **Andrew Gallant ("burntsushi") `PROJECT.md` conventions.** Backs principles 1 and 2. Canonical examples in popular Rust projects of explicit goals-and-non-goals documentation alongside the README.
- **Max Kanat-Alexander, *Code Simplicity* (2012).** Backs the core principle and Why This Matters framing. "The purpose of software is to help people"; complexity, unneeded features, and unanchored work are waste, and the scope decision is the leverage point for refusing them.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific tools and templates.

- **Purpose-document homes:** README header section, dedicated `PURPOSE.md`, `ADR-0001` as project charter, package metadata `description` plus a linked long-form doc, plugin manifest with a `purpose` field. Pick one canonical home.
- **ADR templates:** Michael Nygard's original short template, MADR (Markdown Any Decision Record) for richer structure, Y-Statements for one-line rationale capture. Any of these work; consistency within the project matters more than the template.
- **Non-goals format:** an explicit "Non-goals:" bulleted list in the purpose document; periodically reviewed when a scope expansion is proposed.
- **PR-size threshold:** a stated number (commonly 200-400 lines changed across non-generated files) plus a CI advisory or PR template line that prompts authors to decompose larger changes.
- **Scope-decision capture:** ADRs in `docs/adr/` (or `docs/decisions/`); PR description templates that include "scope" and "out of scope" sections; commit-message conventions (Conventional Commits) that surface scope-expansion intent.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/purpose-and-scope/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
