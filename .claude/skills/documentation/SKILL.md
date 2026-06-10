---
name: documentation
description: Use when reviewing documentation concerns: README presence and quality, public API documentation, ADR coverage for non-obvious decisions, inline rationale comments, TBD/placeholder hygiene in shipped docs
---

# Documentation

## Overview

Documentation is the artifact that lets new contributors (human or agent) join a codebase without reverse-engineering intent. It is also the only place architectural decisions survive once their authors leave. Without it, every onboarding becomes archaeology and every non-obvious choice gets relitigated.

Documentation serves **two audiences with different needs**: developers and agents working on the codebase (technical docs), and end users learning to install, use, or integrate with the system (user-facing docs). Treating them as one body of prose serves neither audience well.

**Core principle:** Documentation is a contract surface, separated by audience and kept honest by automation. The README, the technical docs in `docs/`, the user-facing docs in their own site, and the ADRs together encode "what this is supposed to do, who it is for, and why we chose it this way." Anything with a machine-readable source of truth (API spec, CLI help, schema) is generated from that source and drift-checked in CI; anything else is reviewed alongside the code that changes its claims.

## Core Principles

### 1. README explains purpose, install, usage

The README is the project's entry point. It must answer three questions in order: what is this, how do I install it, how do I use it. Without these three, a new contributor (or autonomous agent) has to reverse-engineer intent from code and tests.

The Diataxis framing names four documentation modes: tutorials, how-to, reference, explanation. The README is "explanation" plus a tutorial seed.

### 2. Separate technical docs from user-facing docs (different audiences, different homes)

Technical docs and user-facing docs serve fundamentally different audiences and have different lifecycles. Conflating them produces docs that are too detailed for end users and too shallow for contributors.

**Technical docs** are aimed at developers and agents working on the codebase. Content: architecture decisions, runbooks, contribution workflows, how-the-system-works explanations, internal API references, ADRs. They change when the code changes and travel with it in PRs. A common convention is a top-level `docs/` directory at the repo root, but the exact location is a project-level choice; the principle is co-location with the code, not the path name.

**User-facing docs** are aimed at end users, integrators, and consumers of the system. Content: installation, usage, tutorials, conceptual overviews, public API reference, troubleshooting for the deployed product. They are versioned with the public release surface, not with internal commits. A common pattern in monorepos is a separately-deployed docs package alongside the application packages; for smaller projects, hosting from a `docs/` source on Read the Docs or GitHub Pages can be sufficient. Again, the principle is the audience boundary, not the file layout.

**The README is the shared entry point** and points different audiences to different homes: a "Getting started" link aimed at users, a "Contributing" or "Architecture" link aimed at contributors. Without the split, every doc page tries to serve two audiences and serves neither well.

This is an L1 / generic statement of the principle. The exact paths, generators, and hosting choices are appropriate to pin at the L2 / per-repo level (where `skill-builder` calibrates conventions to the target system); concrete examples below are illustrative, not prescriptive.

### 3. Public APIs are the contract; document them (scope: contract surfaces only)

The public API surface IS the contract. Undocumented APIs become tribal knowledge. This principle applies to the contract surface only: private internals do not require external docs, though they may benefit from inline rationale comments.

A library, service, or module without documented entry points is not a platform; it is a private artifact someone published by accident.

### 4. Generate from a single source of truth; gate drift in CI

Anything with a machine-readable specification or interface should have its documentation **generated**, never hand-maintained in parallel. The spec is the source of truth; the docs are derived; CI fails the build when the two drift apart.

Concrete sources of truth and what they generate:

- **OpenAPI / Swagger spec** generates HTTP API reference, client SDKs, and request/response examples.
- **gRPC `.proto` files** generate service reference and client stubs.
- **GraphQL SDL** generates schema reference and explorer pages.
- **CLI `--help` output** (or a structured manifest) generates CLI reference pages.
- **Source code with type annotations and docstrings** generates SDK / library reference (Sphinx autodoc, TypeDoc, rustdoc, godoc).
- **Configuration schemas** (JSON Schema, Pydantic models, typed structs) generate config reference.

The discipline is two-step: **generate** on every change, and **drift-check** in CI. The drift check is a documentation-accuracy fitness function: regenerate the docs from the source of truth, diff against committed output, and fail the build on mismatch. Without the gate, generation drifts back into "we'll regenerate when we remember." See [`../architecture/fitness-functions/README.md`](../architecture/fitness-functions/README.md) for the broader fitness-function pattern this applies.

This principle does not apply to prose docs that explain *why* something exists (ADRs, conceptual overviews, tutorials). Those have no machine-readable source of truth; they are written and reviewed by humans. The principle applies to the *reference* layer: anywhere the doc claims something checkable, the check should run.

### 5. ADRs capture non-obvious decisions

Decisions made informally evaporate. The next person sees only the result and cannot tell deliberate from accidental. Architecture Decision Records capture context, decision, and consequences at the moment of choice.

**Multiple valid layouts exist:** `docs/adrs/`, `docs/architecture/decisions/`. Multiple valid templates exist: Nygard, MADR, custom. The principle is: pick one location and one template and stay consistent within the project. The red flag is "no stated convention," not "did not pick MADR."

**Code back-references the ADR using the ADR's exact filename**, so the link is greppable. When the ADR file is `docs/adr/0042-postgres-to-cockroach.md`, the back-reference comment in the code names the exact slug `0042-postgres-to-cockroach`. The discipline pays off during refactors: `grep -r 0042-postgres-to-cockroach` returns every file that implements the decision, which is the only mechanically-reliable way to find them. Free-text back-references ("see the database ADR") cannot be grepped, drift silently, and lose the receipt.

### 6. Inline comments explain why, not what

The code already says what it does. A reader (human or agent) can read the code. Inline comments should carry the load only the code cannot: the **why**. Why this approach was chosen over an obvious alternative, why a constant has the value it does, why a workaround exists, what hidden constraint or invariant the function preserves, which ADR a load-bearing decision back-references.

**Default to no comment.** Add one when removing it would confuse a future reader. Don't restate the function name. Don't narrate loops. Don't describe what the next line clearly says.

**The agentic-coding case.** Inline why-comments matter more, not less, when AI agents read the code routinely. Agents rebuild context from what they see in the file; a comment naming a non-obvious constraint or a deliberate-but-odd choice keeps the agent (and the human) from inadvertently violating it on the next change. Without the comment, the agent has only the code to reason from, and the code does not say *why*. With it, the rationale travels with the code at the point of edit.

**Stale comments are worse than no comments.** Comments that describe code that has since changed are actively misleading. Treat comments as part of the code under review; prune them when they go stale; never let "the comment said it would do X" mislead the next reader.

For comments that anchor to architectural decisions, use the back-reference discipline from principle 5 (exact ADR filename for greppability).

### 7. No TBD or placeholder text in shipped docs

TBD is a debt marker that ages poorly. Placeholder text in shipped docs signals either incomplete thought or abandoned intent. Either resolve the placeholder or remove the section.

## Red Flags - STOP

- README missing one of: purpose, install instructions, usage example
- Technical and user-facing docs interleaved with no audience separation; one set of pages tries to serve developers and end users at once
- User-facing docs missing entirely for a system with external consumers (the README is the only artifact)
- Public API surface with no doc strings, no examples, or no reference page
- Hand-maintained API or CLI reference pages parallel to a machine-readable spec (OpenAPI, `.proto`, `--help` output) with no generation pipeline
- Generation pipeline exists but no CI drift check; regeneration happens "when someone remembers"
- Architectural decision made (database swap, framework change, new service boundary) with no ADR and no rationale comment in the diff
- TBD, TODO, XXX, or placeholder text in shipped documentation
- ADRs scattered across multiple locations with no stated convention
- Code implementing a load-bearing decision with no back-reference to its ADR; or back-references that use free text instead of the exact ADR filename, breaking greppability
- Doc strings that restate the function name instead of explaining intent or contract
- Inline comments that describe what the code does (the code already says that) rather than why it does it
- Stale comments that no longer match the code they sit next to (actively misleading; worse than no comment)

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "The code is self-documenting" | Code documents the what, not the why; rationale only lives in prose |
| "We'll write the README later" | Later doesn't come; the next contributor pays the cost first |
| "ADRs are bureaucracy" | ADRs are receipts for decisions; without them, the same decision gets relitigated |
| "TBD is fine, we'll fix it before release" | TBD ships; release pressure ensures it |
| "Internal APIs don't need docs" | They do once a second consumer appears, which is always sooner than expected |
| "The wiki has it" | Wikis decay faster than READMEs; co-locate with the code |
| "Technical and user docs are basically the same thing" | They serve different audiences with different needs; merging them serves neither |
| "We can hand-maintain the API reference, it doesn't change much" | It changes more than you remember; hand-maintained reference is drifted reference |
| "We regenerate the docs before each release" | "Before release" turns into "after the customer reports the bug"; gate it in CI |
| "The OpenAPI spec is the source of truth, the docs are just a copy" | A copy that nothing checks is a fork; treat generation + drift check as one mechanism, not two |
| "The ADR is in the docs, the code doesn't need to reference it" | Receipts unreachable from code rot; the back-reference is what keeps the rationale alive at the point of edit |
| "We can write 'see the database ADR' in the code" | Free-text references cannot be grepped; use the exact ADR filename so refactors can find every implementing file |
| "Comments are clutter, the code should speak for itself" | Code says what; the why lives only in prose. Default to no comment, but write one when the why matters |
| "The comment is wrong but the code is right, we'll fix it later" | Stale comments mislead the next reader (and agent); fix or delete now |

## Key Patterns

```
✅ README: # Project / What it is / Install / Usage / Link to docs/
❌ README: # Project / (one paragraph from the original PR description, two years stale)
```

```
✅ Public function has docstring: contract, parameters, return, raises, example
❌ Public function has docstring: "Does the thing." (restates the name)
```

```
✅ Database swap → new ADR docs/adr/0042-postgres-to-cockroach.md (context, decision, consequences)
❌ Database swap → diff only; rationale lives in a Slack thread that will expire
```

```
✅ // Why: vendor API rate-limits at 10rps; batch to stay under
❌ // Iterate over items and call the API for each
```

```
✅ # Implements ADR 0042-postgres-to-cockroach (greppable: 0042-postgres-to-cockroach)
❌ # See the database ADR for context
```

```
✅ Single ADR convention: docs/adr/NNNN-kebab-case.md, Nygard template
❌ Half the ADRs in docs/adr/, half in docs/decisions/, half in Confluence
```

```
✅ Technical docs (runbooks, ADRs, contributor guide) and user-facing docs (install, usage, public API reference) live in distinct, navigable homes; the README points each audience to its home
❌ One docs tree mixing onboarding for engineers and tutorials for end users; nobody finds what they need
```

```
✅ openapi.yaml is committed; CI regenerates the API reference and fails on drift
❌ openapi.yaml is committed; the API reference is hand-edited and three versions behind
```

```
✅ CLI reference page generated from `mycli --help` recursively; CI fails if generated output differs from committed
❌ CLI reference page hand-written and updated whenever someone remembers
```

## Why This Matters

Documentation is the artifact that survives turnover. Every other artifact (code, tests, infrastructure) describes the current state; documentation describes the intent. When the team changes, the intent is the part that walks out the door first unless it was written down.

Without real documentation:

- Onboarding stalls; new contributors reverse-engineer intent from code.
- Decisions get relitigated because no one remembers why they were made.
- Public APIs become guess-and-check, which leaks abstractions and breaks consumers.
- Placeholder text accumulates; trust in the docs erodes; people stop reading them.
- One audience's needs swamp the other's; user docs become too internal, technical docs become too shallow.
- Generated reference drifts from the source of truth; users follow the docs and hit errors the spec would have prevented.

With real documentation:

- New contributors are productive in days, not months.
- Decisions stay decided; ADRs are the receipts.
- The contract surface is legible; consumers integrate without source diving.
- Docs are trusted because they are kept current.
- Technical and user-facing docs each serve their audience well, navigable from the README.
- Generated reference is checked on every commit; users can rely on what they read.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** a one-paragraph README stating purpose and how to run it. No ADRs yet; decisions are still fluid. No user-facing docs site yet; there are no external users. Public API docs are not yet relevant.
- **Growing internal tool:** README expands to purpose, install, usage, and a "how it works" sketch. First ADRs appear in the project's chosen location for the choices that already feel load-bearing. Public functions used by another module gain docstrings. If the tool has external consumers, the first user-facing pages appear (a separate site may still be overkill at this stage).
- **Shared library:** full reference documentation **generated** from source (autodoc / TypeDoc / rustdoc / godoc) with a CI drift check; usage examples live alongside the reference. ADR directory is established with a stated convention. Every public function has a docstring stating contract, parameters, and example. A user-facing site (or a clearly-separated user-facing section) appears with installation and usage tutorials.
- **Production service:** runbook lives next to the code. ADRs cover every load-bearing decision. User-facing docs live in their own site, deployed independently, versioned with the public release. OpenAPI / proto / CLI specs are committed; reference docs generated from them with CI drift checks. Onboarding doc walks a new engineer from clone to first PR. Documentation is reviewed in PRs, not as a separate task.
- **Safety-critical:** documentation is part of the release artifact and is reviewed by a second pair of eyes. Every change to a documented contract requires a doc-and-ADR update in the same PR. The drift-check fitness function is a release gate. Regulatory documentation (audit trails, change logs) is generated from the same source of truth as the rest of the reference layer.

## References & rationales

- **Daniele Procida, Diataxis framework.** Backs principles 1 and 2. The four-mode taxonomy (tutorials, how-to, reference, explanation) and the audience-aware framing that motivates separating technical from user-facing docs; each mode serves a different user need.
- **Steve Yegge, "platforms over products" memo (2011).** Backs principle 3 (public APIs are the contract). Argues that an undocumented API is not a platform; it is a private artifact.
- **OpenAPI Initiative specification (current version).** Backs principle 4. Canonical example of a machine-readable interface specification serving as the single source of truth from which reference docs, client SDKs, and request/response examples are generated.
- **Neal Ford, Rebecca Parsons, Patrick Kua, and Pramod Sadalage, *Building Evolutionary Architectures* (2nd ed., 2023).** Backs principle 4 (drift checks as fitness functions). Documentation accuracy is an architectural characteristic; the drift check is its fitness function. See [`../architecture/fitness-functions/README.md`](../architecture/fitness-functions/README.md).
- **Michael Nygard, "Documenting Architecture Decisions" (2011).** Backs principle 5 (ADRs for non-obvious decisions). The canonical ADR template (context / decision / consequences) and the case for capturing rationale at the moment of choice.
- **John Ousterhout, *A Philosophy of Software Design* (2018), chapter 12.** Backs principle 6 (no TBD in shipped docs) and the inline-comment-as-rationale discipline. Comments should explain what the code cannot say for itself, namely the why.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific tools; if a tool here is no longer maintained, the patterns transfer to its replacement.

- **User-facing doc sites:** Fumadocs is the primary recommendation in this ecosystem (modern, polished, well-suited to product/SDK docs). Docusaurus is a serviceable alternative with a deep feature set but less polished defaults. Mintlify is a quality docs-as-a-service option; capable, but cost is non-trivial and lock-in is a real consideration.
- **Technical / project doc sites (in-repo):** MkDocs (with Material theme) and Sphinx are the established defaults; Astro Starlight and mdBook are good lightweight alternatives.
- **API reference generation:** OpenAPI / Swagger as the source of truth for HTTP APIs (with Redoc, Swagger UI, or Scalar to render); language-native tools for SDK reference (Sphinx autodoc for Python, TypeDoc for TS, rustdoc for Rust, godoc for Go, JSDoc for JS).
- **CLI reference generation:** Cobra / Click / Typer / Clap each ship help-output capture; `cog` and language-specific equivalents wire generated CLI reference into the doc site. The drift check is a `git diff --exit-code` against the regenerated output.
- **ADR tooling:** `adr-tools` (Nygard's CLI), `log4brains`, MADR template, plain markdown in `docs/adr/`.
- **Internal developer portals:** Backstage TechDocs for organizations with many services; overkill for single repos.
- **Doc linting:** Vale for prose style; markdownlint for structure; broken-link checkers (`lychee`, `markdown-link-check`).
- **Diagrams as code:** Mermaid (rendered by GitHub natively), PlantUML, D2, Excalidraw with embed.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/documentation/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
