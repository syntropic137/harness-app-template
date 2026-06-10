---
name: error-handling
description: "Use when reviewing error-handling concerns: error taxonomy, propagation discipline, swallow-vs-crash, retry semantics with backoff and idempotency, exit codes as API, error messages as contract, cause-chain preservation"
---

# Error Handling

## Overview

Errors are part of the contract a system offers, not an afterthought to the happy path. Done well, errors are typed, propagated deliberately, retried only when retrying is safe, and reported in messages that tell the reader what to do next. Done poorly, errors are stringly typed, swallowed at catch-alls, retried unboundedly into self-inflicted denial-of-service, and reported in messages that say nothing actionable.

**Core principle:** Errors are first-class. Treat the failure modes of a system as part of its public surface, name them, propagate them deliberately, and write the messages and retry policies as contracts that someone downstream relies on.

## Core Principles

### 1. Errors are typed; the taxonomy is the contract (scope: typed taxonomy applies in languages with sum types or richer type systems; weakened-but-still-applies form in dynamic or exception-only languages)

A named error taxonomy lets callers act differently for different failure modes. `NotFoundError`, `ValidationError`, `TransientUpstreamError`, and `PermissionError` are different decisions; collapsing them into `Exception` or `Error` strips the dispatch signal callers need.

This principle scopes most strongly to languages with sum types or discriminated unions (Rust's `Result<T, E>` with E as an enum, TypeScript's discriminated unions, Haskell's `Either`, Scala's `ADT`s). In exception-based languages, the analog is a class hierarchy of typed exceptions; in dynamic languages, the analog is a structured error object with a typed `kind` field.

The principle is: callers can dispatch on error kind without parsing strings. The red flag is "all errors are the same generic type, so callers either catch nothing or catch everything."

### 2. Propagate or handle deliberately; do not swallow (scope: bare-catch ban applies to exception-based languages; the analog applies to ignored Result returns in Result-based languages)

Errors must flow to a place that decides what to do with them. Catch-and-ignore (`try: ... except: pass`, `catch (e) {}`, ignored `Result` return values) hides the signal; the system limps on in a broken state and the operator has no thread to pull on when the consequence surfaces later, often far from the cause.

The discipline is: at every error site, either propagate (re-raise, return the Result, bubble) or handle (record the error, take recovery action, surface it to the user). Swallowing is the failure mode.

The cousin principle is "crash early" (Hunt and Thomas's assertive programming, Armstrong's "Let It Crash" for Erlang): when invariants are violated and recovery is not possible, fail loudly and quickly so the cause is close to the symptom in time and space.

### 3. Choose an error model and apply it consistently

**Multiple valid error models exist:**
- **Exceptions.** Throw at the failure site, catch at a boundary that knows what to do. Mainstream in Java, Python, C#, JS/TS. The catch-block is where the model earns its keep; bare-catch breaks it.
- **Result types (sum types).** Return `Result<T, E>` or `Either<E, T>`; force the caller to handle or propagate. Mainstream in Rust, Haskell, Scala; emerging in TypeScript via discriminated unions.
- **Explicit error returns.** Return a (value, error) tuple or pair; check the error before using the value. Idiomatic in Go.
- **Panic-and-restart (supervised).** Errors are unrecoverable from the failing process; a supervisor restarts. Idiomatic in Erlang/Elixir; applicable in service-level architectures with a process manager.

The principle is: pick one as the project's default and apply it consistently at boundaries. The red flag is "two or more models mixed without a stated boundary," not "did not pick exceptions."

Within mixed-language or polyglot systems, each language follows its idiom; the boundary translation (exception-to-Result at an FFI layer, Result-to-exit-code at a CLI layer) is itself a deliberate translation, not a leak.

### 4. Retry only on transient failure of idempotent operations, with bounded backoff and jitter (scope: applies to operations on transient or idempotent resources; non-idempotent operations require different discipline)

Retrying a non-idempotent operation that partially succeeded corrupts state. Retrying without bound amplifies the failure into self-inflicted DOS. Retrying without backoff synchronizes clients into thundering-herd waves. Retrying without jitter makes the synchronization worse.

This principle scopes specifically to operations that are safe to retry (idempotent, or transient at a level the retry can recover) and to transient failure modes (network blip, upstream brownout, throttling). It does not apply to permanent failures (validation error, missing resource) or non-idempotent operations (side-effecting POST without an idempotency key).

**Multiple valid retry strategies exist:**
- **Immediate retry (small N).** For very-fast transient failures where backoff would be overkill. Bounded N stays small (2 or 3).
- **Exponential backoff with jitter.** The production-grade default for retries against rate-limited or overloaded upstreams. Brooker's "Exponential Backoff and Jitter" pattern.
- **Circuit breaker.** Fail fast after a threshold; stop retrying for a cooldown window. Useful when retries themselves contribute to the problem.
- **Queue with dead-letter.** For asynchronous workloads; retried by a worker, dead-lettered after N attempts for human inspection.

The principle is: pick a strategy per operation type, document the retry policy (max attempts, backoff curve, jitter, idempotency requirement), and treat the policy as part of the API. The red flag is "retries without a stated policy" or "retries without a stated idempotency requirement."

### 5. Preserve the cause chain

The wrapped-cause chain is the breadcrumb trail for debugging. Wrapping an error in a higher-level error without preserving the cause forces a re-creation of the failure to understand it, which is sometimes impossible (transient, environment-specific, production-only).

The discipline is to use the language's idiomatic cause-preservation mechanism: Python's `raise NewError(...) from e`, Go's `fmt.Errorf("...: %w", err)`, Rust's `source()` chain, Java's `throw new NewException(msg, cause)`. Stripping the cause is the failure mode.

### 6. Exit codes are an API (scope: applies to CLI tools, scripts, and CI integrations)

CI pipelines and shell harnesses dispatch on exit codes. A CLI that returns `1` for "config missing," "network unreachable," and "validation failed" alike collapses distinct failure modes into one signal, forcing brittle stderr text scraping at every consumer.

The discipline is: zero for success, distinct non-zero codes for distinct failure-mode classes, documented in `--help` or the README. The POSIX/sysexits.h conventions provide a small-integer taxonomy that has stood for decades; project-specific codes work too as long as they are stated.

### 7. Error messages are part of the contract

Error messages are read by users, operators, support staff, and other systems. A useless message ("Something went wrong") is the difference between "user retries with a fix" and "user files a ticket"; between "operator restarts the right service" and "operator restarts everything." A message must name the entity, the operation, and the actionable next step.

Cross-reference: the [`security`](../security/SKILL.md) skill carries the "do not concatenate user input into error messages" check; this skill carries the "messages are a contract" framing.

Cross-reference: errors are emitted at error boundaries through the project's logger, structured per the [`logging`](../logging/SKILL.md) skill, with the cause chain (principle 5) attached as fields rather than flattened into a string. The boundary log line is where the typed taxonomy, the preserved cause, and the actionable message become a queryable event for operators and agent reviewers. See `logging` principle 8 ("log at the seams") for where these emissions belong.

## Red Flags - STOP

- Generic `Exception` / `Error` / `panic` without a typed taxonomy: callers cannot dispatch on failure mode
- Bare `except:` or `catch (e) {}` blocks that swallow the error without rethrow, log, or recovery action
- Ignored `Result` or error-tuple returns: the type system or the convention required handling, the caller skipped
- Retry without bound, without backoff, or without jitter on transient failure
- Retry of a non-idempotent operation without an idempotency key or a stated safety argument
- Two or more error models mixed within one boundary without a translation layer
- Re-raising loses the original cause: `raise NewError("wrapped")` without `from e`; `fmt.Errorf("...: %v", err)` instead of `%w`; `throw new Error("wrapped: " + e.message)` that drops the stack
- CLI returns the same exit code for distinct failure modes; CI cannot dispatch
- Error message says "Something went wrong" without the something: no entity, no operation, no actionable next step
- Error string built from unsanitized user input (cross-reference: [`security`](../security/SKILL.md) skill)

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "Catching everything is defensive" | Catching everything is silencing everything; the system limps on in a broken state |
| "We do not need typed errors, the message is enough" | Callers parse strings; strings change; the parsing breaks silently |
| "Retries with no bound just keep trying until it works" | They amplify the failure into self-inflicted DOS and synchronize clients into thundering-herd waves |
| "This operation is idempotent enough" | Either it is or it isn't; "enough" is how partial-success state corruption ships |
| "Wrapping is wrapping; the cause is in the message" | The cause chain is a structured object; stripping it forces re-creation of the failure to debug |
| "One exit code is fine, the message has the detail" | CI dispatches on the code; stderr text scraping is brittle and breaks on translations |
| "The user will figure out what 'error' means" | The user files a ticket; the ticket queue grows; the contract failed |
| "Throwing is the language idiom; we do not need Result" | Pick one model and apply it consistently; the failure mode is mixing without a boundary |
| "We can choose the error model later" | Later, every module has chosen its own; the boundary translation is now a rewrite |

## Key Patterns

```
✅ raise NotFoundError(f"user {user_id}") from e
❌ raise Exception("not found")
```

```
✅ try: ... except SpecificError as e: log.error(...); raise
❌ try: ... except: pass
```

```
✅ Retry with exponential backoff + jitter, max 5, only on TransientUpstreamError, only on idempotent ops
❌ while True: try: call(); break; except: continue
```

```
✅ fn fetch(id: Id) -> Result<User, FetchError> { ... }   (callers must handle or propagate)
❌ fn fetch(id: Id) -> User { ... panic!(...) ... }       (panic mid-call leaks the model)
```

```
✅ exit 0 success; 64 usage; 65 data error; 69 unavailable; 78 config missing
❌ exit 1 for everything that isn't success
```

```
✅ "Could not connect to database 'orders' at db.prod.internal:5432: connection refused. Check the DATABASE_URL env var or the network to db.prod.internal."
❌ "Database error"
```

```
✅ fmt.Errorf("fetching user %s: %w", id, err)
❌ fmt.Errorf("fetching user %s: %v", id, err)
```

## Why This Matters

Error handling is one of the highest-leverage discipline domains in a system because it surfaces at exactly the moments the system is most stressed. A brittle error model means production incidents are debugged by intuition because the cause chain was stripped, retries without backoff turn a brownout into an outage, and silenced errors mean ghost bugs that surface weeks later in unrelated areas.

Without typed-and-deliberate error handling:

- Callers either catch everything (and silently mishandle) or catch nothing (and crash on anything).
- Retries amplify upstream stress into self-inflicted DOS; thundering-herd waves take services down.
- Silenced errors become ghost bugs; the system limps on and the consequence surfaces later, far from the cause.
- Users see "something went wrong" and file tickets; operators restart everything because they cannot tell what to restart.
- CI pipelines dispatch on stderr text scraping because exit codes are uninformative; the dispatch breaks on translation, formatting, or upgrade.

With typed-and-deliberate error handling:

- Callers dispatch on error kind; recovery logic is local to the kind.
- Retries are bounded, backed off, jittered, and only on safe-to-retry operations.
- Errors flow to a place that decides; nothing is swallowed silently.
- Users and operators see actionable messages; tickets and pages drop in volume.
- CI pipelines dispatch on exit code; the dispatch survives upgrades and translations.

**Error handling is also an agent-facing feedback channel.** As LLM-driven test, review, and debugging agents become a regular part of the development loop, typed errors with structured fields and preserved cause chains are how those agents diagnose failures from logs alone, without re-running the system. A `NotFoundError(entity="user", id=...)` with its cause chain intact is a queryable event; a stringified "something went wrong" is opaque prose the agent must guess at. Codebases whose errors are typed, propagated deliberately, and logged structurally at the boundary (see [`logging`](../logging/SKILL.md) skill) are codebases where an agent can reconstruct what failed and why from the runtime trace, instead of re-running the failing scenario to learn what the code already knew.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** generic exceptions are tolerable; the goal is to learn whether the thing works at all. Awareness that the error taxonomy will need to be stated when the project leaves the prototype stage. Do not yet swallow errors; let crashes be loud.
- **Growing internal tool:** name the top three or four error kinds the tool surfaces (config error, transient upstream error, validation error, permission error). Choose an error model and apply it consistently. Replace bare-catches with specific-catches. Log structurally at error boundaries.
- **Shared library:** the error taxonomy is part of the public API. Cause chain is preserved across the public surface. Retry policies are documented per operation. Exit codes (if a CLI) are documented in `--help`. Error messages name entities and actions.
- **Production service:** retry policies enforced via shared utilities (exponential backoff with jitter as the default). Idempotency keys required for retried mutating operations. Circuit-breaker pattern at integration boundaries that have brownout history. Error boundaries route to structured logging and alerting.
- **Safety-critical:** error taxonomy is reviewed at design time. Every retry has a stated safety argument. Cause chains are mandatory in incident retrospectives. Errors-as-observable-events is part of the release artifact: messages, codes, and propagation paths are tested.

## References & rationales

- **Joe Armstrong, "Let It Crash" (Erlang/OTP).** Backs principle 2 (do-not-swallow) from the supervised-restart direction. The supervisor/restart model: design components to fail cleanly and let a supervisor decide recovery; do not paper over errors with defensive code.
- **Andy Hunt and Dave Thomas, *The Pragmatic Programmer* (1999, 2019).** Backs principle 2 (assertive programming, "crash early"). Visible failure beats silent degradation; bare catches are a form of silent degradation.
- **Bruce Eckel, *Thinking in Java* (4th ed.).** Backs principle 1 (typed taxonomy). The chapter on exceptions, checked vs unchecked, and the design pressure of forced handling.
- **Joel Spolsky, "Exceptions" (Joel on Software, 2003).** Backs principle 3 (pick a model). The spectrum debate between exceptions and return codes; the principle of consistency across a project.
- **Roberto Ierusalimschy, *Programming in Lua*.** Backs principle 3 (pick a model). The `pcall`/`xpcall` model and the explicit-error-handling lineage; error handling as a first-class language concern.
- **Rust's `Result<T, E>` and `?` operator.** Backs principle 1 (typed taxonomy) and principle 3 (Result model). The modern reference for typed propagation discipline; the compiler enforces that errors are either handled or propagated.
- **Kent Beck, *Test-Driven Development by Example* (2003).** Backs principle 1 (the taxonomy is testable). Tests that name the failure mode make the taxonomy part of the design vocabulary.
- **Cindy Sridharan, *Distributed Systems Observability* (2018).** Backs principle 7 (messages as contract). Errors as observable events; the operator-facing quality bar.
- **Google SRE Book (Beyer et al., 2016).** Backs principle 4 (bounded retries, retry budgets). The chapter on handling overload and the retry-budget pattern.
- **Marc Brooker, "Exponential Backoff and Jitter" (AWS Architecture Blog, 2015).** Backs principle 4 (backoff and jitter specifically). The canonical demonstration that jitter prevents thundering-herd synchronization.
- **POSIX `sysexits.h` conventions (Eric Allman, BSD sendmail).** Backs principle 6 (exit codes as API). The canonical small-integer exit-code taxonomy.
- **Python PEP 3134, Go 1.13 `errors.Is`/`errors.As` and `%w`, Rust `std::error::Error::source`.** Back principle 5 (preserve cause chain). The language-idiomatic mechanisms for cause preservation.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific tools.

- **Typed errors:** Rust `thiserror` and `anyhow`; Python's `dataclass`-based exception hierarchies; TypeScript discriminated unions and `neverthrow` or `Effect`; Go's `errors.Is`/`errors.As` for typed-error inspection; Scala's ADTs and Cats `Either`.
- **Retry libraries:** tenacity (Python), retry / async-retry (JS/TS), backoff (Go), failsafe (Java), Polly (.NET). Pick one and centralize the policy; do not scatter ad-hoc retry loops.
- **Circuit breakers:** resilience4j (JVM), Polly (.NET), opossum (JS/TS), Hystrix-historical and its Go and Python successors. Useful at boundaries with brownout history.
- **Error reporting and aggregation:** Sentry, Bugsnag, Rollbar, Honeybadger for application-level error capture; structured-logging integration (see [`logging`](../logging/SKILL.md) skill) feeds the same channel.
- **Exit-code discipline:** language-native; document codes in `--help`. The sysexits.h table is a sensible starting taxonomy for CLI tools.
- **Idempotency keys:** native to many cloud APIs (Stripe, AWS); for self-built services, a simple table of (key, request-hash, result) keyed on a client-supplied UUID is the production-grade pattern.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/error-handling/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
