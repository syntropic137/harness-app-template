---
name: software-complexity
description: "Use when reviewing software complexity concerns: cognitive load, cyclomatic and cognitive complexity bounds, deep-vs-shallow modules, accidental coupling, premature abstraction, asymmetric simplicity, comments-explain-why"
---

# Software Complexity

## Overview

Complexity is the dominant force in long-lived software. Done well, complexity is paid for: each piece of structure earns its keep by hiding more cost than it imposes, and the system stays editable as it grows. Done poorly, accidental complexity accretes: shallow modules leak implementation into callers, branchy code spreads decisions across functions that should be cohesive, abstractions arrive before their concrete cases, and the common case pays a tax for the rare one.

**Core principle:** Treat complexity as a budget. Pay it deliberately for behavior the system actually needs. Refuse to pay it for speculative flexibility, decorative abstraction, or convenience for the rare case at the expense of the common one.

> **Skill cross-reference.** A peer reference doc lives at `../software-leverage-review/references/software-complexity.md` for the orchestrator's synthesis pass. This SKILL.md presents the principle-doc shape; the two artifacts share content but serve different audiences.

## Core Principles

### 1. Deep modules over shallow ones

A module's value is the ratio of behavior hidden to interface exposed. Deep modules hide a lot of behavior behind a small interface; callers pay a small cost to use them, regardless of how the system grows. Shallow modules expose nearly as much surface as they implement; their cost spreads into every caller, and the system pays the complexity tax everywhere the module is used.

When designing a module, the question is not "how do I split this up" but "what surface does the caller need to know about, and can the rest stay hidden." Splitting for its own sake produces shallow modules; hiding for its own sake produces deep ones.

### 2. Bounded cyclomatic and cognitive complexity (scope: per-function for cyclomatic; per-function or per-module for cognitive)

Branchy code is sometimes essential: each branch is a genuinely distinct case in one cohesive decision. Branchy code is sometimes accidental: the function is doing several jobs and the branches are interleaved across them. The metrics distinguish these by counting structure.

This principle scopes specifically to functions for cyclomatic complexity (decision points within one callable unit), and to functions or modules for cognitive complexity (the human reading cost of nested or broken-flow structure). It does not apply to declarative or table-driven code, where the apparent branching is data, not control flow.

**Multiple valid metric and threshold choices exist:**
- **Cyclomatic complexity (McCabe).** Counts decision points. Mature default for "is this function too branchy?" Thresholds vary by team (10, 15, 20).
- **Cognitive complexity (Sonar / Campbell).** Weights nesting and breaks-in-flow more heavily. Better proxy for human reading cost.
- **Per-team threshold.** Some teams gate at the metric, some review at the metric, some only flag outliers.

The principle is: pick a metric and a threshold, enforce or review consistently, and document the choice. The red flag is "no stated bound and no review-time check," not "did not pick cognitive complexity at 15."

### 3. Orthogonality (no accidental coupling)

Two modules are orthogonal when a change to one cannot reach into the other by surprise. Accidental coupling is the inverse: two modules co-vary because they share an arbitrary assumption (a magic constant, an undocumented ordering, a side effect's timing) rather than a designed contract.

The cost of accidental coupling is invisible until something changes. Then one side breaks silently, the other side ships the bug, and the debug path is "why are these two unrelated-looking things connected?" Orthogonality is the discipline of making the connections visible (a contract, a typed interface, a documented protocol) so they can be designed and reasoned about.

### 4. Rule of three for abstraction extraction (scope: extracting a new abstraction from existing code)

This principle scopes specifically to introducing a new abstraction (base class, generic, strategy interface, shared helper) from existing code paths. It does not apply to abstractions that arise from a stated requirement, where the shape is given by the problem.

When the scope applies: wait for three concrete cases before extracting. Two cases are not enough signal to know which parts are stable and which vary. Speculative abstraction with one or two callers locks the design into a shape future requirements will not fit, and every caller pays the cost of routing around the bad fit.

The corollary, from Sandi Metz: the wrong abstraction is more expensive than duplication. When a candidate abstraction would force unrelated cases to share a shape they should not share, the right move is to leave the duplication and revisit at the third case.

### 5. Make the common case fast and obvious (asymmetric simplicity)

When an API forces the common caller to write boilerplate so the rare caller can be brief, every common-case use pays a tax that compounds across the system. Defaults should favor the common configuration; the rare configuration is allowed to be longer.

This is a design principle, not a metric. The signal is in the API: how much code does the typical caller write to do the typical thing? If the answer is more than the rare-case caller writes, the asymmetry is backwards.

### 6. Essential vs accidental complexity (judgement call; state the reasoning)

Brooks's distinction: essential complexity comes from the problem the system solves; accidental complexity comes from the tools, structure, and decisions imposed on the solution. The distinction is not always crisp; the same code can look essential to one reviewer and accidental to another.

**Multiple valid framings coexist:**
- **Brooks-original.** Essential is irreducible by tooling improvement; accidental is. Strictest reading.
- **Domain-driven.** Essential complexity is domain logic; accidental complexity is plumbing, framework adaptation, infrastructure.
- **Reducibility test.** Could a senior engineer with infinite time write this with substantially less structure? If yes, treat it as accidental.

The principle is: when reviewing, state the framing being used and the reasoning. The red flag is "asserted essential without argument," not "did not pick the Brooks-original framing."

### 7. Comments explain why, not what

When a comment restates the next statement ("// increment counter"), it adds nothing the code did not already say, and it rots when the code changes. Comments earn their keep by capturing the *why*: the non-obvious decision, the reason this branch exists, the reference to the upstream issue, the explanation of a constraint that is not local to this code.

The code itself should answer the *what* via clear naming. When naming cannot carry the meaning, the comment-as-name is a signal to rename, not to comment harder.

### 8. Maintenance cost dominates; design for the long term

Kanat-Alexander's **equation of software design** makes the cost trade explicit:

```
Desirability = (Value Now + Value Future) / (Effort Implementation + Effort Maintenance)
```

A change is worth making in proportion to its current and future value, divided by the effort to implement it and to maintain it. As a system ages, `Value Now` and `Effort Implementation` are paid once; `Value Future` and `Effort Maintenance` are paid every time the code is read, modified, or extended. Over a long-lived codebase the equation reduces to:

```
Desirability ≈ Value Future / Effort Maintenance
```

The practical inversion: **reducing maintenance cost matters more than reducing implementation cost**. A shortcut that ships in a day and costs a week of debugging across the next year has paid the wrong tax. Four supporting laws make the trade specific:

- **Law of Change.** The longer a program exists, the more probable it is that any piece of it will have to change.
- **Law of Defect Probability.** The chance of introducing a defect is proportional to the size of the change.
- **Law of Simplicity.** The ease of maintenance is proportional to the simplicity of the individual pieces.
- **Law of Testing.** The degree to which you know your software behaves is the degree to which you have accurately tested it.

Together they motivate the rest of this skill: deep modules, bounded complexity, orthogonality, and the rule of three are not aesthetic preferences; they are the levers that reduce the maintenance term. Cross-reference: the [`testing`](../testing/SKILL.md) skill carries the operational form of the Law of Testing; the [`principles-and-patterns`](../principles-and-patterns/SKILL.md) skill carries the stewardship discipline (Broken Windows, Boy Scout Rule, managed technical debt) that prevents the maintenance cost from compounding silently between principled refactors.

## Red Flags - STOP

- Shallow modules with wide interfaces: the public surface is nearly as large as the implementation; many methods, little hiding
- Cyclomatic or cognitive complexity high without a clear single purpose: deeply nested conditionals, switch ladders without a dispatch table, scores well above the team's threshold
- Accidental coupling between modules: two modules always change together because of a shared arbitrary assumption rather than a designed contract
- Premature abstraction with fewer than three concrete cases: a base class, generic, or strategy interface introduced "for future flexibility" with one or two callers
- Asymmetric simplicity: an API where the typical caller writes 10 lines of boilerplate so an exotic caller can write 2; defaults favor the unusual configuration
- Comments that restate the code: line comments restating the next statement; module headers that describe behavior already named by good identifiers
- Wrong abstraction kept in place: callers pass flags to opt out of the abstraction's behavior, the abstraction has special-case branches per caller, parameters are mostly used by one caller and ignored by the others
- No stated complexity threshold or review pass: branchy code accumulates because nothing surfaces it

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "We need this abstraction for future flexibility" | Future requirements arrive in shapes the speculation did not anticipate; the rule of three is the cheapest signal |
| "This module is already split, so it must be deep" | Split and deep are different. Many shallow modules are worse than one deep one |
| "Cyclomatic complexity is just a number" | A number consistently enforced is a discipline; a number measured but not enforced is decoration |
| "These two modules just happen to change together" | They share an undocumented assumption; the coupling is real, only the contract is missing |
| "The common case is fine, the rare case is what bit us" | Every common-case caller paid the boilerplate tax; that cost compounded silently |
| "I will rename later, the comment is a bookmark" | The comment will outlast the rename intention; rename now |
| "Removing the wrong abstraction feels like regression" | Inlining a wrong abstraction back is a refactor that restores optionality |
| "This complexity is essential" | State the reasoning. Could a senior engineer write it with substantially less structure? |

## Key Patterns

```
✅ Module exposes a 4-method interface; implements 2000 lines of behavior behind it
❌ Module exposes a 30-method interface; each method delegates one line into the implementation
```

```
✅ Switch over an enum dispatched via a table; each case is one short branch
❌ if/elif ladder 20 entries deep, each branch doing different jobs interleaved
```

```
✅ Three concrete cases of similar code → extract a shared helper
❌ One case implemented; base class introduced "for the future"
```

```
✅ get(url) defaults to JSON, 5s timeout, retries off; rare callers pass overrides
❌ get(url, parser, timeout, retries, ...) with no defaults; common callers write the same six args
```

```
✅ // We retry only on 503 because the upstream is known-flaky on transient overload (issue #1234)
❌ // Increment retries
```

```
✅ Wrong abstraction with caller flags → inline back; accept duplicates
❌ Wrong abstraction kept and grown to accommodate the next caller
```

## Why This Matters

Complexity compounds. A shallow module is a small tax now and a large tax everywhere it is used; the cost is paid by every future caller, every reviewer reading the call site, every change that has to thread through the leaky surface. A wrong abstraction is a small win now and a large cost when the third real case arrives in a shape the abstraction cannot bend to. Accidental coupling is silent until it isn't, and then the bug looks like magic.

Without complexity discipline:

- Modules proliferate as shallow wrappers; the system gets bigger without getting more capable.
- Branchy code accumulates because no review pass surfaces it; reading any one function becomes its own project.
- Speculative abstractions calcify; removing them feels like regression and the team avoids it.
- The common case slows down because the API was designed for the rare case.
- Comments accumulate in place of clear names; the code stays unclear and the comments rot.

With complexity discipline:

- Modules earn their keep; the interface stays small while the system grows.
- Branchy code is rare and visible; when it appears, it has a single cohesive purpose.
- Abstractions arrive on the third concrete case, fit the actual shape, and inline back when they don't.
- The common case is the path of least resistance; rare cases are allowed to be longer.
- Comments are load-bearing rationale; names carry the meaning.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** complexity discipline is mostly attentional. The code is small enough that complexity has not compounded yet. Awareness that the first abstraction is usually wrong; the first module split is usually shallow. Resist the urge to abstract.
- **Growing internal tool:** named constants on first appearance; functions are small enough to read in one pass; no abstraction without three concrete cases. Reviewers start noticing shallow-module shapes and flagging them.
- **Shared library:** complexity bounds are stated (a cyclomatic or cognitive threshold) and enforced or reviewed against. Public surface is deliberately deep: many small public functions are a smell; few load-bearing ones are the goal.
- **Production service:** wrong abstractions get inlined back without ceremony; the team has practiced this enough that it is not seen as regression. Review pass for accidental coupling is part of the change checklist for any module-boundary change.
- **Safety-critical:** complexity bounds are mechanically enforced and gate merge. Module depth is part of the design review. Speculative abstractions are scrutinized for the audit trail they obscure.

## References & rationales

- **John Ousterhout, *A Philosophy of Software Design* (2018, 2nd ed. 2021).** Backs principle 1 (deep modules), principle 5 (make the common case fast and obvious), and principle 7 (comments are for the why). Complexity as the dominant force; the deep-vs-shallow distinction is the modern reframing of information hiding for callers, not just authors.
- **Thomas McCabe, "A Complexity Measure" (IEEE TSE, 1976).** Backs principle 2 (cyclomatic complexity as a structural metric). The original numeric ceiling on branchy code; still the baseline metric in most static-analysis tools.
- **G. Ann Campbell / Sonar, "Cognitive Complexity" (2017).** Backs principle 2 (cognitive variant). Modernizes cyclomatic by weighting nesting and broken-flow constructs more heavily; better proxy for human reading cost.
- **Frederick Brooks, "No Silver Bullet" (1986) and *The Mythical Man-Month* (1975).** Backs principle 3 (orthogonality framing) and principle 6 (essential vs accidental). The framing that splits irreducible problem complexity from the complexity tooling and structure layer on top.
- **Andy Hunt and Dave Thomas, *The Pragmatic Programmer* (1999, 2019).** Backs principle 3 (orthogonality) and principle 7 (self-documenting code). The orthogonality discipline as the operational form of "don't accidentally couple things."
- **Martin Fowler, *Refactoring* (1999, 2018).** Backs principle 4 (rule of three) and principle 7 ("Comments" smell). The catalog of mechanical refactors that keep complexity discipline cheap to practice.
- **Sandi Metz, "The Wrong Abstraction" (RailsConf 2016).** Backs principle 4 (the inline-back corollary). The canonical statement that duplication is far cheaper than the wrong abstraction.
- **Max Kanat-Alexander, *Code Simplicity* (2012).** Backs principle 8 (the equation of software design and the four laws of change, defect probability, simplicity, and testing). The cleanest articulation of why maintenance cost dominates over implementation cost in long-lived systems.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific tools.

- **Cyclomatic complexity:** lizard (multi-language), radon (Python), eslint-plugin-complexity (JS/TS), gocyclo (Go), cargo-geiger and clippy lints (Rust). Useful as a smell-finder; thresholds belong to the team.
- **Cognitive complexity:** SonarQube and SonarLint (multi-language), CodeClimate. Better signal than cyclomatic for human reading cost; same caveat on thresholds.
- **Module-shape and coupling analysis:** dependency-cruiser (JS/TS), import-linter (Python), ArchUnit (Java/Kotlin), structurizr for design-time. Surface accidental coupling and layer-direction violations.
- **Refactoring tooling:** any modern IDE's extract-method, extract-variable, inline-method, and rename refactorings. The cost of inlining a wrong abstraction back must stay low for principle 4 to be practiced.
- **Visualization:** code-charta, codescene for hot-spot complexity overlay. Useful for picking which complexity to pay down first, not for setting bounds.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/software-complexity/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
