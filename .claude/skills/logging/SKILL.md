---
name: logging
description: Use when reviewing logging concerns: structured-vs-unstructured logs, log-level policy, secret and PII redaction, correlation IDs in distributed systems, log/trace linkage, print statements in production code paths
---

# Logging

## Overview

Logs are the substrate that makes production debuggable. They are also the place where secrets leak, level discipline collapses, and "we'll observe it later" becomes "we cannot answer what happened to that request." Done well, logs feed the entire observability stack; done poorly, they are noise that hides signal.

**Core principle:** Logs are structured events written to a stream the environment routes. The application produces; the environment ships, indexes, and queries.

## Core Principles

### 1. Logs are structured events, not free-form strings

A log line is a record with named fields. Free-form strings collapse the pipeline into greppable text and lose the ability to query by field, aggregate by user, or compute high-cardinality slices.

**Multiple valid serializations exist:** key-value pairs, JSON, logfmt. The principle is: pick one and apply it consistently at the edge (the logger boundary). The red flag is "no stated convention," not "did not pick JSON."

### 2. Log levels follow a documented policy

Levels are a deliberate filter, not decoration. Without a policy, levels lose signal value: on-call engineers stop trusting them, alerts wired to `error` go quiet or fire constantly, and `info` becomes a default that absorbs everything.

A level policy states: what counts as `error` (something a human must address), what counts as `warn` (something to notice), what counts as `info` (the durable narrative), what counts as `debug` (detail for active investigation).

### 3. No `print()` in production code paths

A `print` (or `console.log`, `fmt.Println`, `System.out.println`) is a logger that bypasses level filtering, formatting, redaction, and shipping. It writes to stdout but tells the rest of the system nothing. Production code uses the project's logger.

### 4. Redact secrets and PII at the logger boundary

Passwords, tokens, API keys, full request bodies, full headers (especially `Authorization`), and full SQL with bound parameters must be redacted before they reach the logger. Logs are often shipped to systems with weaker access control than the primary store; what you log is what you have leaked.

Redact at the boundary, not at the sink: by the time a sink redacts, copies have already been written. Cross-reference: the [`security`](../security/SKILL.md) skill carries the sensitive-data classification and exfiltration-channel framing that names which fields require redaction here.

### 5. Correlation IDs propagate across hops (scope: distributed systems)

This principle scopes to systems where a single user-facing request crosses two or more services. In single-process applications it does not apply.

When the scope applies: generate a correlation ID at the edge (or accept one if the caller provided it) and propagate it through every hop's context. Without correlation, "what happened to this request" becomes timestamp-correlation across services, which is unreliable at any meaningful traffic level.

### 6. Logs link to traces (scope: systems that emit traces)

This principle scopes to systems instrumented with distributed tracing. When the scope applies: every log line emitted within a span carries the trace ID and span ID. Logs and traces stored separately with no shared identifier cannot pivot to each other; the slow span and the noisy log line are two facts that should be one.

### 7. The logger is an injected dependency, not a global import

A single logger instance owns configuration: format, level, sinks, redaction helpers, correlation context. Each module receives that logger by injection (constructor, parameter, or context object), not by importing a module-global directly.

Centralizing configuration in one place means level changes, format changes, and redaction additions land in one file. Injection also makes the logger substitutable: tests pass a memory logger and assert on structured fields instead of capturing stdout.

The red flag is "every module imports its own logger and configures it locally," which produces drift across modules and silently breaks central policy changes.

### 8. Log at the seams; what to log at which level

A log line is cheap to emit and expensive in aggregate. The discipline is to log at the seams of the system, not inside hot loops, and to match the level to what the line tells the reader.

**Where to log:**
- Entry and exit of subsystem or service boundaries (request handlers, queue consumers, scheduled jobs, public APIs of internal libraries).
- State transitions (a record moved from `pending` to `processed`; a feature flag flipped; a circuit breaker opened).
- Decisions the system made on the user's behalf (which provider was selected, which fallback fired, why a retry was skipped).
- Error sites that catch and handle, with the cause chain attached. See the [`error-handling`](../error-handling/SKILL.md) skill for how the error itself is structured.

**Where not to log:** inside tight loops, per-iteration in batch processing (log once with a count), per-row of a query result, or anywhere the line is more frequent than the operator can read.

**Level guidance:**
- `error`: a human (or supervisor) must address it. Pages someone or shows up on a dashboard.
- `warn`: a signal worth noticing but the system handled it (fallback fired, retry succeeded after N attempts, deprecated path used).
- `info`: the durable narrative. Boundary entry/exit, state transitions, decisions. The line a future operator reads to reconstruct what happened.
- `debug`: detail for active investigation. Off in production by default; enabled by flag or context.
- `trace` (when present): per-call detail for development. Never enabled in production.

The level policy named in principle 2 makes these definitions enforceable; this principle states the content discipline that makes the policy useful.

Cross-reference: the [`continuous-delivery`](../continuous-delivery/SKILL.md) skill consumes these boundary emissions as the health and SLO signals that gate deploys and trigger automated rollback.

## Red Flags - STOP

- Free-form string logs (`logger.info("user " + id + " did " + action)`) instead of structured (`logger.info("user_action", user_id=id, action=action)`)
- `print`, `console.log`, `fmt.Println`, or `System.out.println` in non-test code paths
- No documented log-level policy; everything at `info`, or `error` used for non-error events
- Passwords, tokens, API keys, full request bodies, or `Authorization` headers logged unredacted
- Distributed system with no correlation ID propagated across service hops
- Logs and traces in separate systems with no shared trace ID or span ID
- Log files written by the application to local paths instead of streamed to stdout for the environment to route
- Redaction applied at the sink rather than the logger boundary
- Logger imported as a module global in every file; configuration drifts across modules and central policy changes silently miss callers
- Logging inside hot loops or per-row in batch processing without aggregation; volume drowns the signal
- Boundary calls (request handlers, queue consumers, scheduled jobs) emit no entry or exit log line; reconstructing what the system did requires inferring it from downstream effects
- State transitions and consequential decisions go unlogged; the system's "why" is invisible to operators and to agent reviewers

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "Free-form is more readable" | It is at first; then you cannot query by field and the pipeline collapses |
| "We'll add structure later" | Later means rewriting every call site; the cost compounds |
| "`print` is fine for this" | Production code paths are not "this"; the print escapes review when the path goes hot |
| "Levels don't matter" | They do at 3 AM when on-call is grepping for the cause |
| "Tokens are short-lived, logging them is fine" | Logs outlive tokens; the leak is durable |
| "We don't need correlation, we know where the request goes" | Until a service is added, then the next debug session is timestamp-archaeology |
| "Redaction at the sink is the same thing" | The intermediate copies are already written; redaction at the boundary is the only one that prevents leakage |
| "Importing the logger globally is simpler" | Simpler to write, harder to change; central policy edits silently miss modules that configured their own |
| "Logging at the seams is excessive; the code is self-explanatory" | Code explains what runs; logs explain what ran. Operators and agent reviewers read logs, not source |
| "Agents can read the source to understand the system" | Source describes capability; logs describe actuality. Agents debugging or verifying need the runtime trace, not the static text |

## Key Patterns

```
✅ logger.info("user_action", user_id=id, action=action, request_id=ctx.request_id)
❌ logger.info("user " + str(id) + " did " + action)
```

```
✅ Documented level policy: error = pages someone, warn = notice, info = narrative, debug = detail
❌ Everything at info; alerts fire on error but error is also used for client 4xx
```

```
✅ logger.info("payment_processed", amount=amount, card_token=redact(token))
❌ logger.info(f"Processed payment with token {token}")
```

```
✅ Correlation ID injected at the edge, propagated via traceparent / X-Request-ID across hops
❌ Each service logs its own request ID; no shared identifier
```

```
✅ Log line includes trace_id and span_id from the active context
❌ Logs in one system, traces in another, no shared identifier
```

```
✅ class OrderService:
       def __init__(self, logger): self.log = logger
   (logger injected; tests pass a memory logger and assert on fields)
❌ from app.logging import logger
   (every module imports the global; configuration drifts; tests capture stdout)
```

```
✅ Boundary entry/exit + state transitions + decisions logged at info; errors at error with cause chain
❌ logger.info inside the per-row loop of a 100k-record batch; signal drowns in volume
```

## Why This Matters

Logs are the cheapest observability primitive. They are also the one most likely to fail silently: free-form strings still "work," `print` still produces output, `error` still gets logged. The failure mode is not "logs missing"; it is "logs present but useless when needed."

Without disciplined logging:

- Production debugging degrades to grep and timestamp-correlation; mean time to resolution climbs.
- Secrets leak through logs to systems with weaker access control than the primary store.
- Alerts wired to `error` go quiet or fire constantly because levels are inconsistent.
- The log volume grows but the signal does not; storage costs climb while debuggability does not.

With disciplined logging:

- Production questions are answered by log queries in seconds, not log archaeology in hours.
- Secrets are redacted at the boundary; the leakage surface is bounded.
- Levels are trusted; alerts fire on real signal.
- Logs link to traces and metrics; the three pillars compose.

**Logs are also the agent-facing feedback channel.** As LLM-driven test, review, and debugging agents become a regular part of the development loop, logs are how those agents verify behavior without re-running the system. A structured log stream lets an agent answer "did the request hit the auth boundary, fall through to the fallback provider, and emit a state transition" by reading fields, not by parsing prose. Codebases whose logs are structured, scoped to the seams, and free of secrets are codebases agents can review. Codebases whose logs are free-form, hot-loop spam, or absent at the seams force the agent back to source reading and re-runs, which is slower and less reliable than the runtime trace would have been.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** a logger object exists (not `print`); calls go through it. Structure is optional but encouraged. No level policy yet; that lands when there is something to alert on.
- **Growing internal tool:** structured logging in place at the boundary. First level policy documented (one paragraph in the README). Secrets identified and redacted. No correlation IDs yet because the system is single-process.
- **Shared library:** library exposes a logger interface, does not configure logging itself (that is the consuming application's job). Library never logs secrets even if passed them. Documentation states the logger contract.
- **Production service:** structured logs, documented level policy enforced in review, redaction at the logger boundary with a tested redaction helper. Correlation IDs propagated across hops via standard headers. Logs link to traces. Log volume monitored as a cost line.
- **Safety-critical:** audit logs separated from operational logs and retained per regulatory requirements. Tamper-evident audit trail. Redaction is part of the release artifact and reviewed. PII flow documented; logs are part of the data-flow diagram.

## References & rationales

- **Charity Majors and Liz Fong-Jones, *Observability Engineering* (O'Reilly, 2022).** Backs principles 1 (structured events) and 6 (logs as substrate that links to traces). Argues high-cardinality structured events are the foundation of debuggable production systems.
- **Cindy Sridharan, *Distributed Systems Observability* (O'Reilly, 2018).** Backs principles 2 (level discipline as deliberate filter) and 5 (correlation IDs in distributed contexts). Three-pillars framing.
- **Adam Wiggins, Twelve-Factor App, factor XI ("Logs").** Backs principle 3 (no `print` in production; logs are streams the environment routes). The application writes; the environment ships.
- **OWASP Top 10 A09 (Security Logging and Monitoring Failures).** Backs principle 4 (redaction at the boundary). Pairs "log too little to investigate" with "log too much and leak secrets."
- **GDPR Article 5(1)(c), data minimization.** Backs principle 4 from the regulatory direction. Logs are processing; do not log more PII than the purpose requires.
- **Brendan Gregg, USE method; Tom Wilkie, RED method.** Corroborate principle 1 (structure) from the metrics direction: logs feed metrics in well-instrumented systems, so field-name discipline matters.
- **Robert C. Martin, *Clean Code* and *Clean Architecture*.** Backs principle 7 (logger as injected dependency). Dependency injection over global imports; testability follows from injection.
- **Martin Fowler, "Inversion of Control Containers and the Dependency Injection pattern."** Backs principle 7 from the patterns direction: cross-cutting concerns (logging, configuration, time) are injected, not imported.
- **Google SRE Book (Beyer et al., 2016), "Monitoring Distributed Systems."** Backs principle 8 (log at the seams; level guidance). The four golden signals and the discipline of logging boundary events for operability.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific tools; if a tool here is no longer maintained, the patterns transfer to its replacement.

- **Python:** `structlog` for structured logging; `python-json-logger` for JSON output via stdlib `logging`; `loguru` for ergonomic single-file scripts.
- **JS/TS:** `pino` (fast JSON), `winston` (configurable transports), `bunyan` (legacy but stable).
- **Go:** `slog` (stdlib, Go 1.21+), `zap`, `zerolog`.
- **Rust:** `tracing` with `tracing-subscriber` for structured + spans; `log` + `env_logger` for simpler cases.
- **Java/Kotlin:** SLF4J facade with Logback or Log4j2; MDC for correlation context.
- **Tracing/correlation:** OpenTelemetry SDK for any stack; `traceparent` header (W3C Trace Context) as the canonical propagation format.
- **Log aggregation/query:** Loki + Grafana, Honeycomb (events-first), Datadog, Splunk, Elastic. The choice is downstream; the principle is "logs are streams the environment routes."
- **Redaction helpers:** project-local helpers calling out keys from a denylist; never trust regex-only redaction for high-stakes secrets.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/logging/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
