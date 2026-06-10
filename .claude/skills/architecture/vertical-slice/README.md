# Vertical Slice Architecture

Deep-dive companion to the `architecture` SLP, principle 8 (sociotechnical alignment). Sources: Jimmy Bogard (popularized the term in the .NET community), Adam Dymitruk (event modeling), Martin Dilger (*Understanding Event Sourcing*, 2024), Matthew Skelton and Manuel Pais (*Team Topologies*, 2019).

Vertical slice architecture is one structural realization of Conway's Law as a design imperative: organize the codebase so each feature can be worked end-to-end by one team or one agent without serializing on shared state. It is not a layering style in the same sense as clean / hexagonal / onion; it is a **decomposition rule** that says the unit of organization is the feature, not the technical layer.

## What a vertical slice is

A vertical slice is the **end-to-end implementation of a single capability**, owning every layer the capability touches:

- The transport entry point (HTTP route, gRPC method, message handler, CLI command).
- The application logic (the command handler or the use case).
- The domain logic (the aggregate, entities, value objects, consistency rules).
- The persistence side (the event store interaction, the repository write).
- The read side (the projections and read models the slice's screens consume).
- The user-facing surface where the capability is exposed (the screen, the API response shape, the response).

For a typical event-sourced system using event modeling notation, one slice corresponds to one **state change pattern** (screen → command → events) plus the **state view patterns** that read what the slice produced (events → projection → screen). For a non-event-sourced system, one slice is one (route → handler → use case → repository → view) path.

The point: the slice owns its full path. There is no scenario where understanding or changing the capability requires reading code outside the slice (other than narrow shared-kernel primitives, see below).

## The cohesion-coupling rule

The defining principle:

> **High cohesion within a slice, low coupling between slices.**

Inside a slice, components are tightly knit: the command type, the handler, the aggregate methods it calls, the events it emits, the projections that consume those events, and the screen-side read model are designed together and change together. Internal types are free to be specific to the slice's needs.

Between slices, coupling is minimized to a small, deliberately maintained surface:

- **Events** (in event-sourced systems): one slice's events may be consumed by another slice's projection or automation, but only through the published event contract, never through internal types.
- **Identifiers** for cross-slice references.
- **Shared kernel** primitives: a tightly scoped set of value objects (Money, EmailAddress, TimeRange) and infrastructure abstractions (event store interface, clock, logger). The shared kernel is small by design; growth is treated as a smell.

Two slices should never share an internal aggregate type, an internal command, or an internal projection schema. If two slices are tempted to share something deeper than the kernel, that is a signal either that they are one slice with two names, or that a third slice (the shared concept) is hiding.

## Why vertical slices parallelize well

This is the Conway's Law payoff and the reason vertical slice is the natural pairing for small cross-functional teams and parallel agents.

In a layer-organized codebase (`controllers/`, `services/`, `repositories/`, `models/`), every feature change touches every layer's directory. Two features changing in parallel collide in the same files (especially the `services/` layer where business logic accumulates) and the team serializes on merges, code review, and shared abstractions. Conway's Law wins by default: the architecture forces the team into a single coordination boundary regardless of the team's size.

In a slice-organized codebase (`features/place-order/`, `features/refund-payment/`, `features/cancel-subscription/`), each feature lives in its own directory. Two teams, two engineers, or two agents can work on two slices simultaneously and the only collision points are the small shared kernel and the published event contracts. The architecture *invites* parallelism because the seams match the work.

The same argument applies recursively at agent scale: dispatching independent agents on independent slices produces independent diffs that compose without conflict. A layer-organized codebase produces overlapping diffs that conflict on every merge.

## Cross-cutting concerns without re-coupling

A reasonable objection: "If I never share, I duplicate validation, authorization, persistence boilerplate, and infrastructure." Vertical slice has answers, but the answers are deliberate.

**The shared kernel is real but small.** Value objects representing universal domain primitives (Money, ZipCode), infrastructure abstractions (the event store interface, the clock, the message bus), and cross-cutting infrastructure middleware (request logging, auth context, telemetry) live in shared modules. The discipline is that the kernel is reviewed when it grows; new kernel additions require justification.

**Cross-cutting concerns live in framework-level middleware**, not in shared application services. Authentication, request validation, telemetry, logging, error formatting: these are pipeline concerns the framework applies, so each slice receives an already-authenticated request and emits a payload the framework formats. The slice does not import a `services/auth/` module to authenticate; the framework hands it an authenticated principal.

**Some duplication across slices is the price of independent change.** Two slices both formatting a date or both extracting an order ID from a request is fine. Premature DRY across slices recouples them: a future change to "how we extract order IDs" now has to ripple through every consumer, and the slices stop being independently changeable. **Wait for three concrete cases** (rule of three, principle 5 in the architecture SLP) before extracting a cross-slice abstraction, and even then prefer extracting into the shared kernel only if the abstraction is genuinely universal.

## Comparing layered and slice organization

```
✅ slice organization (parallelizes)
   features/
     place-order/
       handler.py, aggregate.py, events.py, projections.py, screen.py
     refund-payment/
       handler.py, aggregate.py, events.py, projections.py, screen.py
     cancel-subscription/
       handler.py, aggregate.py, events.py, projections.py, screen.py
   shared_kernel/
     money.py, email_address.py, event_store.py, clock.py
```

```
❌ layer organization (serializes)
   controllers/
     order_controller.py, payment_controller.py, subscription_controller.py
   services/
     order_service.py, payment_service.py, subscription_service.py   ← god directory
   repositories/
     order_repo.py, payment_repo.py, subscription_repo.py
   models/
     order.py, payment.py, subscription.py
```

The layered version forces every feature change to touch four directories; the slice version contains it to one.

This is not a claim that layered architectures are wrong universally. Hexagonal and onion are valid layering schools (see architecture SLP principle 3) and can coexist with vertical slicing inside a slice (each slice can apply hexagonal internally). The decomposition rule is about the **top-level** organization of the codebase, where the slice axis matches the feature axis matches the team axis.

## Slices and event modeling

When the system is event-sourced, vertical slices align naturally with the event model. One slice = one state-change pattern (one command, one aggregate, one or more events) plus the state-view patterns that read what it produced.

This alignment is why Dilger recommends pairing event sourcing with vertical slice as the default. The event model becomes the slice catalog; each colored sticky on the event model corresponds to code that lives in one slice's directory; teams or agents can own slices on the model and the codebase mirrors the ownership.

For details on the event modeling notation and patterns, see [`../event-sourcing/README.md`](../event-sourcing/README.md).

## Anti-patterns and red flags

- **Slices that share internal types.** Slice A imports `slice_b/internals/order.py`. The slices are now coupled at the internal model; changing `order.py` ripples across both. Either the type belongs in the shared kernel, or the slices are one slice with two names.
- **A `services/` directory that accumulates cross-slice logic.** This is the layered-architecture failure mode arriving by accident. Move slice-specific logic back into the slice; promote genuinely shared logic to the kernel only if it meets the rule of three.
- **Premature DRY across slices.** Extracting "the way we format dates" or "the way we validate addresses" from two slices on first appearance. Wait for three cases.
- **Slices that don't actually go end-to-end.** A "slice" that only contains the handler and delegates to a shared service is a controller in a different directory; the layering has not actually changed.
- **Shared kernel growing without review.** The kernel becomes a god module by accretion. Treat additions as load-bearing; review new kernel members.
- **Cross-slice synchronous calls.** Slice A's handler synchronously invokes slice B's handler. The slices are now serially coupled at runtime; failures and latencies cascade. Communicate via events (in event-sourced systems) or via published contracts.
- **No alignment between slice boundaries and team or agent boundaries.** The architecture parallelizes but the organization does not exploit it (or vice versa). Conway's Law is informational either direction; mismatch is the smell.

## When vertical slice is the right choice (and when it isn't)

**Right choice when:**

- The system has many features that change independently.
- Multiple teams or agents work the codebase in parallel.
- Feature ownership is meaningful (one team or agent owns a slice end-to-end).
- The system is event-sourced or moving toward event-sourced; the alignment compounds.

**Less of a fit when:**

- The system is genuinely a single feature (a focused library, a single-purpose tool). Layering is sufficient because there is no parallelization argument to exploit.
- Cross-cutting consistency is the dominant constraint and per-slice variation is not desired (e.g., a strict CRUD admin tool with a fixed shape across resources). A layered or generated approach may serve better.
- The team is one person and is unlikely to grow. The Conway argument is dormant; the slice discipline still helps but the cost-benefit is reduced.

For systems where parallel team or agent work is expected, vertical slice is the default; the cost of starting layered and migrating to sliced (untangling shared services, splitting god directories) is much higher than the cost of starting sliced and discovering some slices could share more.

## Maturity progression

Soft sketch.

- **POC / prototype:** one or two features; layering is fine. Awareness that growth past three features is when slice organization starts paying.
- **Growing internal tool:** first slice directories appear for the most-changing features; older code may remain in a layered shape as a transitional state. Shared kernel emerges deliberately, kept small.
- **Shared library:** if the library is feature-shaped (multiple capabilities), each capability is a slice; if it is utility-shaped (one focused concern), layering is fine.
- **Production service:** all features are slices; shared kernel is reviewed for growth; cross-slice communication is via published events or contracts; team or agent ownership maps cleanly to slice ownership.
- **Safety-critical:** slice boundaries enforced mechanically (architecture tests prevent cross-slice internal imports); kernel changes go through formal review; slice ownership is documented; cross-slice integration uses versioned, monitored contracts.

## Cross-references

- `../SKILL.md`: the architecture principle doc; principle 8 (sociotechnical alignment / Conway's Law) is the entry point for vertical slice.
- [`../event-sourcing/README.md`](../event-sourcing/README.md): event sourcing and event modeling, which pair naturally with vertical slice.
- [`../fitness-functions/README.md`](../fitness-functions/README.md): fitness functions for slice discipline include "no slice imports another slice's internals" and "shared kernel size is bounded."
- *Team Topologies* (Skelton and Pais, 2019): stream-aligned teams as the human side of slice organization.
- *Understanding Event Sourcing* (Dilger, 2024): pairing of event sourcing with vertical slice as the default recommendation.
- Jimmy Bogard's writing on vertical slice architecture (originally in the .NET community, broadly applicable).
