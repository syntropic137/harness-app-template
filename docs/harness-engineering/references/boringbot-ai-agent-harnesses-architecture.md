# AI Agent Harnesses Explained: Architecture, Ecosystem, and Multi-User Design \ BoringBot

**Source:** https://boringbot.substack.com/p/ai-agent-harnesses-explained-architecture
**Authors:** Hamza Farooq and Aishwarya Ashok
**Published:** 2026-05-08
**Fetched:** 2026-05-30

## Access note

The fetched Substack text exposes the title, author block, key takeaways,
introduction, and the first architecture section before the continuation gate.
This extractive summary covers that available text only and does not infer
from the gated remainder.

## Short source anchors

The source's core framing appears in three short phrases:

- "Agent = Model + Harness."
- "Safety lives in the harness, not the model."
- "Multi-user is where harness design gets hard."

## Extractive summary

The article frames a production agent as two systems operating together: a
model that proposes structured tool calls and a harness that decides whether
those calls may execute. The model is treated as an inference engine, not as
the runtime boundary. The harness validates, routes, executes in a controlled
workspace, and returns structured results.

The accessible section names five responsibilities for a production harness:
tool execution, memory and context management, sandboxing, state persistence,
and permission enforcement. The text treats those responsibilities as
architectural invariants: missing one creates either an uncontrolled blast
radius or an open attack surface.

The source distinguishes harness maturity levels. A bare invocation leaves a
human to copy suggestions into the world. A tool-calling wrapper executes
declared tools but lacks durable session context, rollback, or isolation. A
session-aware harness adds single-user persistence and rollback. A multi-user
production harness adds per-user isolation, scoped permissions, shared audit
logs, and concurrent-agent support.

The article also separates harnesses from adjacent terms. Frameworks such as
agent libraries help construct workflows but do not enforce sandboxing or
permissions. Orchestrators manage sequencing and retry state but do not own
agent-specific concerns such as memory scoping or tool-call injection
prevention. The harness is the runtime boundary that contains those concerns
and decides what touches the real system.

The multi-user warning is the part most relevant to this template. The source
argues that single-developer harness assumptions break when several people or
agents share an instance. At that point, permission inheritance, namespaced
memory, and tamper-evident audit logs become design requirements rather than
nice operational polish.

## Relevance to this template

This source supports the template's decision to treat harness behavior as
machine-enforced architecture rather than prose guidance. It maps directly to
the template's slots:

- `hooks`, `secret-scanner`, and `doc-validator` enforce actions before they
  reach shared history.
- `stack-manager`, `observability-stack`, and `inspector` make execution and
  runtime state visible to agents.
- `agent-plugins` and the upstream harness-engineering skills document the
  permission, browser, telemetry, review, and durability surfaces that a
  consumer fork should grow into.
- `sensors` and performance gates turn architectural health into repeatable
  feedback instead of one-off review.

The source also backs the template's `just review` posture: review is not only
a human reading step. In a harnessed repository, review is a tool-mediated,
auditable loop that runs through explicit capabilities and returns structured
findings.
