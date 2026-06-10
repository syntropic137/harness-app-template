---
name: configuration
description: "Use when reviewing configuration concerns: env-var layering, typed config objects, startup validation, secret/non-secret separation, schema discoverability, environment-dependent defaults, twelve-factor compliance, magic numbers"
---

# Configuration

## Overview

Configuration is the seam between the same code artifact and every environment it deploys into. Done well, configuration is a single typed surface, validated at startup, with a documented schema and explicit precedence. Done poorly, configuration is a scatter of `os.environ` reads, an unsafe default that silently ships to production, and a tribal-knowledge tax paid by every new contributor.

**Core principle:** Configuration is one explicit, validated, discoverable surface. The application declares it; the environment binds it; startup refuses to proceed if the binding is incomplete.

## Core Principles

### 1. One typed registry is the single source of truth

A single typed config object is the canonical surface for every variable the project reads, and it is the source every downstream tool reads from. Direct env-var reads (`os.environ["X"]` or equivalent) scattered through business logic and request handlers defeat type-checking, default handling, and enumeration. The registry carries name, type, default, description, required-ness, and any cross-cutting metadata (which secret store backs it, which scopes consume it). Tools that generate `.env.example`, sync secrets, run doctor checks, and emit infra params all read from the same object: nothing else in the project is authoritative on these facts.

A contributor should be able to answer "what configuration does this service need" by reading one file, not by grepping the codebase. Magic strings for env-var names (literal `"DATABASE_URL"` recurring across modules) are the most common form of duplication this principle eliminates: the registry holds the name once, and every reader references the typed field, not the literal. See [typed-config-registry/README.md](typed-config-registry/README.md) for Python (Pydantic Settings) and TypeScript registry-object examples.

Cross-reference: the [`dry`](../dry/SKILL.md) skill carries the don't-duplicate-the-value-across-files check that complements the typed-config principle this skill carries.

### 2. Generate the schema; sync the local file idempotently

A service that reads configuration at runtime must ship a discoverable schema. The schema is generated from the typed registry, not hand-maintained: a committed `.env.example` (or JSON Schema) emitted by a script that introspects the registry stays in sync by construction, and reviewers read one diff to see configuration shape change. Hand-edited example files drift the moment a field is added or renamed, and the drift surfaces as a startup error in someone else's environment a week later.

Local `.env` files are populated by the same generator, idempotently: missing keys are added (with a placeholder or default), existing values are preserved, and removed keys are flagged rather than deleted. This is the difference between "regenerate overwrites my local edits" (developer hostile) and "regenerate brings my local file forward" (developer friendly). See `developer-experience` for the broader local-loop story.

### 3. Validate required configuration at startup; warn on missing optionals (scope: long-lived services)

This principle scopes to services with a startup phase that precedes request handling. Long-lived services validate every required value before the first request: a misconfigured deploy must refuse to come up, not half-process traffic and crash deep in a handler. CLI tools and scripts may legitimately validate at first use; document the choice.

Late-binding configuration failures are release-blocking surface area pretending to be runtime errors. They corrupt observability and produce partial outages.

**Calibrate the severity to the requirement.** Required values fail fast: startup aborts with a clear error naming the variable and where to set it. Optional values that are missing log a warning at startup explaining what capability is degraded ("WHISPER_BASE_URL not set; whisper transcription will report disabled-missing-config"), so the operator gets fast feedback without losing the running system. Silent degradation is the worst outcome: the feature is off, no one knows, and discovery happens via a user report. Cross-reference: see `developer-experience` for the broader fast-feedback stance and `logging` for how the warning is shaped.

### 4. Separate secrets from non-secret configuration

Secrets and tunables live in different stores. Mixing them collapses the trust boundary: a developer changing a non-secret tunable is forced through the secret-handling path, and a debugging tool that dumps non-secret config accidentally dumps secrets. The twelve-factor stance is one rule, two stores: secrets in a managed secret store, non-secrets in the environment or a tracked file.

**Multiple valid secret stores exist:** centralized secret manager, cloud-provider native, envelope-encrypted files in source. The principle is: pick one and apply it consistently. The red flag is "secrets and non-secrets in the same namespace," not "did not pick a particular vendor." See the [`security`](../security/SKILL.md) skill for whether secrets exist in source at all.

### 5. No production-relevant defaults

Production-relevant values have no default: the deploy refuses to start if the override is missing. Defaults belong to development and test, where a forgotten override produces a local error rather than an outage or a security incident. A default of `localhost`, `dev`, or a permissive CORS list is fail-open by construction.

### 6. Lift environment-varying values out of code

Timeouts, retry counts, batch sizes, rate limits, and feature toggles that plausibly change across environments belong in configuration, not as magic numbers in source. The tell is whether the value has changed across environments before, or plausibly might. Configurability has a cost (more surface to validate and document), so the test is "does this knob need to turn at deploy time," not "could this conceivably be tuned."

### 7. State the precedence chain explicitly

When two or more configuration sources combine (defaults, files, environment, CLI flags), the order of precedence is documented and applied in one place by the typed config object. Implicit precedence means a contributor changes a value in the obvious place and nothing happens because a different source overrides it silently.

**Multiple valid precedence chains exist:** defaults-then-file-then-env-then-CLI is conventional; other orderings are defensible. The principle is: state the chain and apply it consistently. The red flag is "no stated precedence," not "did not pick the canonical chain."

Cross-reference: the [`environments`](../environments/SKILL.md) skill carries the per-environment parity stance for the loader itself: dev, staging, and production may bind different sources, but the variable names, shape, and precedence chain stay uniform across them.

### 8. Smart defaults absorb accidental complexity

Every application has an irreducible amount of complexity; configuration design decides who pays it. When the registry is a wall of required knobs with no defaults, that complexity flows outward to every operator, contributor, and CI runner. When the registry ships sane defaults for the development path and saves the no-default discipline for genuinely environment-specific values (production endpoints, secrets, scaling parameters), the same code is reachable on a fresh clone with `just up` and locked down at deploy time.

The test for a default is not "could this conceivably differ?" but "does this need to differ to run the project on a teammate's laptop?" Defaults that only make sense for one environment violate principle 5 (no production-relevant defaults). Defaults that absorb the dev path are a force multiplier.

This principle is not "configure less"; it is "configure with hierarchy." Required deploy-time values stay required. Tunables with one obviously-good development value get that value as a default. The cognitive load of running the project converges to the few things that genuinely vary.

### 9. Feature flags are configuration; default to disable, not enable

Feature toggles for testability, A/B testing, and graceful degradation belong in the same typed registry, not in a parallel system. Two patterns recur, and the second is preferred for stable features:

- **`X_ENABLED=true` (opt-in):** every feature requires explicit activation. Useful for genuinely experimental work, but expands the configuration surface for every contributor. The unconfigured default is "off," which silently disables behavior that should be on.
- **`X_DISABLED=true` (opt-out):** the feature is on by default; an explicit flag turns it off. Preferred once a feature is stable: the default path runs the system as designed; operators only set values when overriding behavior. Disable-flags also pair naturally with implicit-disable: when the required configuration for a feature is absent, the feature reports "disabled-missing-config" rather than crashing on first use.

Cross-reference: see `architecture` for feature flags as an architectural seam (toggleable code paths) rather than a configuration encoding. The [`continuous-delivery`](../continuous-delivery/SKILL.md) skill consumes flags as the deploy/release decoupling primitive (gradual rollout, kill-switch abort).

## Red Flags - STOP

- Direct env-var reads (`os.environ["X"]` or equivalent) scattered through business logic and handlers without a central typed config object
- Magic-string env-var names duplicated across modules instead of accessed via the typed registry
- Two or more downstream tools each reimplement the variable list (one for `.env.example`, one for secret sync, one for doctor checks) instead of reading the registry
- `.env.example` is hand-maintained and drifts from the registry; new fields appear in code without a corresponding example entry
- Regenerating the example clobbers a developer's local `.env` instead of overlaying missing keys idempotently
- No committed `.env.example`, JSON Schema, or generated reference listing every variable, its type, and whether it is required
- Required configuration not validated at startup; failures surface during request handling
- Missing optional configuration silently degrades the system with no startup warning; the only signal is a user report that a feature is off
- Secrets and non-secret tunables share a single file or environment namespace
- Defaults that are environment-dependent (`localhost`, `dev`, permissive CORS) without a requirement that production override them
- Magic numbers in code (timeouts, retry counts, rate limits) where deploy-time variation is plausible
- Two or more configuration sources combine with no stated precedence rule, or precedence depends on import order
- Every feature gated behind an explicit `X_ENABLED=true` flag; the default-off shape makes the running system depend on a wall of opt-ins rather than starting up correctly out of the box
- Required-knob sprawl: a fresh clone needs a dozen environment variables set before the project will run locally, when sensible development defaults would have absorbed the complexity

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "It's just one env-var read inline" | Each ad-hoc read forks the configuration surface; a year later there are forty |
| "We'll write the example file later" | Until then, every onboarding starts with a startup-error scavenger hunt |
| "Validation at startup is over-engineering" | The alternative is partial outages where the misconfiguration looks like a request bug |
| "Secrets in the env are fine; nobody can see it" | Logs, debug dumps, and process listings disagree |
| "The default of localhost is harmless" | Until production deploys without the override and silently talks to itself |
| "These constants will never change" | They change at the worst possible moment, and now it's a deploy not a config flip |
| "Precedence is obvious from the code" | Until two sources collide and the loser is wrong silently |
| "Hand-editing `.env.example` is fine; we'll remember to update it" | We won't; the field added in code today ships without an example entry next week |
| "Regenerate is destructive; we'll just keep .env up to date manually" | Manual sync is a tax; idempotent overlay (add missing, preserve existing) makes regenerate safe |
| "Every feature should be opt-in for safety" | Once a feature is stable, opt-in expands the configuration surface for every contributor; opt-out is the smaller default |
| "More knobs is more flexible" | More knobs is more cognitive load; smart defaults preserve flexibility without making operators pay for it |

## Key Patterns

```
✅ Settings = TypedConfig(); from settings import settings; settings.db_url
❌ os.environ["DB_URL"] scattered across modules
```

```
✅ .env.example committed; every required variable listed with type and example
❌ Required variables documented only in the startup error you hit when you forget one
```

```
✅ App refuses to start if DATABASE_URL is missing; clear error names the variable
❌ App starts; first DB-touching request crashes with KeyError deep in a handler
```

```
✅ App starts; logs "WHISPER_BASE_URL not set; whisper feature disabled-missing-config"
❌ App starts; whisper feature is silently off; first user report is the only signal
```

```
✅ Secrets in a managed store; non-secret tunables in env or a tracked file
❌ API keys and feature flags share .env, with no separation of read scope
```

```
✅ No default for PRODUCTION_API_URL; deploy fails closed if missing
❌ Default of "http://localhost:8080" silently ships to prod when override is forgotten
```

```
✅ TIMEOUT_SECONDS = settings.timeout_seconds  (configurable)
❌ requests.get(url, timeout=30)  (magic number; cannot tune without a deploy)
```

```
✅ Documented chain: defaults → file → env → CLI; applied in one place
❌ Some values read from env, some from file; precedence varies by import order
```

```
✅ .env.example regenerated from typed registry by `just gen-env`; CI fails if drift detected
❌ .env.example hand-edited; new field added in code last week is still missing from the example
```

```
✅ `just sync-env` adds missing keys to .env, preserves existing values, prints diff
❌ Regenerate overwrites the developer's local .env; everyone re-enters their secrets
```

```
✅ Sensible dev defaults; production-only values have no default and fail closed
❌ Every variable required; fresh clone cannot start without a wiki-tour of secrets
```

```
✅ WHISPER_DISABLED=true to opt out; default-on with implicit-disable when config missing
❌ WHISPER_ENABLED=true required for every contributor; default-off silently breaks the happy path
```

## Why This Matters

Configuration is the surface where the same code meets every environment. The cost of getting it wrong is paid at deploy time, in incidents, and in the slow tax of every contributor who cannot tell what the service needs to run.

Without disciplined configuration:

- Onboarding is a scavenger hunt across grep results and startup errors.
- Production discovers missing values under load; partial outages look like request bugs.
- Secrets leak into debug dumps because they share a namespace with tunables.
- Forgotten overrides plus permissive defaults produce outages and security incidents.
- Tuning a value requires a code change and a deploy, not a config flip.

With disciplined configuration:

- Every variable is enumerable from a single typed surface.
- Misconfigured deploys refuse to come up; the failure is loud and at startup.
- Secrets and tunables are separated by construction.
- Production-relevant values have no defaults; the deploy fails closed.
- Operators can turn the knobs the application exposes, and only those.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** a `.env.example` exists; configuration is read in one place even if the typed object is rudimentary. Sensible development defaults so the project runs on a fresh clone. Awareness that the schema will need to be discoverable as the surface grows.
- **Growing internal tool:** typed registry in place with field-level descriptions; required values validated at startup; `.env.example` generated from the registry rather than hand-edited; idempotent local-overlay tool. Secrets at least separated into their own file even if not yet in a managed store. Stable features adopt the disable-flag shape rather than opt-in.
- **Shared library:** the library exposes its configuration as part of its public surface (a typed settings object the consuming application instantiates), does not read env-vars itself, and documents every required value. Defaults absorb the common case so consumers configure only what genuinely varies.
- **Production service:** typed registry as the single source of truth for `.env.example` generation, secret sync, doctor checks, and infra param emission; startup validation enforced; secrets in a managed store; precedence chain documented; no production-relevant defaults. Magic numbers reviewed and lifted to config when environment-varying. Feature flags live in the registry.
- **Safety-critical:** configuration schema is part of the release artifact; changes go through change control; secret rotation is automated; configuration drift is detected by tooling. Every required value has provenance: who set it, when, and why. Feature flags audited; disabled features prove their disabled state in monitoring.

## References & rationales

- **The Twelve-Factor App, factor III ("Config"); Adam Wiggins.** Backs principles 1 (centralize), 2 (generate the schema), and 7 (state the precedence chain). The foundational stance that configuration is explicit, external, and the same code artifact deploys to every environment.
- **Michael Nygard, *Release It!* (2nd ed., 2018).** Backs principles 3 (validate at startup) and 5 (no production-relevant defaults). The chapter on dangerous defaults and configuration as a release-blocking surface is the canonical source for fail-fast-at-startup discipline.
- **Andrew Hunt and David Thomas, *The Pragmatic Programmer*.** Backs principle 6 (lift environment-varying values out of code). Configurability as a deliberate tradeoff: surface the knobs operators need, but no more.
- **Twelve-factor stance on secret handling.** Backs principle 4 (separate secrets from non-secrets). Cross-reference: the [`security`](../security/SKILL.md) skill carries the "secrets in source" check; this skill carries the "secrets share a namespace with tunables" check.
- **Milan Milanovic, *Laws of Software Engineering*, "Tesler's Law / Conservation of Complexity" (p. 19).** Backs principle 8 (smart defaults absorb accidental complexity). Every application has an irreducible amount of complexity that can be shifted but not eliminated; good design absorbs it through smart defaults so the operator's surface stays simple.
- **John Ousterhout, *A Philosophy of Software Design* (2nd ed., 2021), "deep modules" and "general-purpose modules are deeper."** Backs principle 8. A configuration surface is a module interface; deep configuration modules expose few knobs and absorb the complexity of making them work, while shallow configuration modules push every decision to the caller.
- **Field example: openclaw-hermes `scripts/config/env.ts`.** Illustrates principle 1 (single typed registry) and principle 9 (`X_DISABLED` opt-out flag, implicit-disable when config missing). The registry is the source consumed by `sync-secrets`, `doctor`, `gen-ssm-params`, and `resolve-env`: nothing else is authoritative on env-var names.
- **Field example: syntropic137 `packages/syn-shared/src/syn_shared/settings/config.py` plus `scripts/generate_env_example.py`.** Illustrates principle 1 (Pydantic Settings as registry with `Field(description=...)`) and principle 2 (`.env.example` generated by introspecting the Settings class).

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific libraries; if a tool here is no longer maintained, the patterns transfer to its replacement.

- **Python:** Pydantic Settings (canonical for typed registry with field-level descriptions and validators); typed-settings as an alternative; `python-dotenv` for `.env` loading in development; cattrs for structured deserialization.
- **JS/TS:** typed object literal with `as const satisfies Record<string, SecretDef>` for the registry shape (see [typed-config-registry/README.md](typed-config-registry/README.md)); zod or io-ts for runtime-validated schemas; convict for layered config; framework-native config (Next.js, NestJS) where the framework provides one.
- **Go:** `viper` or `koanf` for layered config; `envconfig` for typed env-var loading.
- **Rust:** `figment`, `config-rs`, or `envy` for layered/typed config.
- **Java/Kotlin:** Spring Boot configuration properties; MicroProfile Config; Typesafe Config (HOCON).
- **Secret stores:** centralized secret managers (e.g., HashiCorp Vault), cloud-provider native (AWS/GCP/Azure secret services), envelope-encrypted files (sops with age or KMS), 1Password CLI with `op://` references resolved at startup. Choice depends on deployment context; consistency within a project matters more than vendor.
- **Schema discoverability and overlay:** committed `.env.example` generated by introspecting the typed registry (see [typed-config-registry/README.md](typed-config-registry/README.md)); idempotent overlay tool that adds missing keys to a developer's `.env` without overwriting existing values; JSON Schema emitted from the same registry; `--print-config` CLI flag that emits the resolved configuration with secrets redacted.
- **Feature flags:** the typed registry itself, with disable-flag entries (`X_DISABLED`) and per-feature `requiredEnvVars` metadata, is sufficient for most projects. Dedicated platforms (LaunchDarkly, Unleash, OpenFeature) become valuable once flags need runtime targeting, percentage rollouts, or audit trails.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/configuration/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
