# Harness Engineering

The discipline of building effective test harnesses, guardrails, evaluation frameworks, and orchestration layers around AI coding agents.

> **Canonical source.** This file is a port of `github.com/NeuralEmpowerment/neural-hermes-data` at path `knowledge-management/areas/code/agentic-engineering/harness-engineering/README.md`, cross-checked against `/tmp/he-canonical.md`. When the upstream catalog grows a new reference, mirror it here per the preservation rule (never drop a reference).
>
> Supplementary local doc: [`lab-five-principles.md`](./lab-five-principles.md) carries the lab's five-principle framing for the template's own discipline (measured-not-assumed, token-aware, polyglot-first, cross-platform, eat-own-dogfood) — adjacent to, not in place of, the canonical.

## Scope

This area covers patterns, principles, and tools for making AI agents reliable, observable, and controllable in production software development workflows. Topics include:

- Agent harness design (pre/post conditions, runtime guardrails, evaluation suites)
- Architectural fitness functions for automated governance
- Approved scenario patterns for agent authorization
- Long-running agent reliability (checkpointing, budget enforcement, progressive validation)
- Agent orchestration and multi-agent coordination
- Developer skills and workflow integration

## Actionable

**[Capability Checklist](capability-checklist.md)** — distilled task list for building an effective harness, organized by domain (infrastructure, browser legibility, observability, autonomous loop, etc.).

**[Key Passages](key-passages.md)** — essential excerpts from the OpenAI articles on autonomy levels and agent-generated codebases.

**[Lab five principles](lab-five-principles.md)** — supplementary; the lab's own discipline framing (measured-not-assumed, token-aware, polyglot-first, cross-platform, eat-own-dogfood). Use alongside, not instead of, the canonical above.

**[Upstream update flow](upstream-update-flow.md)** — Tier 1 / Tier 2 / Tier 3 mechanism for keeping consumer forks and the canonical template coherent, anchored by `.harness-provenance.json`.

## References

The full 11-row canonical table (cross-checked against `/tmp/he-canonical.md`). Per-source extractive summaries live under [`references/`](./references/).

| Article | Source | URL | Summary |
|---------|--------|-----|---------|
| Harness Engineering | Martin Fowler / ThoughtWorks | <https://martinfowler.com/articles/harness-engineering.html> | [`references/martin-fowler-harness-engineering.md`](./references/martin-fowler-harness-engineering.md) |
| Architectural Fitness Function | ThoughtWorks Radar | <https://www.thoughtworks.com/en-de/radar/techniques/architectural-fitness-function> | [`references/thoughtworks-architectural-fitness-function.md`](./references/thoughtworks-architectural-fitness-function.md) |
| Approved Scenarios | Augmented Coding Patterns | <https://lexler.github.io/augmented-coding-patterns/patterns/approved-scenarios/> | [`references/lexler-approved-scenarios.md`](./references/lexler-approved-scenarios.md) |
| Effective Harnesses for Long-Running Agents | Anthropic Engineering | <https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents> | [`references/anthropic-effective-harnesses.md`](./references/anthropic-effective-harnesses.md) |
| Harness Engineering | OpenAI | <https://openai.com/index/harness-engineering/> | [`references/openai-harness-engineering.md`](./references/openai-harness-engineering.md) |
| Open Source Codex Orchestration Symphony | OpenAI | <https://openai.com/index/open-source-codex-orchestration-symphony/> | [`references/openai-codex-orchestration-symphony.md`](./references/openai-codex-orchestration-symphony.md) |
| Role of Developer Skills | Martin Fowler / Gen AI | <https://martinfowler.com/articles/exploring-gen-ai/13-role-of-developer-skills.html> | [`references/martin-fowler-developer-skills.md`](./references/martin-fowler-developer-skills.md) |
| Minions: One-Shot End-to-End Coding Agents | Stripe | <https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents> | [`references/stripe-minions-one-shot-agents.md`](./references/stripe-minions-one-shot-agents.md) |
| AI Is Forcing Us To Write Good Code | Steve Krenzel / Logic | <https://bits.logic.inc/p/ai-is-forcing-us-to-write-good-code> | [`references/logic-ai-forcing-good-code.md`](./references/logic-ai-forcing-good-code.md) |
| Parse, Don't Validate | Lexi Lambda | <https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/> | [`references/lexi-lambda-parse-dont-validate.md`](./references/lexi-lambda-parse-dont-validate.md) |
| AI Agent Harnesses Explained: Architecture | BoringBot | <https://boringbot.substack.com/p/ai-agent-harnesses-explained-architecture> | _summary not yet ported — file when an extractive read is fetched_ |
