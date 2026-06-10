---
name: dry
description: "Use when reviewing DRY concerns: knowledge-vs-text duplication, repeated business rules across boundaries, magic constants, configuration duplication, copy-pasted test fixtures, premature abstraction risk, rule-of-three for extraction"
---

# DRY

## Overview

DRY (Don't Repeat Yourself) is a principle about knowledge, not text. Done well, every piece of authoritative knowledge in the system has one home, and duplication of incidental text is tolerated until the duplication becomes a maintenance signal. Done poorly, every textual repetition triggers an extraction, the codebase fills with speculative abstractions, and the wrong abstraction becomes more expensive than the duplication ever was.

**Core principle:** Each piece of authoritative knowledge has a single representation. Incidental text-level repetition waits for the third concrete case before extraction. The wrong abstraction is more expensive than duplication.

> **Skill cross-reference.** A peer reference doc lives at `../software-leverage-review/references/dry.md` for the orchestrator's synthesis pass. This SKILL.md presents the principle-doc shape; the two artifacts share content but serve different audiences.

## Core Principles

### 1. DRY is about knowledge, not text

Hunt and Thomas's original framing: "every piece of knowledge must have a single, unambiguous, authoritative representation within a system." The principle is about authoritative knowledge: business rules, domain invariants, configuration values, validation logic. Text that happens to look similar but represents different knowledge is not a DRY violation.

The corollary is that two functions with identical bodies that represent different knowledge (an email validator and a URL validator that happen to both call `regex.match`) should not be merged. Two functions with different bodies that represent the same knowledge (an email-validation regex copied into the API layer and the UI layer) is the actual violation.

**Two valid readings of "duplication" coexist:**
- **Knowledge-DRY:** the same authoritative rule (a tax calculation, a permission check, a domain invariant) appears in multiple places. This is the violation Hunt and Thomas named. It is always worth fixing.
- **Text-DRY:** the same characters appear in multiple places. This is a code smell, not necessarily a violation. It may resolve to a knowledge duplication (extract) or to coincidental similarity (leave alone).

The principle is: distinguish them when reviewing. The red flag is "treats text-DRY and knowledge-DRY as the same thing," not "tolerates any textual repetition."

### 2. Authoritative business rules live in one place

Business rules and domain invariants (pricing logic, tax calculation, permission checks, validation rules tied to the domain) belong to the domain layer. Adapters delegate; they do not reimplement. An email-validation regex copied into the API layer, the domain layer, and the UI layer is one rule pretending to be three; one of the copies will be subtly wrong, and the wrong one will be the one a user hits.

### 3. Rule-of-three for abstraction extraction (scope: extracting a new abstraction from existing duplication)

This principle scopes specifically to extracting a new abstraction (function, class, module, generic) from existing duplicated code. It does not apply to constants: a literal value that is genuinely the same value should be named on first appearance, not on third.

When the scope applies: wait for three concrete cases before extracting. Two cases are not enough signal to know the shape of the abstraction; the third case reveals which parts are stable and which vary. Extracting at two often produces an abstraction that warps when the third case arrives, and now every caller has to bend.

**Multiple valid extraction styles exist:**
- **Rule-of-three (Fowler).** Wait for three concrete cases before extracting. The default for shared code paths.
- **Immediate-extract.** Extract on first appearance when the abstraction is obviously stable (a domain primitive, a single-purpose helper). Common for constants and named values.
- **Accept-duplication-tax (Metz).** Tolerate duplication indefinitely when the cost of a wrong abstraction would exceed the cost of maintaining the duplicates. Common at module boundaries where premature coupling is the bigger risk.

The principle is: pick a default for the project and state when the alternatives apply. The red flag is "no stated stance on when to extract," not "did not pick rule-of-three."

### 4. Constants name knowledge on first appearance

A literal number, string, or regex that means something ("the timeout we agreed on," "the maximum retry count," "the API base URL") is a knowledge artifact. Inline literals strip the meaning, leaving future readers to grep for the value and hope. This is the immediate-extract case from principle 3: a constant naming the same value in multiple places is one piece of knowledge with one representation.

The exception is a literal that genuinely means itself (`if x == 0`, `for i in range(2)`); naming it `ZERO` or `TWO` adds noise without knowledge.

### 5. Configuration values have one source of truth

The same default port, timeout, URL, or feature flag declared independently in `.env`, a settings module, a CI config, and a Docker file is configuration drift waiting to surface. One canonical source (a typed config module) is the only durable answer; everything else refers to it.

Cross-reference: the [`configuration`](../configuration/SKILL.md) skill carries the typed-config principle; this skill carries the don't-duplicate-the-value-across-files check. Cross-reference: the [`types`](../types/SKILL.md) skill applies the same one-source rule to type definitions (schema and interface derived from one source via inference or codegen, not maintained in parallel). Cross-reference: the [`developer-experience`](../developer-experience/SKILL.md) skill carries the recipes-call-scripts discipline that prevents the same shell snippet duplicating across multiple task-runner targets.

### 6. Test fixtures are factored, not copy-pasted

The same user, order, or event payload constructed verbatim across dozens of test files is knowledge duplication: when the fixture's shape changes (a required field added), every copy must be updated, exactly when you most need confidence the tests still test what they claim. Builders, factories, or shared helpers concentrate the knowledge.

This is knowledge-DRY: the fixture represents a domain object with invariants, not just a similar-looking blob.

### 7. Tolerate duplication when the abstraction would couple unrelated cases

Sandi Metz's clarification: the wrong abstraction is far more expensive than duplication. When a candidate abstraction would force unrelated cases to share a shape they should not share, the right move is to inline it back and accept the duplicates. Signs that an abstraction is wrong: callers pass flags to opt out of the abstraction's behavior; the abstraction has special-case branches per caller; the abstraction's parameters are mostly used by one caller and ignored by the others.

Inlining a wrong abstraction back into duplication is a refactoring, not a regression. It restores optionality the abstraction took away.

Cross-reference: the [`developer-experience`](../developer-experience/SKILL.md) skill applies this rule to task-runner recipes: logic lives in scripts that are reusable from CI, other recipes, and the contributor's shell, so the same behavior is not duplicated across YAML or makefile bodies.

## Red Flags - STOP

- Knowledge-level duplication: the same business rule, domain invariant, or validation logic implemented independently in multiple layers
- Magic literals (numbers, strings, regexes) repeated across files where the value carries meaning, with no shared named constant
- Configuration values declared independently in multiple files (env defaults, URLs, timeouts) with no canonical source
- Test fixtures copy-pasted across dozens of files instead of factored into builders or shared helpers
- Abstraction extracted for 1-2 cases on the basis of speculative future flexibility, with no concrete third case in the codebase
- Wrong abstraction with caller-specific flags, special-case branches, or parameters mostly used by one caller, kept in place because removing it feels like backsliding
- No stated stance on when to extract (rule-of-three vs immediate-extract vs accept-duplication-tax); each PR re-litigates from scratch

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "Two cases are enough, I can see the shape" | Until the third case lands and the abstraction warps |
| "Extracting now saves time later" | The wrong abstraction costs more than the duplication ever would |
| "These two functions look the same, merge them" | They look the same; they may not represent the same knowledge |
| "DRY means no duplicated text" | DRY means no duplicated knowledge; text is a hint, not the rule |
| "We can fix the wrong abstraction later" | Inlining it back feels like regression; teams resist; the abstraction calcifies |
| "The fixture is just a struct, copy-pasting is fine" | Until the struct gains a required field and forty test files need updating |
| "This constant is obvious from context" | Until a future change has no anchor and the literal is hunted by grep luck |

## Key Patterns

```
✅ Email validator lives in domain/email.py; API and UI delegate to it
❌ Same email regex copy-pasted into three layers; one of them drifts
```

```
✅ TIMEOUT_SECONDS = 30 in one place; called everywhere
❌ requests.get(url, timeout=30); requests.post(url, timeout=30); ...
```

```
✅ Three concrete cases of similar code → extract a shared helper
❌ Two cases of similar code → extract a base class with virtual hooks "for flexibility"
```

```
✅ Wrong abstraction with caller flags → inline back; accept duplicates
❌ Wrong abstraction kept and grown to accommodate the next caller
```

```
✅ user_factory.build(role="admin") in tests; one fixture builder
❌ {"id": 1, "email": "a@b.com", "role": "admin", ...} copy-pasted in 40 tests
```

```
✅ DATABASE_URL declared once in typed config; .env references it
❌ DATABASE_URL hardcoded in three configs; one of them is wrong
```

## Why This Matters

Knowledge duplication is one of the most reliable predictors of long-term defect rate, and the wrong abstraction is one of the most reliable predictors of refactor cost. The two failure modes pull in opposite directions: too little extraction breeds drift bugs, too much extraction breeds calcified abstractions. The principle is to extract knowledge once and tolerate text-level coincidence, not to chase textual identity at the expense of optionality.

Without DRY discipline calibrated to knowledge:

- Business rules drift across layers; the wrong layer's copy ships the bug.
- Constants scattered as magic numbers strip meaning from the codebase.
- Configuration values disagree silently across files; environments go off-script.
- Test fixtures duplicated across files block refactors; the test suite ossifies.

Without rule-of-three discipline:

- Speculative abstractions warp when real cases land; every caller bends.
- Wrong abstractions calcify because removing them feels like regression.
- The codebase fills with shared helpers nobody reuses but everyone has to read.

With both calibrated:

- Knowledge has one home; text-level coincidence is left alone.
- Abstractions arrive when the third concrete case validates the shape.
- Wrong abstractions get inlined back without ceremony; optionality is preserved.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** copy-paste is fine; the project is too small to know which duplication is knowledge-level. Awareness that the third concrete case will be the signal to extract.
- **Growing internal tool:** business rules start consolidating into the domain layer; magic constants get named on first appearance; configuration values get a single source of truth. Test-fixture builders appear when the same payload is constructed in three or more places.
- **Shared library:** the public surface deduplicates rigorously because every duplicate is a contract that diverges. Internal duplication is judged case by case using rule-of-three.
- **Production service:** stated stance on when to extract; PR reviews flag both knowledge duplication and premature abstraction; wrong abstractions are inlined back without ceremony when caller flags accumulate.
- **Safety-critical:** business rules audited for single-source-of-truth at the artifact level; duplication of authoritative rules is a defect, not a style note. Speculative abstractions are scrutinized at design review because they obscure the audit trail.

## References & rationales

- **Andy Hunt and Dave Thomas, *The Pragmatic Programmer* (1999, 20th-anniversary ed. 2019).** Backs principle 1 (knowledge, not text), principle 2 (authoritative rules in one place), and principle 5 (configuration as knowledge). The original DRY framing names knowledge as the unit, and the 20th-anniversary edition explicitly clarifies that DRY is about knowledge, not characters.
- **Martin Fowler, *Refactoring* (1999, 2018).** Backs principle 3 (rule of three) and principle 4 (named constants). The "Magic Number" and "Duplicated Code" smells, and the rule of three as the antidote to over-abstraction.
- **Sandi Metz, "The Wrong Abstraction" (RailsConf 2016).** Backs principle 7 (tolerate duplication when the abstraction would couple). The canonical statement that duplication is far cheaper than the wrong abstraction, and that inlining back is the correct refactor.
- **Joel Spolsky, *Joel on Software*, "architecture astronauts" essays.** Backs principle 3 and principle 7 from the speculative-abstraction direction. Naming the cost of imagined-future-cases abstraction.
- **Kent Beck, "make it work, make it right, make it fast" (Smalltalk lineage; restated in TDD).** Backs principle 3 (sequencing). Factor common code only after the duplication becomes a real maintenance signal, not before.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific tools.

- **Duplication detection:** jscpd (cross-language), PMD's CPD (Java/JS/others), SonarQube duplication metrics, semgrep custom rules for cross-layer rule duplication. Useful as a smell-finder, not a verdict.
- **Test-fixture factoring:** factory-boy / model-bakery (Python), faker plus a factory pattern (JS/TS), test-data builders (any language). The pattern matters more than the library.
- **Configuration single-source:** a typed config module (Pydantic Settings, zod, viper, figment) read once and referred to everywhere; see the [`configuration`](../configuration/SKILL.md) skill for the broader discipline.
- **Magic-number naming:** language-native constant declarations; ESLint `no-magic-numbers` (with sensible thresholds) for the smell-detection pass.
- **Refactoring discipline:** any modern IDE's extract-method, extract-variable, and inline refactorings make the rule-of-three move and the wrong-abstraction inline-back move equally cheap. The cost of inlining back must stay low for principle 7 to be practiced.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/dry/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
