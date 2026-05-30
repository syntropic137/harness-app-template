# Harness Engineering — purpose, vision, principles, mechanisms

> **One sentence:** an agentic engineering harness is a portable infrastructure pattern that lets an AI coding agent diagnose, fix, and verify changes in any codebase, with every architectural choice grounded in measurement rather than assumption.

> **Source:** ported from the upstream lab at `NeuralEmpowerment/agentic-harness-lab/docs/harness-engineering/README.md`. Edits here adapt the framing for a consumer fork; the **five principles** below transport verbatim. When upstream evolves them, pull updates per [`upstream-update-flow.md`](./upstream-update-flow.md).

This directory is the canonical hub for **what the harness is, why it exists, what principles govern it, and the mechanisms that keep this consumer fork coherent over time.** Other docs in this repo reference this one; this one references no other doc as authoritative on its own scope.

If you're orienting from scratch, read in this order:

1. [What an agentic engineering harness actually is](#what-an-agentic-engineering-harness-actually-is)
2. [What we are + aren't trying to build](#what-we-are-and-arent-trying-to-build)
3. [The five principles](#the-five-principles-in-order-of-load-bearing-ness)
4. [`upstream-update-flow.md`](./upstream-update-flow.md) — how this fork stays coherent with the lab and contributes back (to be ported alongside)
5. The Tool-Belt Standard the principles govern — currently the [`harness.manifest.json`](../../harness.manifest.json) in this repo and the per-slot decision docs under [`../adr/`](../adr/). A consumer-fork copy of `docs/standard/v0.X.md` is a deferred port (see the gap report)

---

## What an agentic engineering harness actually is

The harness is not a framework, a library, or a single tool. It is a **named set of contracts** — the Tool-Belt Harness Standard — paired with **plugin picks** that satisfy each contract, **evidence** that the picks were correct, and **conventions** that make the whole thing legible to an AI coding agent operating against any codebase that adopts it.

The metaphor is a tool belt. Each loop on the belt is a **slot** with a fixed shape. Each tool that fits a slot is a **plugin**. A **template** is a specific belt assembly — one plugin per slot — packaged so a new project can scaffold the whole belt with one command. A **consumer** is a project that wears the belt. The harness wraps *around* application code; it does not prescribe how to write the application.

Slots are stable (the Standard changes slowly, with a versioned contract). Plugins are swappable (replace one tool with another without rewriting the Standard or other plugins). This is the load-bearing separation: it lets the upstream lab's measured opinions about *which tools win this year* evolve without invalidating consumers' adoption.

## What we are and aren't trying to build

**We are trying to build:**

- A measured, opinionated default belt that ships with one plugin per slot — each pick research-backed, each pick documented in [`../adr/<slot>.md`](../adr/).
- A scaffolder (`create-harness-app`) that materializes the belt onto a fresh repo.
- An augment path that retrofits the belt onto an existing repo without restructuring it.
- A self-instrumenting harness: this template governs itself with the same gates it ships to consumers. Eat-our-own-dogfood is non-negotiable.
- Cross-language portability: TypeScript, Rust, Python, Go (and more, by extension) all sit on the same observability + inspector layer. Language-specific pieces live in language-specific directories; everything cross-cutting is language-agnostic.

**We are not trying to build:**

- A SaaS. The harness is a publishable pattern, not a hosted product. Every artifact a consumer needs ships in their repo.
- A monolith. Slots can be removed (plug-and-play); plugins can be swapped (decision docs make this explicit); the harness shouldn't grow capabilities it can't justify with evidence.
- A framework that prescribes how to write application code. The harness wraps *around* the codebase. The codebase chooses its own stack inside `ws_apps/` and `ws_packages/`.
- An LLM agent. The harness is the *environment* the agent operates in — the observability surface, the evidence-capture utilities, the gates, the skills. The agent is Claude / GPT / Codex / Gemini / whichever model the consumer wires up; their context-loading is unified via the `.claude/` canonical directory + vendor symlinks for `AGENTS.md`, `GEMINI.md`, etc.

## The five principles, in order of load-bearing-ness

1. **Measured, not assumed.** Every architectural choice has a hypothesis-first experiment behind it (`experiments/<date>--<slug>/`) and a retrospective afterwards. Tool picks require WebSearch backing — recommending tools from training data alone violates the harness's purpose. A "5 of 10 slots cleanly landed" outcome is *good news*, not failure: it's honest about which parts of the harness are mature and which need more work.

2. **Token-aware as a first-class constraint.** Tokens are a measurable cost. In practice, observability queries dominate the agent-loop token weight, then evidence artifacts, then skill/MCP loading, then shell-command output. Every harness component defaults to terse output, with `--verbose` opt-in. Measure on real workloads, not vendor marketing aggregates.

3. **Polyglot-first.** Slot contracts must not assume any specific language. A TypeScript app and a Python app must use the same shipped plugin equally well. Plugin implementations may be opinionated (Rust-first for harness tools is a defensible pick), but **contracts are language-agnostic**.

4. **Cross-platform and pragmatic.** macOS + Linux are first-class. Windows is supported where reasonable. No `.sh` or `Makefile` as primary entrypoints — `just` is the canonical task runner. Anything beyond simple shell needs a script in a language the project already uses, or Rust. Plug-and-play matters: optional capabilities must be cleanly removable without breaking the rest of the harness.

5. **The harness eats its own dogfood.** This repo IS a consumer of its own slot infrastructure. `just sensors report` runs against the harness's own code. If our governance degrades, the gate trips on us first.

## Anchoring framework for new work

When proposing new work, the proposal should open by anchoring to:

1. **Which principle does this advance?** (Usually one or two of the five above.)
2. **What measurement gap does this close?** Reference an experiment, a retrospective, or a friction-log entry — not a hunch.
3. **What downstream consumer surfaces this need?** Real consumers ground the design — if a hypothetical consumer is the only justification, the work is probably premature.
4. **What does "we are not trying to build" rule out for this work?** Pre-commit your scope cuts so the work doesn't drift.

## Where the artifacts live (in this consumer fork)

| Question | Canonical answer (this repo) |
|---|---|
| What contract does the harness offer? | [`../../harness.manifest.json`](../../harness.manifest.json) (manifest) + [`../adr/`](../adr/) (per-slot ADRs). A versioned `docs/standard/v0.X.md` is a deferred port. |
| Which tool fills slot X today, and why? | [`../adr/<slot>.md`](../adr/) |
| What have we measured? | `experiments/<date>--<slug>/` directories; the rollup `executive-summary.md` is a deferred port. |
| Per-experiment hypotheses + verdicts | `experiments/<date>--<slug>/` |
| Per-experiment lessons | `docs/retrospectives/` (deferred port — distilled retros from the lab will land here as a curated subset, not the full 24-doc history) |
| How this fork stays in sync with upstream | [`upstream-update-flow.md`](./upstream-update-flow.md) (deferred port) |
| How an agent orients itself in this repo | [`../../CLAUDE.md`](../../CLAUDE.md) |
| How a downstream consumer adopts the harness | [`../../README.md`](../../README.md) |
| Which skills agents should reach for | [`../../.claude/skills/`](../../.claude/skills/) (ship-in-tree) + the upstream `syntropic137/harness-engineering` plugin (deferred wire-up; see gap report) |

## When to update this hub

- A new **principle** becomes load-bearing (rare — needs an experiment and a retrospective behind it).
- A "we are not trying to build" statement is reversed (very rare — needs an explicit maintainer decision).
- A major arc completes and changes how the canonical artifacts above are organized.
- Otherwise: leave the principles + framing alone. The vision doesn't change every cycle; the **measurements** do.

## Supporting docs in this directory

- [`upstream-update-flow.md`](./upstream-update-flow.md) — Tier 1 / Tier 2 / Tier 3 mechanism for pulling lessons between consumer forks and the lab. **Deferred port** — see the gap report.

Future supporting docs (placeholders — add as work lands):

- `slot-design-rationale.md` — why each slot exists, what failure mode it prevents, what alternatives we rejected
- `augment-vs-scaffold.md` — when each path applies and how they share infrastructure
- `binary-distribution-design.md` — the cargo-dist + cargo-binstall + local-fallback story (today: mostly in [`../adr/binary-distribution.md`](../adr/binary-distribution.md))
