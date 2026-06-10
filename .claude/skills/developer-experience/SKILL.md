---
name: developer-experience
description: "Use when reviewing developer-experience concerns: single-command onboarding (contributors and end-users), inner-loop speed, task-runner discoverability, recipe-as-thin-wrapper discipline, error-message actionability, formatter/linter automation, AI-agent ergonomics, reproducible local environment, parallel-worktree dev stacks"
---

# Developer Experience

## Overview

Developer experience is the surface where contributors (human and agent) meet the codebase. Done well, a fresh clone is productive in under thirty minutes, the inner loop is fast enough to support flow, errors name what to do next, and the task runner is self-documenting. Done poorly, onboarding is a scavenger hunt, the inner loop costs minutes per iteration, errors say "something went wrong," and tribal knowledge is the only path to productivity.

**Core principle:** Friction at the inner loop is paid every day. The leverage of DX is not in any single check; it is in compounding the small wins until the system is pleasant to work in.

## Core Principles

### 1. Single-command onboarding for contributors and end-users

The goal is one command from "I have the repository" to "it works on my machine." This applies to both **contributors** (a fresh clone reaches a working dev state in under thirty minutes) and, for projects that ship a runnable system to end-users, the **user setup path** (a single `npx <project>-setup`, `pip install <project> && <project> init`, or equivalent puts the system into a working state without a scavenger hunt). Onboarding complexity should be abstracted into the bootstrap surface, not spread across the README and tribal knowledge; whoever the new user is, the time-to-first-success is the metric this principle optimizes.

**Multiple valid bootstrap mechanisms exist:** devcontainer, Nix flake, `bin/setup` script, language-native bootstrap (`uv sync`, `pnpm install`, `cargo build`), `just bootstrap`, or a published setup CLI (the syntropic137-npx pattern in the [`dependencies`](../dependencies/SKILL.md) skill's deep-dive is one example for end-user-facing setup surfaces). The principle is: pick one and keep it current. The red flag is "no working single-command path," not "did not pick devcontainers."

The README names prerequisites, install, run-locally, and test commands, and they all match the current scripts. For the end-user-facing path, the equivalent is the published quick-start: it works against a fresh machine without prior context.

### 2. Inner loop fast enough for flow

A single-file change should reach feedback in under thirty seconds: format, lint, type-check, run the relevant tests. A five-minute loop drives developers to context-switch, batch changes, and lose the tight feedback that catches bugs early. Watch modes, incremental compilation, and targeted-test selection are the canonical mechanisms.

Iteration speed is a design dimension, not a happy accident.

### 3. Error messages name what to do next

Catch-all "something went wrong" messages, exceptions re-raised without context, and CLI failures that print only "Error" are unbounded debugging sessions. Good error messages name what was attempted, what went wrong, and what the developer can try next. Error quality is the highest-leverage point in the operational loop.

### 4. Task runner is self-documenting

A task runner is the project's CLI for contributors. `make help`, `just --list`, `pnpm run`, or equivalent must show every useful target with a one-line description of when to use it. An undocumented task runner is rediscovered by every new contributor; the most useful targets stay tribal.

**Multiple valid task-runner choices exist:** `just`, `make`, `npm`/`pnpm` scripts, language-native (`cargo`, `uv`, `dotnet`), or a thin `bin/` directory of scripts. The principle is: one canonical entry point for common tasks, self-documenting, named consistently. The red flag is "scripts scattered with no help target," not "did not pick `just`."

### 5. Recipes are thin wrappers; logic lives in testable scripts

A task-runner recipe (justfile target, npm script, make rule) is a *name and entry point*, not a place for logic. Recipe bodies that contain more than a couple of lines of shell are an anti-pattern: they cannot be unit-tested, they cannot be reused from other recipes without copy-paste, they obscure the underlying behavior behind YAML or makefile-isms, and the recipe file grows into a junk drawer that no one wants to edit.

The discipline: each recipe is one or two lines that invoke a standalone script under `scripts/`. The script holds the logic, has its own tests (see the [`testing`](../testing/SKILL.md) skill), is invokable directly without the task runner, and is reusable from CI, other recipes, or a contributor's own shell. This composes with the cross-platform-script preference: a Python or Node script under `scripts/` is testable and runs everywhere; an inline `if [[ ... ]]` block in a justfile is neither.

Cross-reference: the [`testing`](../testing/SKILL.md) skill carries the test-quality stance these scripts must satisfy; the [`dry`](../dry/SKILL.md) skill carries the don't-duplicate-the-logic stance that justifies extracting in the first place; the [`continuous-delivery`](../continuous-delivery/SKILL.md) skill carries the gate that runs the same scripts in CI, so local and CI behavior is the same script invoked two ways.

A specific failure mode to watch for: AI coding agents tend to inline multi-line shell into recipes when generating "convenience" tasks. The result is unreadable, untestable, and duplicates logic across recipes. The rule "recipes call scripts; scripts hold the logic" is the antidote, and it should be stated in the project's contributor guide so agents inherit it explicitly.

### 6. Formatter and linter rules are autofixed, not relitigated

Whitespace, import order, quote style, and semicolon debates in PR review are pure waste. The decision is arbitrary, but the cost of relitigating it on every PR is real. An autoformatter plus a pre-commit hook plus a CI check ends the debate and frees review attention for substance.

### 7. Reproducible environment, declared and committed

Required env vars, tool versions, and system dependencies live in committed artifacts (devcontainer config, Nix flake, `.tool-versions`, `mise.toml`, `setup` script, or a single README section), not in chat history or one developer's head. Tribal-knowledge tax is the canonical DX failure mode.

**Multiple valid reproducible-environment approaches exist:** devcontainer, Nix flake, version-manager declaration (`asdf`/`mise`/`rtx`), VM/Vagrant, or a setup script with version assertions. The principle is: pick one and keep it canonical. The choice depends on the team's existing tooling; consistency within a project matters more than vendor.

### 8. Local dev stacks are parameterizable for parallel worktrees (scope: services with running infrastructure)

This principle scopes to projects that ship a developer-runnable stack (database, message broker, application server, container compose file). When the scope applies: the stack must accept a per-worktree namespace so two worktrees can run in parallel without colliding on ports, container names, database names, or volume mounts. A contributor with three feature branches in three worktrees should be able to spin up three independent stacks without manual juggling.

The mechanism is a project decision (an `INSTANCE_ID` env var threaded through the compose file, a worktree-derived port offset, container-name templating, separate Docker networks per instance), but the discipline is: the dev stack is parameterized, the parameter has a sensible default for the single-worktree case, and the parameterization is documented in the contributor guide. Without this, parallel-worktree development degrades to "stop the other stack first," which silently penalizes the workflow that the worktree pattern exists to enable.

Cross-reference: the [`environments`](../environments/SKILL.md) skill carries the broader anyone-can-spin-up-an-environment-quickly stance (DevOps-flavored, treating environment provisioning as a first-class capability); this skill carries the local-dev-loop side (parameterized for parallel inner-loop work). The two overlap intentionally: the same parameterization pattern that lets two worktrees run in parallel locally also lets ephemeral CI environments be spun up safely, and the [`continuous-delivery`](../continuous-delivery/SKILL.md) skill consumes that capability for review-app and preview-deploy patterns.

### 9. AI-agent ergonomics on equal footing with human ergonomics (scope: agent-driven workflows)

This principle scopes to projects where AI agents read the codebase as part of normal contribution flow. When the scope applies: the README, task-runner help text, and error messages must enable an autonomous agent reading them alone to identify entry points, the test command, the dev loop, and where to file findings.

Agents fail silently where humans ask. A README that assumes prior context fails for agents the same way it fails for new humans, but the agent hallucinates instead of pausing. Treat machine readers as first-class.

A specific anti-pattern worth naming explicitly: agents tend to expand task-runner recipes inline (multi-line shell stuffed into a justfile target, complex `&&` chains in npm scripts) rather than extracting the logic into a testable script. The contributor guide should state the rule from principle 5 (recipes call scripts; scripts hold the logic) so agents inherit it as a constraint, not learn it via review churn.

## Red Flags - STOP

- README missing prerequisites, install, run-locally, or test instructions, or the instructions no longer match the current scripts
- Onboarding path takes more than two hours from a fresh clone, or requires tribal-knowledge debugging to complete
- Single-file change triggers a full-project rebuild or full-suite test run with no watch mode, no incremental cache, no targeted-test command
- Error messages that say "something went wrong" without naming the cause or a suggested next step; catch-all handlers that swallow context
- Task runner with abbreviated, undocumented targets and no `help`/`--list` output showing what each does
- Task-runner recipes contain multi-line logic that cannot be unit-tested or reused; the same shell snippet appears across multiple recipes
- Whitespace, import-order, or quote-style debates in PR review threads in a project with no autoformatter on save and in CI
- Required env vars or tool versions discoverable only from chat history or a single developer's setup
- Dev stack hardcodes ports, container names, or database names; running two worktrees in parallel collides on shared resources and the workaround is "stop the other one first"
- README assumes prior context an autonomous agent could not recover from the repo alone (entry points, test command, dev loop unstated); contributor guide does not state the recipes-call-scripts rule, so agents inline shell into recipes by default

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "Setup is in the README somewhere" | Onboarding tax compounds; every new contributor pays it again |
| "The dev loop is fine for the people who know the tricks" | Tribal performance is a tax, not a feature |
| "We can grep for that error" | Multiplied across every contributor and every occurrence; a one-line hint pays back in hours |
| "Everyone knows what `make build-x` does" | New contributors and agents don't; self-documentation is one comment per target |
| "Inlining the script in the recipe is faster" | Faster to write once, then untestable, unreusable, and duplicated three recipes later |
| "Parallel worktrees are an edge case" | The worktree pattern exists to enable parallel work; if the dev stack blocks it, the pattern is decorative |
| "We just agree informally on formatting" | Until the next PR with a formatter debate; the decision is arbitrary, the cost is daily |
| "Agents will figure it out" | They hallucinate when they can't; that surfaces later as wrong PRs, not a confused human asking |
| "Devcontainers are over-engineering for a small team" | Until the third onboarding takes a week each |

## Key Patterns

```
✅ git clone && bin/setup && just test  (works on a fresh clone in under 30 minutes)
❌ git clone && [scavenger hunt across README, chat, and one developer's notes]
```

```
✅ Save file → format-on-save → typecheck in 2s → relevant tests in 5s
❌ Save file → manual format → full rebuild in 90s → full suite in 5 minutes
```

```
✅ Error: "DATABASE_URL not set. Add it to .env (see .env.example) or export it."
❌ Error: "Connection failed."
```

```
✅ just --list  →  test, lint, build, fmt, typecheck, db-reset (each with a description)
❌ Makefile with 40 targets, no help, half of them obsolete
```

```
✅ test: scripts/test.sh    (one line in the recipe; logic, flags, and tests live in the script)
❌ test:
       @echo "running tests"
       if [[ -n "$$CI" ]]; then ...; else ...; fi  (40 lines of inlined shell, untestable)
```

```
✅ docker compose with INSTANCE_ID-prefixed container names and port-offset env; two worktrees run in parallel
❌ docker-compose.yml hardcodes :5432, :8080; second worktree fails with "port already allocated"
```

```
✅ Pre-commit hook runs formatter; CI re-checks; PR review never mentions whitespace
❌ "nit: please run prettier" appears on every other PR
```

```
✅ README: "Tools: Node 22, pnpm 9, Postgres 16. Run: pnpm install && pnpm dev"
❌ README: "Install dependencies and run the dev server" (versions and commands unstated)
```

## Why This Matters

Developer experience is the integral of every contributor-hour spent in the inner loop. The cost of poor DX is paid not at any single moment but in slowed iteration, batched changes, lost flow, longer onboarding, and contributor turnover.

Without disciplined DX:

- Onboarding stretches from minutes to days; new contributors quit before they ship.
- Inner loops stretch from seconds to minutes; flow becomes impossible.
- Errors waste hours that a one-line hint would have saved.
- Task runners accumulate undocumented one-liners that only the original author understands.
- Recipes accumulate inlined shell that cannot be tested or reused; logic duplicates across recipes; the runner file becomes a junk drawer no one wants to edit.
- Parallel worktrees collide on ports and resources; the contributor stops using worktrees, losing the parallelism the pattern enabled.
- Formatter debates eat review attention that should go to substance.
- Agents fail silently because the README assumes context they cannot recover.

With disciplined DX:

- Fresh clone to working state is one command and under thirty minutes.
- The inner loop supports flow.
- Errors carry their own next-step hint.
- The task runner is the project's self-documenting CLI; recipes are thin wrappers over testable scripts, so logic is debuggable and reusable.
- Local dev stacks parameterize cleanly; parallel worktrees run side-by-side without manual port juggling.
- Formatter and lint disagreements are resolved by tooling, not threads.
- Agents and humans onboard from the same readable artifacts.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** README names install and run commands, even if the bootstrap is a one-liner. Errors carry enough context to debug. Awareness that the inner loop will need to be fast as the codebase grows.
- **Growing internal tool:** task runner with a help target; recipes already extract non-trivial logic into `scripts/`; autoformatter on save and in CI; first attempt at a reproducible-environment artifact (committed tool versions, setup script, or devcontainer). Inner loop tracked.
- **Shared library:** consumers can run examples from the README in under five minutes; error messages from the public API name the cause and suggest the fix; contributing guide names the test and release commands; recipes-call-scripts rule stated explicitly so contributors and agents inherit it.
- **Production service:** one-command bootstrap; sub-thirty-second inner loop on the common change; task-runner help is reviewed alongside the code it drives; recipe scripts have their own tests; dev stack parameterized for parallel worktrees; formatter/linter is non-negotiable in CI; errors are reviewed for actionability as part of design review.
- **Safety-critical:** reproducible environment is part of the release artifact; onboarding paths are tested in CI (the bootstrap script runs on a fresh image); error messages carry runbook links; agent-readable contribution guides are kept in sync with human-readable ones.

## References & rationales

- **Andrew Hunt and David Thomas, *The Pragmatic Programmer* (2nd ed., 2019).** Backs principle 1 (onboarding) and principle 6 (reproducible environment). The inner-loop and personal-automation framing is the foundation behind every DX check.
- **Jonathan Blow and Casey Muratori, on compile-time as a design dimension.** Backs principle 2 (inner loop fast enough for flow). Iteration speed is a property of the tooling, designed in deliberately.
- **Charity Majors, on developers in production.** Backs principle 3 (error messages name next steps). The operational loop is part of DX; error quality is the highest-leverage point in it.
- **Adrienne Friend, on Developer Experience as a measurable engineering concern.** Backs principle 5 (autofixed formatter rules) and principle 6 (reproducible environment). DX as a measurable surface, not a vibe.
- **Daniele Procida, the Diátaxis framework.** Backs principle 1. The four documentation modes; tutorials onboard, how-to gets work done. The README as the onboarding contract.
- **Brett Slatkin, *Effective Python* tradition.** Backs principle 3. Series-level guidance on error-message quality and idiomatic ergonomics.
- **Kelsey Hightower, on the principle of least surprise.** Backs principle 4 (self-documenting task runner). Tooling that behaves predictably wins the daily-use battle.
- **Adrienne Friend and Charity Majors generalized to non-human contributors.** Backs principle 9 (AI-agent ergonomics). The same DX surface that fails new humans fails new agents, but agents fail silently.
- **`just` (casey/just) and the cross-platform task-runner tradition.** Backs principle 4 (self-documenting task runner) and principle 5 (recipes as thin wrappers). The `just --list` surface is one example of self-documenting; the recipe-as-name discipline is the other half of the same idea.
- **GNU Make tradition and the script-versus-recipe distinction.** Backs principle 5 (logic in scripts, not recipes). The makefile's role is to name and depend, not to hold logic; the same applies to every modern equivalent.
- **`git worktree` (Junio Hamano et al., Git core).** Backs principle 8 (parameterized local dev stacks). The worktree primitive enables parallel work on multiple branches; the dev stack must accommodate that, or the primitive is decorative.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific tools; if a tool here is no longer maintained, the patterns transfer to its replacement.

- **Task runners:** `just` (cross-platform, self-documenting via `just --list`), GNU `make` (ubiquitous, less ergonomic), `pnpm`/`npm` scripts (JS ecosystem), `cargo`/`uv` (language-native), `mise tasks` (version-manager-integrated). Pick one canonical entry point. For recipe scripts themselves, prefer Python or Node over bash so the scripts are testable and cross-platform; reserve bash for the cases where the system primitives are the point.
- **Parameterized local stacks:** Docker Compose with `${INSTANCE_ID}`-templated container names and port-offset environment variables; Tilt or Skaffold for Kubernetes-flavored local dev; Devbox or Nix-shell per-worktree environments; direnv for per-directory env loading.
- **Reproducible environments:** devcontainers (VS Code / GitHub Codespaces), Nix or `nix-direnv` (declarative and reproducible), `mise`/`asdf`/`rtx` (version managers via `.tool-versions`), `bin/setup` scripts with version assertions.
- **Formatters and linters:** Prettier (JS/TS/CSS/MD), Biome (faster JS/TS), Black + Ruff (Python), gofmt + golangci-lint (Go), rustfmt + clippy (Rust), shfmt (shell). Pre-commit hooks via `lefthook`, `pre-commit`, or `husky`.
- **Watch modes / incremental:** Vite/esbuild (JS/TS), `pytest --testmon` or `--lf` (Python), `cargo watch` (Rust), `air`/`reflex` (Go). Targeted-test selection by file or marker.
- **Error-message quality:** custom error types with structured fields; `Error.cause` chaining (JS/TS); `raise X from Y` (Python); `anyhow`/`thiserror` (Rust); structured logging to make errors searchable.
- **Documentation discoverability:** README-driven onboarding; `CONTRIBUTING.md` for the contributor loop; auto-generated task-runner help; per-script docstrings.
- **AI-agent ergonomics:** `AGENTS.md` or `CLAUDE.md` files at repo root naming entry points and conventions; machine-readable task-runner help; consistent script naming conventions.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/developer-experience/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
