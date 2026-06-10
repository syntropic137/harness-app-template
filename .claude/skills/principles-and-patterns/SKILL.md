---
name: principles-and-patterns
description: "Use when reviewing cross-cutting design principles: SOLID applicability, separation of concerns, dependency direction, composition vs inheritance, coupling and cohesion, OO-vs-functional style consistency, pattern enforcement style, project-level bounded-context coupling"
---

# Principles and Patterns

## Overview

Cross-cutting design principles (SOLID, separation of concerns, dependency inversion, composition over inheritance) are the vocabulary senior engineers use to reason about whether a design will hold up under change. Done well, the project declares which principles weight heavily, applies them where they fit, and stays consistent within a module. Done poorly, principles are either ignored entirely or applied as a checklist outside their scope, and the resulting design is worse than no principle at all.

**Core principle:** Principles are scoped tools, not universal laws. Pick the principles that fit the codebase's paradigm and the problem's shape, declare them, and apply them consistently within a module.

> **Skill cross-reference.** A peer reference doc lives at `../software-leverage-review/references/principles-and-patterns.md` for the orchestrator's synthesis pass. This SKILL.md presents the principle-doc shape; the two artifacts share content but serve different audiences.

## Core Principles

### 1. SOLID applies where the design is object-oriented (scope: OO codebases)

This principle scopes to object-oriented codebases: codebases organized around classes, inheritance hierarchies, and methods dispatched on object identity. Functional codebases inherit only the parts that translate (single-axis-of-change yes; Liskov substitutability in its OO form less so; Open-Closed via extension less directly).

When the scope applies, the SOLID principles encode well-known leverage:

- **Single Responsibility:** a class or module changes for one reason. Each axis of change is a reason to redeploy and retest; bundling them ripples every change through every consumer.
- **Open-Closed:** designs are open to extension, closed to modification. Add behavior by adding code, not by editing existing code, when the extension point is stable.
- **Liskov Substitution:** subtypes are usable wherever the supertype is expected, with no surprises. Violations make polymorphism a lie.
- **Interface Segregation:** clients depend only on the methods they use. Fat interfaces couple clients to capabilities they don't need.
- **Dependency Inversion:** high-level modules depend on abstractions, not concrete low-level types. The dependency arrow points toward stability.

**Multiple valid weightings exist:**
- **SOLID-strict:** every principle enforced uniformly; deviations require justification.
- **SOLID-as-heuristic:** principles consulted at design time, weighted by problem; deviations are routine when the problem genuinely doesn't fit.

The principle is: declare which weighting the project uses and apply it consistently. The red flag is "no stated stance," not "did not pick strict."

### 2. Functional-purity principles apply where the design is functional (scope: functional codebases)

This principle scopes to codebases organized around pure functions, immutable data, and effects pushed to the edges. OO codebases inherit only the parts that translate (separation of pure logic from effects yes; reader-monad-style dependency injection less directly).

When the scope applies: pure core, effects at the edges; data flows through transformations rather than mutating state; dependency injection happens via function arguments or reader patterns rather than constructor injection. SOLID's OO formulations adapt rather than transfer literally.

### 3. Separation of concerns is paradigm-independent

This principle applies across paradigms. Business logic, transport, persistence, and presentation each change for their own reasons; mixing them into one module ripples every change through every layer. Pricing rules in an HTTP handler, authorization in an ORM model, workflow logic in a view template are all the same failure mode in different costumes.

Each layer changes for one reason; the test for whether code is in the right layer is "does this code change when business rules change, or when transport details change, or when storage details change."

### 4. Dependencies point from volatile to stable

High-level modules (use cases, domain logic) should not depend on low-level concrete types (database clients, HTTP libraries, filesystem helpers). The dependency arrow points toward what changes least; details depend on the core, not the other way around.

**Multiple valid mechanisms exist:**
- **Constructor dependency injection** (OO): the use case takes its collaborators in its constructor; a composition root wires concrete implementations.
- **Functions-as-arguments** (functional): the use case takes its effects as function parameters; the caller supplies them.
- **Reader monad / capability passing** (functional, advanced): the use case is parameterized over an environment that provides its effects.
- **Service locator** (controversial): a registry resolves dependencies at the point of use. Generally weaker than the above because the dependencies are buried.

The principle is: dependencies are declared and visible, not buried. The red flag is "dependencies imported deep in a function body or fetched from a global registry," not "did not use constructor injection."

### 5. Composition over inheritance for code reuse (scope: where reuse is the goal)

This principle scopes to cases where the goal is code reuse, not substitutability. Inheritance encodes both an interface contract and an implementation reuse; using it for reuse alone couples the subclass to the superclass implementation, and refactors at the top break everything below.

When the scope applies: prefer composition (delegation, traits, mixins, has-a relationships) for reuse; reserve inheritance for genuine "is-a" substitutability where Liskov holds. A four-level inheritance chain to add behavior, or an abstract base class whose only consumer is one concrete subclass, is the failure mode.

### 6. Coupling and cohesion describe module health

Cohesion measures whether a module has one job (a `utils/` module mixing date parsing, cryptography, and string formatting is low-cohesion). Coupling measures how much knowledge of one module another requires (two modules importing each other's internals are tightly coupled). Both axes determine how independently the system's parts can evolve.

Low cohesion plus high coupling is the worst combination: changes in one module ripple unpredictably across the system. High cohesion plus low coupling is the goal.

### 7. Patterns name solved problems; apply where the problem actually exists

Design patterns are vocabulary for solutions to recurring problems. They have value when the underlying problem appears: introducing a Factory because object construction is genuinely complex, an Observer because event broadcasting is the actual need, a Strategy because runtime algorithm selection is the actual requirement.

Applying a pattern because it has a name, in the absence of the problem the pattern solves, is pattern theatre. The result is more code, more indirection, no benefit, and the next reader has to learn the pattern only to discover it adds nothing.

**Multiple valid pattern-enforcement styles exist:**
- **Catalog-driven:** the project maintains a list of approved patterns and discourages others; consistency is high, novelty is low.
- **Ad-hoc:** patterns are applied when they fit; the bar is "is the underlying problem present"; consistency is lower, fit is higher.

The principle is: declare which style the project uses; either way, the test is whether the problem the pattern solves is actually present. The red flag is "pattern applied with no underlying problem," not "did not maintain a pattern catalog."

### 8. Within a module, functional vs OO style is consistent

A module that mixes pure-functional patterns with mutable-OO patterns at random forces every reader to context-switch on every function. Pick a style per module and stay consistent within it; cross-module style differences are fine if each module is internally coherent.

The principle is paradigm-independent: declare the module's style and apply it.

### 9. Code stewardship: don't leave broken windows; leave it cleaner than you found it

Three related disciplines about the social fabric of a long-lived codebase:

- **Broken Windows Theory.** Bad designs, wrong decisions, and poor code left unrepaired signal that quality does not matter, and the next contributor matches the surrounding bar. Degradation compounds. Fix problems while they are small: rename the misleading variable, refactor the destructive function, update the outdated doc. The cost of fixing one window now is far less than the cost of replacing the wall later.
- **Boy Scout Rule (Campsite Rule).** Leave the code better than you found it. Every PR is an opportunity to fix at least one small thing in the area being touched: a clarifying rename, a dead-code removal, a missing test, a comment that explains the why. Done consistently, the codebase improves under maintenance pressure rather than degrading under it.
- **Technical debt as a managed quantity.** Shortcuts are a financing tool, not a moral failure. Assuming debt is a valid strategy for market timing or prototyping; the discipline is to track what was borrowed, plan the refactor that pays it down, and recognise that uncorrected debt accrues interest in the form of compounding maintenance cost. A working heuristic: allocate roughly **20% of every feature's time budget to paying down debt in the area being touched**. Under-allocating leaves debt to compound; over-allocating ignores the actual product work the team is paid to ship.

Tech debt paydown is gated by the [`testing`](../testing/SKILL.md) skill: refactoring without tests is risky, so improving test coverage in the affected area is often the first move. Refactoring under green tests is the actual mechanism of debt repayment. Cross-reference: the [`software-complexity`](../software-complexity/SKILL.md) skill carries the cost framing (maintenance dominates implementation, per Kanat-Alexander's equation) that makes the 20% allocation rational rather than aspirational.

## Red Flags - STOP

- A class or module touches multiple axes of change (HTTP parsing plus business rules plus persistence in one file)
- Business logic embedded in transport, persistence, or presentation layers
- High-level modules import concrete low-level types (database client, HTTP library) instead of abstractions they own
- Dependencies fetched from a global registry or imported deep in a function body, where they should have been declared at the seam
- Inheritance chain four or more levels deep, or abstract base class with one concrete subclass, used for code reuse rather than substitutability
- Low-cohesion modules (a `utils/` grab-bag); high-coupling pairs (two modules importing each other's internals)
- Cross-context coupling: bounded contexts sharing entity types or mutating each other's state with no explicit context map
- Pattern applied (Factory, Observer, Strategy, Visitor) with no underlying problem the pattern solves
- Module mixes functional and OO styles within itself with no stated convention
- No stated stance on principle weighting (SOLID-strict vs SOLID-as-heuristic) or pattern enforcement (catalog-driven vs ad-hoc)
- Surrounding code carries known smells (broken windows: misleading names, dead branches, outdated docs) and the PR walks past them without repair
- Technical debt is unrecorded; nobody knows what was borrowed, when interest started accruing, or which refactor pays it down
- No time allocated for debt paydown across feature work; every sprint ships only new features and the maintenance term grows unchecked

## Rationalization Prevention

| Excuse | Reality |
|---|---|
| "SOLID is just a checklist" | SOLID is a heuristic in OO codebases; declare the weighting and apply it where it fits |
| "Inheritance is fine, it works" | Until the third subclass needs behavior the parent forbids, and the chain breaks |
| "We can mock the database in tests" | The dependency arrow still points the wrong way; mocking is a workaround, not a fix |
| "This pattern is industry standard" | Industry standards solve specific problems; if the problem isn't here, the pattern adds noise |
| "Composition is more code" | Composition is more declared dependencies; the code is the same, the coupling is better |
| "Mixing functional and OO is pragmatic" | Mixing within a module forces every reader to context-switch on every function |
| "We don't need to declare a style" | Then every contributor invents one, and the module becomes incoherent |

## Key Patterns

```
✅ class OrderService: depends on Repository (interface); HTTP handler depends on OrderService
❌ class OrderHandler: parses HTTP, validates business rules, writes to DB, renders response
```

```
✅ Use case takes its effects as constructor args (or function args in functional style)
❌ Use case fetches a service from a global registry mid-function
```

```
✅ Composition: PaymentService has-a Logger, has-a TaxCalculator
❌ Inheritance: PaymentService extends LoggingTaxCalculator extends BaseTaxCalculator
```

```
✅ Factory introduced when object construction is genuinely complex (multi-step, conditional)
❌ Factory introduced because "patterns are best practice"; a single new() call would have done it
```

```
✅ utils/dates.py, utils/crypto.py, utils/strings.py (each cohesive)
❌ utils.py (date parsing + crypto + strings + HTTP helpers + everything else)
```

```
✅ Bounded contexts communicate via explicit context map; no shared entity types
❌ Two contexts share entity classes; each mutates the other's state directly
```

## Why This Matters

Cross-cutting principles are the difference between a codebase that absorbs change and a codebase that resists it. Without them, every change ripples unpredictably; with them applied where they fit, change stays local.

Without principle discipline:

- Modules accumulate responsibilities; every change ships everything.
- Dependencies tangle in both directions; refactoring becomes a fear-driven activity.
- Inheritance hierarchies calcify; refactoring the top breaks everything below.
- Patterns appear as decoration; readers learn the pattern to discover it adds nothing.
- Functional and OO styles collide within modules; every reader context-switches.

With principle discipline calibrated to the codebase's paradigm:

- SOLID applies where the design is OO; functional purity applies where it is functional.
- Dependencies are declared and visible, pointing from volatile to stable.
- Composition is the default for reuse; inheritance is reserved for substitutability.
- Patterns appear when the underlying problem is actually present.
- Within-module style is consistent; cross-module style differences are deliberate.

## Growth examples

Soft sketch; not a checklist. Where appropriate is shaped by the target's maturity.

- **POC / prototype:** principles consulted informally; the codebase is small enough that violations don't compound. Awareness that as the second module appears, separation of concerns starts paying.
- **Growing internal tool:** stated paradigm (OO or functional); separation of concerns enforced at the layer level; dependency direction starts mattering as the test surface grows; obvious utils-grab-bags get split.
- **Shared library:** principle weighting declared (SOLID-strict or SOLID-as-heuristic); public surface designed against principles deliberately; dependency direction is a contract consumers rely on.
- **Production service:** principle stance documented; PR reviews flag SOLID and separation-of-concerns violations; pattern enforcement style chosen (catalog or ad-hoc); bounded contexts have explicit context maps; cohesion and coupling reviewed at module-boundary changes.
- **Safety-critical:** principle stance is part of the design record; deviations require sign-off; pattern catalog is enforced; cohesion and coupling are measured and tracked over time; cross-context coupling is a defect.

## References & rationales

- **Robert C. Martin, *Clean Architecture* (2017) and *Clean Code* (2008).** Backs principle 1 (SOLID) and principle 4 (dependency direction). The canonical formulation of SOLID and the Dependency Rule.
- **David Parnas, "On the Criteria to Be Used in Decomposing Systems into Modules" (CACM, 1972).** Backs principles 1 (single responsibility as information hiding) and 6 (cohesion). The original module-boundary argument predating SOLID.
- **Edsger Dijkstra, "On the Role of Scientific Thought" (1974).** Backs principle 3 (separation of concerns). The canonical separation-of-concerns essay; paradigm-independent.
- **Bertrand Meyer, *Object-Oriented Software Construction* (1988, 1997).** Backs principle 1 (Open-Closed Principle origin). The original OCP statement, predating Martin's formulation.
- **Barbara Liskov, "Data Abstraction and Hierarchy" (1987).** Backs principle 1 (Liskov Substitution). The substitutability formalization.
- **Gang of Four (Gamma, Helm, Johnson, Vlissides), *Design Patterns* (1994).** Backs principle 5 (composition over inheritance) and principle 7 (patterns as named solutions). The pattern catalog and the "favor composition over inheritance" maxim.
- **Larry Constantine and Edward Yourdon, *Structured Design* (1979).** Backs principle 6 (coupling and cohesion). The original coupling-and-cohesion vocabulary; the seven coupling levels and the cohesion taxonomy.
- **Alistair Cockburn, "Hexagonal Architecture" (2005).** Backs principle 4 (dependency direction). Ports and adapters; the application core ignorant of its drivers.
- **Eric Evans, *Domain-Driven Design* (2003).** Backs principles 3 (separation of concerns at the strategic level) and 6 (cross-context coupling). Bounded contexts and context maps.
- **Andy Hunt and Dave Thomas, *The Pragmatic Programmer* (1999, 2019).** Backs principle 9 (Broken Windows Theory and the Boy Scout Rule). The canonical articulation that small unrepaired smells license larger ones, and that maintenance discipline is a per-PR habit, not a quarterly initiative.
- **Ward Cunningham, "The WyCash Portfolio Management System" (OOPSLA 1992).** Backs principle 9 (technical debt as a managed quantity). Origin of the debt metaphor: shortcuts are a financing tool with principal and interest, not a moral failure to be hidden.
- **Max Kanat-Alexander, *Code Simplicity* (2012).** Backs principle 9 (cost framing for stewardship). The equation of software design (covered in the [`software-complexity`](../software-complexity/SKILL.md) skill) is what makes the 20% paydown allocation rational: the maintenance term dominates over time, so refusing to pay it down is the most expensive shortcut available.
- **Milan Milanovic, "Laws of Software Engineering."** Backs principle 9. Curated catalog of named laws (Broken Windows, Boy Scout, technical debt, others) that recur across the principles literature; useful as a teaching reference.

## Suggested technologies (as of 2026-04-28)

These go stale fast; the date is the "as-of." Verify currency before adopting. The principles above outlast specific frameworks.

- **OO dependency injection:** language-native or framework-provided constructor injection (Spring, NestJS, Dagger). The pattern is the principle; the framework is incidental.
- **Functional capability passing:** reader monads (Haskell, Scala with cats/zio), `Effect` libraries, or plain functions-as-arguments in any language. Style consistency within a module matters more than the specific library.
- **Architecture-rule enforcement:** ArchUnit (JVM), dependency-cruiser (JS/TS), pytest-arch (Python), pre-commit hooks that lint cross-module imports. Useful for codifying the dependency direction rule.
- **Pattern catalogs:** team-maintained docs listing approved patterns and their use cases; ADRs that introduce a new pattern alongside the problem it solves.
- **Cohesion and coupling metrics:** Sonar's cognitive complexity, lattix-style dependency analysis, ndepend (JVM/.NET). Useful as smell-finders; the verdict is human.
- **Bounded-context tooling:** explicit module boundaries (Java modules, TypeScript project references, Rust crates), with context-map docs that name the integration patterns between them.

## Continual improvement

This skill is maintained at:
https://github.com/syntropic137/software-leverage-points/blob/main/skills/principles-and-patterns/SKILL.md

To improve it, edit the file directly and follow the chassis discipline in [`maintaining-software-leverage-points`](../../.claude/skills/maintaining-software-leverage-points/SKILL.md): regenerate catalogs, run `just qa`, then commit.
