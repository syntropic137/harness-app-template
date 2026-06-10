---
name: testing
description: Use when reviewing testing concerns: pyramid coverage (unit, integration, E2E), test code quality, TDD discipline, regression discipline, FIRST principles, feedback-loop speed
---

# Testing

## Overview

Tests are how a codebase keeps the option to change. Without them, refactoring is fear-driven, regressions ship to users, and confidence in releases erodes. With them, refactoring becomes a daily activity and releases become routine.

**Core principle:** Tests are production code. Treat them with equal rigor.

## Core Principles

### 1. The Testing Pyramid

A heuristic for how to distribute the test suite across speed-vs-feedback tradeoffs.

- **Unit tests** form the broad base. Fast, automated, target ≥90% coverage. Run in QA scripts and CI on every commit. They give the tightest feedback loop.
- **Integration tests** verify module wiring. Smaller in number than unit tests; slower; hit real collaborators where feasible. Each one should test a real boundary, not a mocked one.
- **End-to-end tests** simulate real user scenarios from UI or API down to the database. Smallest in number; slowest; most expensive to maintain. Reserved for the critical paths.

The pyramid encodes the speed-vs-feedback tradeoff: more tests at the base, fewer at the top.

### 2. Test code is production code

Test code follows the same discipline as production code: SOLID, DRY, clean naming, refactored when it grows. Often a bespoke testing framework grows around the codebase to extract setup, fixtures, and assertions; that framework is itself production code.

Maintainable tests enable confident refactoring. Without confident refactoring, the codebase ossifies.

### 3. FIRST (unit tests)

Unit tests should be:

- **Fast.** Slow tests stop being run.
- **Independent.** Order of execution must not matter.
- **Repeatable.** Pass or fail consistently in any environment.
- **Self-validating.** Pass/fail is automatic, no human inspection.
- **Timely.** Written close to the production code that exercises them.

Integration and end-to-end tests inherit Independent, Repeatable, and Self-validating. Fast and Timely apply less strictly: integration tests deliberately accept some setup cost in exchange for verifying real boundaries, and E2E tests are written after the integration surface stabilizes.

Cross-reference: the [`continuous-delivery`](../continuous-delivery/SKILL.md) skill carries the pre-merge gate, sub-10-minute feedback budget, and flake-quarantine policy that turn a maintained test suite into the always-green invariant downstream practices ride on. Cross-reference: the [`types`](../types/SKILL.md) skill carries the static side of the same fast-feedback discipline; a strong type system eliminates whole categories of test that would otherwise be needed. Cross-reference: the [`developer-experience`](../developer-experience/SKILL.md) skill carries the recipes-call-scripts discipline that keeps task-runner glue testable here rather than buried inline in a justfile.

### 4. Test-driven development (when feasible)

Three laws (Robert C. Martin's formulation of Beck's discipline):

1. You may not write production code until you write a failing unit test.
2. You may not write more of a unit test than is sufficient to fail.
3. You may not write more production code than is sufficient to pass the current failing test.

Cycle: focus, make it work, then iterate on performance and clarity. Apply when the design is clear enough; exploratory work may legitimately defer. **Tests-after-implementation is the worst-case floor, not the target.**

**TDD is also a design methodology.** Code that is easy to test tends to be modular: small surface area, clear inputs and outputs, minimal hidden coupling. Writing the test first forces you to design for testability, which is design for modularity. If a piece of code is hard to test, that is a signal about its design, not just its tests.

The discipline therefore serves two purposes: it keeps you focused on the next concrete piece of work, and it pulls the codebase toward a more modular shape. Use it when the problem is clear enough to drive the test; skip it when the work is genuinely exploratory. Either way, every new feature must end up tested; the coverage gate enforces this regardless of whether tests came before or after the production code.

### 5. Regression discipline

Every bug fix starts with a failing test that reproduces the bug. Then fix. Then the test passes. The regression test:

- Validates the fix actually addresses the symptom.
- Prevents the same bug from recurring silently.

Don't fix without first writing the failing test.

Cross-reference: the [`principles-and-patterns`](../principles-and-patterns/SKILL.md) skill carries the stewardship discipline (Boy Scout Rule, Broken Windows, technical debt as a managed quantity); a green regression suite is the precondition that lets debt be paid down by refactoring without fear. Cross-reference: the [`software-complexity`](../software-complexity/SKILL.md) skill carries the cost framing (maintenance dominates implementation) that explains why the regression-test investment pays back over a long-lived codebase.

### 6. Readability via patterns

Each test states intent first, then exercises behavior, then asserts. Use Given/When/Then (BDD) or Arrange/Act/Assert or Build/Operate/Check. Extract setup into reusable factories or fixtures. Tests that read like prose make refactoring safer because the intent survives implementation changes.

### 7. Test locality

Tests should be discoverable from the code they test. Two layouts both work; both reduce context switching:

- **Mirror layout:** a parallel `tests/` tree that mirrors `src/`. `src/auth/login.py` has its tests at `tests/auth/test_login.py`. Predictable; language-conventional in many ecosystems.
- **Co-location:** tests sit next to the code under test. `src/auth/login.py` and `src/auth/login.test.ts` (or `login_test.go`) in the same directory. Reduces the cognitive cost of switching between subject and test; surfaces missing tests by their absence.

Pick one convention and stay consistent within a project. Mixing without a stated rule fragments discoverability and erodes the value either approach offers.

Cross-reference: the [`developer-experience`](../developer-experience/SKILL.md) skill carries the recipes-call-scripts discipline; those scripts are testable code and inherit the rules above.

## Red Flags - STOP

- Test coverage below the project's stated target (default ≥90% unit) without justification
- Tests don't follow GWT, AAA, or BOC patterns; intent is unclear from a quick read
- Test setup copy-pasted across files instead of factored into reusable fixtures
- Bug fixed without a regression test
- Unit tests violate FIRST: slow, order-dependent, flaky, require manual validation, or written long after the production code (integration/E2E tests inherit only Independent, Repeatable, Self-validating)
- Test suite exists but no CI invocation; tests never run automatically
- Mocked database in integration tests when a real one is feasible
- Aggressive mocking spread across the suite for speed at the cost of integration-boundary verification
- No stated test-locality convention (mirror under `tests/`, or co-locate with source); discoverability suffers when half the tests live in `tests/` and half live next to source
- Test names describe code mechanics ("test_function_returns_value") instead of behavior ("test_login_rejects_unknown_email")

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "We'll add tests later" | Later doesn't come; refactor confidence is eroded already |
| "TDD slows us down" | Untested code accumulates technical debt faster than tests slow you |
| "These are throwaway scripts" | Throwaway scripts become production by accident |
| "Mock everything for speed" | Integration boundaries hide bugs; mocks lie quietly |
| "Coverage is just a number" | Coverage with enforcement signals discipline; without enforcement it drifts down silently |
| "TDD doesn't apply to exploratory work" | True for the exploratory phase; once the design lands, tests follow |
| "The tests are flaky, just retry" | Flaky tests are bugs; retrying hides the signal |
| "We don't need integration tests, the units are tested" | Integration boundaries are where most production bugs live |

## Key Patterns

```
✅ test_login_rejects_unknown_email     (behavior named)
❌ test_login_method_returns_false       (mechanics named)
```

```
✅ Bug found → write failing regression test → fix → test passes → commit both
❌ Bug found → fix → commit (no regression test)
```

```
✅ Coverage 92% with CI gate at 90%; decline below blocks merge
❌ Coverage measured but not gated; drift is invisible
```

```
✅ Integration tests hit real DB (ephemeral container or test DB)
❌ Integration tests mock the DB; "integration" in name only
```

```
✅ // Given a registered user with valid credentials
   // When they POST /auth/login with correct password
   // Then the response is 200 with a JWT
❌ Test body interleaves setup, action, and assertion; intent unclear
```

## Why This Matters

Tests are the artifact that lets a codebase remain editable. The cost of skipping them is not paid at write time; it is paid at every subsequent change. A test suite is the team's collective memory of "what this is supposed to do," validated mechanically.

Without a real test suite:

- Refactoring becomes fear-driven; technical debt compounds quietly.
- Regressions ship to users; the bug rate climbs.
- New contributors cannot move safely; onboarding stalls.
- Releases get bigger and rarer because each one is risky.

With a real test suite:

- Refactoring is a daily activity, not a project.
- Bug fixes carry their own proof.
- Onboarding accelerates; new contributors learn the system through its tests.
- Releases are routine.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** maybe one smoke test if you are feeling fancy. Awareness that you will want a real pyramid later. Watch for design choices that lock in shapes you would test.
- **Growing internal tool:** a real test framework chosen and configured; happy-path coverage of the entry points. Regression discipline starts here: every bug fix gets a failing test before it gets a fix.
- **Shared library:** pyramid forms. Target ≥90% unit coverage. CI gate enforces it. Integration tests start hitting real collaborators rather than mocks. Test markers organize the suite (unit, integration, e2e, regression).
- **Production service:** full pyramid. CI gate enforced. Every bug fix carries a regression test. Flaky-test quarantine policy exists. Coverage threshold drift blocks merge. E2E suite covers the critical user paths.
- **Safety-critical:** add property-based testing, mutation testing, formal coverage gates that block merge. Regression tests required before the fix is even committed. Tests are part of the release artifact.

## References & rationales

- **Kent Beck**, *Test-Driven Development by Example* (2003). Backs principles 4 (TDD discipline) and 5 (regression as TDD applied to bugs). The red-green-refactor rhythm and the three-laws formulation come from this lineage.
- **Robert C. Martin**, *Clean Code* (2008). Backs principles 2 (test code as production code) and 3 (FIRST). Also the canonical formulation of the three laws of TDD.
- **Mike Cohn**, *Succeeding with Agile* (2009). Backs principle 1 (testing pyramid as a heuristic for distribution).
- **Vladimir Khorikov**, *Unit Testing: Principles, Practices, and Patterns* (2020). Backs the integration-not-mocked red flag; argues integration tests should hit real collaborators where feasible.
- **Dan North**, BDD origins (2006). Backs principle 6 (Given/When/Then as a readability discipline).
- **Milan Milanović**, *Laws of Software Engineering*. Corroborates principles across the suite; useful as a cross-reference.
- **Martin Fowler**, on testing pyramid critique and integration-test cost. Backs the speed-vs-feedback framing in principle 1 and the "coverage measured but not gated" red flag.
- **J.B. Rainsberger**, "integrated tests are a scam." Backs the integration-not-mocked red flag from the inverse direction: when you call a thing an integration test, integrate.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific frameworks; if a tool here is no longer maintained, the patterns transfer to its replacement.

- **Python:** pytest, pytest-asyncio, coverage.py with pytest-cov, Hypothesis (property-based), mutmut (mutation). Test markers (`pytest.ini` `markers`) organize unit/integration/e2e/regression.
- **JS/TS:** vitest or Bun's built-in test runner for new code; Jest (with ts-jest) for established projects; fast-check (property-based); Stryker (mutation).
- **Rust:** cargo test plus pretty_assertions for readable failures; proptest (property-based); cargo-mutants (mutation).
- **Go:** standard testing, testify, gopter (property-based).
- **End-to-end (any stack):** Playwright is the canonical browser E2E framework; framework-agnostic and supports TypeScript, Python, Java, .NET.
- **Cross-language:** mutation testing as the ceiling discipline; formal coverage gates in CI; property-based testing for invariants that resist enumeration.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/testing/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
