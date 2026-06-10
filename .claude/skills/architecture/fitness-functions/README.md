# Fitness Functions

Deep-dive companion to the `architecture` SLP, principle 9 (evolutionary architecture).

This document expands on the framing introduced by Neal Ford, Rebecca Parsons, Patrick Kua, and Pramod Sadalage in *Building Evolutionary Architectures* (2nd ed., 2023): treating architectural decisions as testable claims about the system's characteristics, rather than as folklore enforced by code review.

## The scope of architecture

Architecture serves two intertwined sets of requirements:

1. **Functional requirements.** What the system does for its users.
2. **Architectural characteristics** (also called non-functional requirements or "the -ilities"). The capabilities the system must preserve while delivering its functional requirements: reliability, scalability, security, auditability, performance, evolvability, maintainability, accessibility, modularity, and others appropriate to the domain.

A complete architectural specification names both. Most projects under-specify the second list; anything not named cannot be designed for and degrades silently.

Architectural characteristics trade off against each other. High security typically costs latency. High scalability typically costs consistency. Strong evolvability typically costs short-term simplicity. The architect's job is not to maximize each but to **name them, prioritize them for this system, and then keep them honest as the system changes**.

## Fitness functions: the unit-test analogue

> Fitness functions are to architectural characteristics what unit tests are to domain logic.

A **fitness function** is an automated check that validates an architectural characteristic is still being preserved. Each named characteristic gets at least one fitness function. Together they form the **system-wide fitness function**: the composite verification that the architecture, as a whole, still meets its specification.

The analogy is load-bearing:

| Domain logic | Architectural characteristic |
|---|---|
| Unit test | Fitness function |
| Run on every commit | Run on every commit (or continually) |
| Failure blocks merge | Failure surfaces drift; severity calibrates response |
| Test the function does what it claims | Test the system preserves what it claims |
| Caught regressions early | Catches architectural erosion early |

Where unit tests guard a function's behavior, fitness functions guard the system's shape, performance envelope, security posture, and structural integrity.

## Metric vocabulary

These are the recurring metrics that show up as fitness functions in practice. Not every system needs all of them; pick the ones that map to the characteristics you have actually named.

**Structural metrics** (from Robert C. Martin's package metrics, originally for Java packages, broadly applicable to any module system):

- **Afferent coupling (Ca):** number of modules that depend on this module. High Ca means many things break if this module changes.
- **Efferent coupling (Ce):** number of modules this module depends on. High Ce means this module is fragile to upstream changes.
- **Instability (I = Ce / (Ca + Ce)):** ranges 0 (maximally stable, only depended on) to 1 (maximally unstable, only depends). Domain core should trend toward 0; transport adapters toward 1.
- **Abstractness (A):** ratio of abstract types to concrete types in a module. High A means highly abstract; low A means concrete.
- **Distance from main sequence (D = |A + I - 1|):** the diagonal where a module's abstractness matches its instability. D close to 0 is healthy; D close to 1 is a "zone of pain" (concrete and stable, hard to change) or "zone of uselessness" (abstract and unstable, no one uses it).

**Complexity metrics:**

- **Cyclomatic complexity:** number of linearly independent paths through a function. Proxy for testability and review difficulty.
- **Cognitive complexity** (SonarSource): a more reading-focused complexity score that penalizes nesting and breaks in linear flow more heavily than cyclomatic complexity. Proxy for human comprehension cost.

**Direction metrics:**

- **Import directionality:** does a higher-stability module ever import a lower-stability one? In a clean / hexagonal / onion architecture, the answer must be no. Architecture-test tools (ArchUnit, dependency-cruiser, import-linter) check this mechanically.
- **Cycle detection:** any cycle in the module graph collapses two modules into one with two names. Acyclic Dependencies Principle violations are a fail condition.

**Behavioral metrics** (require running the system):

- **Latency percentiles (p50, p95, p99):** for the performance characteristic.
- **Error rate / availability / SLO burn:** for the reliability characteristic.
- **Throughput and saturation:** for the scalability characteristic.
- **Vulnerability counts and severities** (from SCA, SAST, DAST scans): for the security characteristic.

## Categories of fitness function

Ford et al. classify fitness functions along three orthogonal axes. Knowing where a check lives on each axis helps decide where it runs and how it fails.

**Atomic vs holistic.** An atomic fitness function checks one characteristic in isolation (e.g., "no module imports a database driver outside the adapters layer"). A holistic fitness function checks the interaction of multiple characteristics under combined load (e.g., "p99 latency stays under 200ms while authn is under attack-load"). Holistic checks are harder to author and slower to run; reserve them for characteristics that cannot be validated in isolation.

**Triggered vs continual.** Triggered fitness functions run on a specific event: every commit, every PR, every release, every deploy. They are the unit-test analogue. Continual fitness functions run constantly in production: SLO monitors, anomaly detectors, drift watchers. They catch the failures that only appear under real workload.

**Static vs dynamic.** Static fitness functions analyze the code without running it (architecture tests, lint rules, dependency-graph checks, type checks, secret scans). Dynamic fitness functions run the system and measure its behavior (load tests, chaos experiments, performance probes). A mature system has both: static checks fail fast and cheap; dynamic checks catch the things only emerging behavior reveals.

A useful exercise: for each named characteristic, identify at least one triggered+static check (cheap, run on every commit) and at least one continual+dynamic check (expensive, run in production). The first prevents most regressions; the second catches the ones the first cannot see.

## The system-wide fitness function

The system-wide fitness function is the **composition** of the individual ones. It is what you consult when evaluating a proposed change that shifts characteristics against each other.

A new caching layer might improve latency (performance ↑) at the cost of stronger consistency guarantees (reliability ↓). The system-wide fitness function does not tell you the right answer; it tells you **what changed and by how much** so the trade-off is visible. Without it, the trade-off is asserted rather than measured, and the loser quietly degrades over time.

The composition does not need to be a single number. In practice it is a **dashboard or a check-suite** that surfaces each characteristic's current value, its budget, and its trend. The discipline is that no characteristic can quietly drift past its budget without someone noticing.

## Incremental change: pipelines and feature flags

Evolutionary architecture and continuous delivery are mutually reinforcing. Fitness functions only help if they run on a pipeline that gates change. Two pipeline practices matter:

- **Deployment pipeline.** Triggered+static fitness functions (architecture tests, complexity gates, security scans, build-time checks) run on every commit; the build fails on regression.
- **Integration pipeline / production checks.** Continual+dynamic fitness functions (SLO monitors, performance probes, chaos drills) run in or against production; alerts fire on regression.
- **Feature flags for production QA.** Risky changes ship dark behind flags so dynamic fitness functions can validate them under real load before enabling for users. The flag is itself part of the fitness regime: it enables measurement before commitment.

If a fitness function exists but the pipeline does not gate on it, the fitness function is decorative. The audit-and-block step is what makes the rule load-bearing.

## Outcome over implementation

A recurring trap is to specify the **implementation** of a characteristic rather than the **outcome**. "We use bcrypt for password hashing" is an implementation; "stored credentials are not recoverable in finite time on commodity hardware" is an outcome. The outcome survives a future migration off bcrypt; the implementation does not.

Fitness functions should encode outcomes wherever possible. When the only available check is implementation-shaped (e.g., "this module exists" rather than "this property holds"), note the gap explicitly and look for a stronger check as the system matures.

## Anti-patterns and red flags

- **Named characteristics with no fitness function.** The characteristic is aspirational, not enforced. It will degrade.
- **Fitness functions that exist but do not gate.** The pipeline runs the check and ignores the result. Equivalent to no check.
- **Implementation-shaped checks instead of outcome-shaped.** Brittle to refactoring; the check fails on safe changes and passes on unsafe ones.
- **Only static, never dynamic** (or only dynamic, never static). Half the failure modes are invisible. A mature system has both.
- **Only triggered, never continual.** Production-only failures (load, scale, real workload patterns) are missed.
- **One fitness function per characteristic forever.** Characteristics evolve as the system matures; fitness functions need pruning, replacement, and addition over time.
- **Fitness functions that the team does not own.** A check imposed by an external team and never tuned drifts into noise; the team mutes the alert.
- **Trade-offs made without consulting the system-wide fitness function.** Decisions land in PRs without the characteristic budgets on the table; degradation is invisible until users notice.

## Maturity progression

Soft sketch; how a fitness regime typically grows alongside the system.

- **POC / prototype:** no named characteristics yet; no fitness functions. Acceptable. Awareness that the first one named (often "deploys must pass tests") is the seed of the regime.
- **Growing internal tool:** two or three characteristics named (commonly performance, security, modularity). One static check per characteristic in CI: a complexity gate, a secret scan, an architecture test for module direction. No continual checks yet.
- **Shared library:** module-graph fitness function (acyclic, direction-respecting) on every commit. Public API surface check. Distance-from-main-sequence trend tracked. First continual check appears (at minimum, a build-failure SLO).
- **Production service:** every named characteristic has at least one triggered+static check **and** one continual+dynamic check. The system-wide composition is a dashboard the team consults during design review. Trade-off decisions are documented (often as ADRs) with the budget impact stated.
- **Safety-critical:** the system-wide fitness function is a release gate. No release ships if any characteristic is in budget breach. Trade-offs are made with the fitness data on the table; ADRs cite the relevant budgets. Holistic fitness functions (combined-load checks) cover the multi-characteristic interactions that matter most.

## Cross-references

- `../SKILL.md`: the architecture principle doc; principle 9 is the entry point.
- *Building Evolutionary Architectures* (Ford, Parsons, Kua, Sadalage, 2nd ed., 2023): the canonical source.
- *Designing Data-Intensive Applications* (Kleppmann, 2017): reliability, maintainability, scalability framing for the characteristics list.
- *A Philosophy of Software Design* (Ousterhout, 2018): complexity as the dominant characteristic for many systems; informs the cognitive-complexity fitness function.
