# Event Sourcing

Deep-dive companion to the `architecture` SLP, principle 8 (sociotechnical alignment). Sourced primarily from Martin Dilger's *Understanding Event Sourcing* (2024), with cross-references to Eric Evans (DDD) and Vaughn Vernon (IDDD).

Event sourcing is one architectural style among several. It is not always the right choice. Where it fits, it tends to fit deeply: it shapes the domain model, the persistence layer, the integration story, and the testing approach. This doc captures the vocabulary, building blocks, and patterns so a reviewer can recognize whether a codebase is using event sourcing well, badly, or by accident.

## Core concepts

**Event.** An immutable fact about something that happened in the past. Events are named in past tense (`OrderPlaced`, `PaymentRefunded`, `InvoiceCancelled`). They carry the data that captures what happened, not the data that captures the current state. Once written, they are never updated or deleted; later corrections are themselves new events (`OrderPlaceCorrected`).

**Event stream.** The chronological sequence of all state-changing events for a particular business entity or process. The stream is the entity's history; replaying it from the start reproduces the entity's current state.

**Stream ID.** The identifier of the business entity (typically the aggregate ID). All events for one entity belong to one stream; the stream is the unit of consistency.

**Projection.** A view materialized from one or more event streams. Projections are how the system answers queries: a list page is a projection, a dashboard counter is a projection, a search index is a projection. Projections are derived data; they can be rebuilt at any time by replaying events.

**Event store.** A purpose-built database for appending and reading event streams, with first-class support for stream-scoped optimistic concurrency, projection rebuilds, and replay. Event stores are not interchangeable with general-purpose databases or message brokers.

## Event sourcing is not event streaming

A common confusion. **Kafka is not an event store.** Kafka is a distributed log for event streaming: high-throughput, low-latency, retention-bounded, designed for inter-service messaging. Event sourcing requires:

- Permanent retention of events (the stream is the system of record).
- Stream-scoped optimistic concurrency (write succeeds only if the stream has not advanced).
- Efficient replay from any point in a stream.
- Snapshots and projection rebuild support.

Kafka can be coerced into doing some of these, but it is not what Kafka is designed for. Event-sourced systems use **event stores** (purpose-built, e.g., Syntropic137 EventSourcing Platform, EventStoreDB, Marten over Postgres). Event-sourced systems may *also* publish events to Kafka or another broker for downstream integration, but the event store is the source of truth.

The shorthand: **event sourcing = state from history; event streaming = data in motion.** A system can use either, both, or neither.

## Building blocks (DDD vocabulary, applied)

Event sourcing inherits its building blocks from domain-driven design. Reviewers should expect these terms to be load-bearing in an event-sourced codebase, not decorative.

The two **strategic** concepts frame everything else:

- **Ubiquitous language.** A shared, consistent vocabulary used by everyone involved with the system: domain experts, product, engineering, marketing, support, operations. The terms in the code, the database, the event names, the screen labels, and the Slack threads are the *same* terms the business uses. The point is to remove translation cost: when a marketer says "lapsed subscription," the code has a `SubscriptionLapsed` event, not a `status_change_3` row. The ubiquitous language is the single largest driver of why event names matter (`OrderPlaced`, not `OrderUpdated`); events are the chronological record of the business in the language of the business.
- **Bounded context.** The boundary inside which a particular ubiquitous language is consistent. Different contexts can use the same word for different things ("customer" in sales vs in support vs in billing) without conflict, because each context owns its own model. Crossing a bounded-context boundary requires explicit translation, never silent reuse of internal types. In an event-sourced system, every aggregate lives inside exactly one bounded context, and integration between contexts goes through translated events, not shared databases.

The **tactical** building blocks live inside a bounded context and operate against the local ubiquitous language:

- **Aggregate.** A consistency boundary. The aggregate enforces the invariants that must hold transactionally; commands are accepted or rejected by the aggregate. One aggregate maps to one event stream.
- **Entity.** A model object with identity that persists over time. Inside an aggregate.
- **Value object.** A model object identified by its attributes (no separate identity). Immutable. Money, addresses, date ranges.
- **Consistency rule.** An invariant the aggregate enforces. "An order cannot be placed with zero items." "A refund cannot exceed the original payment."
- **Command.** A request to change state, named in imperative form (`PlaceOrder`, `RefundPayment`). Commands may be rejected; events cannot.
- **Command handler.** Loads the relevant aggregate, applies the command, records the resulting events.
- **Query.** A request to read state.
- **Query handler.** Reads from a projection, not from the event store directly. Queries never touch the write side.

## Event modeling

Event modeling, popularized by Adam Dymitruk, is a **visual approach** for discussing data flow in event-sourced systems. It is the whiteboard companion to event sourcing: a way to design the system before code, and to discuss it with non-engineers afterward.

The notation is small and color-coded:

- **Event (orange).** A fact that happened.
- **Command (blue).** A request that, if accepted, produces events.
- **Screen / wireframe.** The user-facing surface that issues commands and reads from projections.
- **Read model (green).** A projection consumed by a screen or another component.
- **Automation.** A process that reads events and issues commands (the system reacting to itself).
- **Translation.** A mapping from one bounded context's events to another's commands.
- **External event.** An event originating outside the system's bounded context (a webhook, a partner integration).

Four recurring **patterns** assemble these primitives:

1. **State change pattern.** Screen → command → event. The user does something; the system records what happened.
2. **State view pattern.** Event → projection → screen. The user reads the current state.
3. **Automation pattern.** Event → automation → command. The system reacts to its own history without a user.
4. **Translation pattern.** External event or another context's event → translation → command in this context.

Two diagnostic checks Dilger emphasizes when reviewing an event model:

- **Information completeness check.** For every screen, can it be populated from the events that exist? If not, an event is missing data, or a projection is missing.
- **Business rule check.** For every consistency rule, is there a command-and-aggregate path that enforces it? If not, the rule lives nowhere and will be violated.

## Vertical slice synergy

Event modeling pairs naturally with vertical slice architecture (deep-dive in the companion `vertical-slice/` doc, when written). Each "slice" is one (command, aggregate, events, projections, screens) end-to-end path. Slices are **decoupled horizontally** (one slice does not import another's internals) and **coupled vertically** (a slice owns its full path through transport, application, domain, and read side).

This is why event-sourced + vertical-slice systems parallelize well: each slice can be worked by one team or one agent without serializing on a shared model. Dilger recommends this combination as the default; the architecture SLP's principle 8 (Conway's Law / sociotechnical alignment) is the underlying argument for why.

## Testing event-sourced systems

Event sourcing offers a particularly clean testing pattern, anchored on the same vocabulary as the runtime model.

**Given / When / Then for command handlers (write side):**

```
Given (these prior events have been recorded for this stream)
When (this command is received)
Then (these new events should be appended) -- or: (this rejection should occur)
```

The test makes no database calls and stubs no infrastructure. The aggregate is loaded from the prior events, the command is applied, the resulting events are asserted. Pure-function discipline emerges naturally because the aggregate's behavior is a fold over events plus a new command.

**Given / Then for read models (read side):**

```
Given (these events have been recorded across these streams)
Then (this projection should yield this state)
```

The test feeds events to the projection's apply logic and asserts the resulting view. Again, no infrastructure required.

These patterns also serve as **executable specifications**: the event model and the tests share vocabulary, so business rules expressed in the event model translate directly to tests. Non-engineers can read and validate the Given/When/Then; engineers run them in CI. This is one of the strongest arguments for event sourcing in domains where business correctness is paramount.

## Versioning

Events are immutable, and the system replays them indefinitely, so **event schema versioning** is non-trivial. The patterns:

- **Weak schema (additive only).** New optional fields are safe; never remove or rename a field.
- **Upcasters.** Code that reads an old event version and produces the new shape on the fly during replay. Lives in the event store adapter.
- **New event type.** When a change is too large for upcasting, introduce a new event type and treat the old one as historic.
- **Multiple version handling in projections.** Projections must handle every version they have ever seen, because replay covers the whole history.

Versioning discipline is the price of admission. A system that replays events but mishandles old versions corrupts projections silently.

## Long-running processes: the processor todo list pattern

Many real systems need to coordinate work that spans multiple aggregates, external systems, or a sequence of steps over time: process a payment, then notify the warehouse, then update the order, then email the customer. The traditional answer is a **saga** (a stateful coordinator that listens to events and issues compensating commands on failure). Sagas work, but they introduce a parallel state machine that lives outside the event store, with its own persistence, its own retry semantics, and its own failure modes.

Martin Dilger recommends an alternative he calls the **processor todo list pattern**, a simpler approach for most long-running asynchronous coordination needs.

The shape of the pattern:

- A **projection** (the todo list) accumulates pending work items derived from the event stream. Each item is a small, idempotent, well-defined task: "send refund to processor X for transaction Y," "notify customer Z that order A has shipped."
- An **automation** (in event-modeling terms) reads the todo list, picks up items, performs the work, and issues commands. The resulting events remove the item from the todo list (typically by recording a `WorkItemCompleted`-shaped event, which the projection consumes to drop the row).
- Failure is handled by **leaving the item on the list**. The automation will retry on the next pass. Idempotency on the work side is a precondition; the list itself stays simple.

Why this is preferable to a stateful saga framework in most cases:

- **State lives in events.** No parallel saga store to back up, replicate, or migrate. The todo list is just a projection like any other; it can be rebuilt from events.
- **Inspectable.** The todo list is queryable. "What is pending?" is a SELECT, not a saga-internal API.
- **Replayable and idempotent by construction.** Replaying events rebuilds the same todo list; running the automation twice on the same item is safe (the work is idempotent, and the item is removed by the resulting event regardless).
- **No special framework.** Standard event sourcing primitives (events, projections, automations) are sufficient. No saga DSL, no choreography vs orchestration debate.

When sagas remain appropriate:

- Workflows with **complex compensation logic** that cannot be expressed as idempotent retries (e.g., financial reversals where the compensation depends on prior state in non-trivial ways).
- Workflows that span **systems outside the event store** with their own coordination requirements.

For most coordination needs in an event-sourced system, the processor todo list is simpler, easier to reason about, and avoids the parallel-state-machine tax. The pattern is documented in *Understanding Event Sourcing*; see Dilger for the canonical treatment.

## Anti-patterns and red flags

- **"We use Kafka as an event store."** Kafka is not an event store. The system has a retention-bounded log pretending to be the source of truth.
- **Mutable events.** Events are corrected by adding new events, never by editing existing ones. Any code path that updates or deletes events is a defect.
- **Past-state events instead of past-event events.** `UserUpdated` with the new state is a CRUD log, not an event. Events name **what happened in domain terms** (`UserEmailChanged`, `UserPromotedToAdmin`).
- **Cross-aggregate transactions.** One command writing events to multiple streams atomically. Either the consistency boundary is wrong, or the boundaries should be separate aggregates communicating via process managers / sagas.
- **Querying the event store from the read side.** Queries hit projections, not the event store. Direct event-store queries from query handlers indicate the read model is missing.
- **Replays that take so long they are never run.** Projection rebuild is a routine operation in event sourcing; if it is feared, projections cannot be evolved. Snapshots and parallel replay are the remedy, not avoidance.
- **No event versioning strategy.** First non-additive schema change corrupts old events on replay.
- **Event model that has no information completeness or business rule checks.** Screens cannot be populated; rules live nowhere; the model is decorative.

## When event sourcing is the right choice (and when it isn't)

Event sourcing offers a set of benefits that compound over the lifetime of a system, more than most architectural styles. The headline benefit is **future optionality**: because the event store retains the full history of state-changing facts, projections you have not yet imagined are trivially constructible later. A CRUD system cannot backfill the history it never recorded; an event-sourced system can answer next year's analytical question by replaying last year's events through a new projection.

This connects directly to the architecture SLP's core principle: **leave as many options open for as long as possible**. Event sourcing is one of the strongest tools available for preserving optionality at the data layer.

The benefits in summary:

- **Future projections from past history.** New read models, dashboards, search indices, and ML feature stores can be built from events that already exist. The history is the asset.
- **Audit and temporal queries are first-class.** "How did we get here?" and "What did the system look like on 2026-01-01?" are answerable by replay, not by reconstruction.
- **Multiple read models from one source of truth.** The same events feed many projections, each optimized for its consumer (list views, aggregations, search, recommendations).
- **Domain alignment.** When the organization already thinks in events ("the order was placed, then refunded, then partially returned"), the model matches the language and translation cost drops.
- **Reduced upfront pressure.** Combined with vertical slice, event sourcing reduces the cost of being wrong about a read shape: the read shape is a projection, and a projection can always be replaced by replaying the events. Hard schema decisions that CRUD systems lock in at the beginning are deferred or recoverable here, which lets teams move faster on the parts that matter.

The headline drawback is **eventual consistency** between the write side (event store) and the read side (projections). A command writes events; the projection updates asynchronously; until it catches up, queries see the prior state. Most systems can absorb this with UI affordances (optimistic updates, "your change is saved" indicators) and process design, but it is a real constraint that needs to be designed for, not discovered.

Other costs to weigh honestly:

- **Conceptual ramp.** The team must internalize aggregates, commands, projections, replay, and versioning. Worth it once paid; nontrivial during the first project.
- **Tooling and operations.** Event stores need backup, replay, and snapshot operations that differ from familiar relational ops.
- **Versioning discipline.** Schema evolution is solvable but requires explicit practice (upcasters, weak schema, new event types).

Event sourcing is the **wrong** choice when:

- **CRUD is sufficient and the system will stay small.** A single-read-pattern admin tool with no audit needs does not benefit enough to pay the cost.
- **The domain is genuinely state-shaped, not event-shaped.** A cache, a feature flag service, a current-only sensor reading. There is no history to preserve.
- **The team is new to event sourcing and the project is high-stakes with no learning runway.** Pilot somewhere lower-risk first.

The default recommendation for systems where audit, multi-projection needs, or domain-event alignment are even *plausibly* in the future is to **start event-sourced**, because the cost of migrating CRUD to event-sourced later (no history to backfill) is much higher than the cost of starting event-sourced and discovering it was overkill (the events are still useful as an audit log).

## Maturity progression

Soft sketch.

- **POC / prototype:** no event sourcing yet. Awareness that if audit, history, or multi-projection needs are real, a CRUD-shaped persistence layer is a future migration cost.
- **Growing internal tool:** first aggregate is event-sourced for the audit-critical capability; rest of the system is CRUD. Event store is a single Postgres table or a managed event-store service. One projection per query screen.
- **Shared library:** library exposes domain primitives (aggregates, command/query handlers, event types). Versioning strategy documented. Replays are a routine operation, not feared.
- **Production service:** every audit-critical bounded context is event-sourced. Event modeling is a regular design activity; given/when/then tests cover the command handlers and projections. Vertical slices align with the event model. Projection rebuilds run on a schedule.
- **Safety-critical:** event store has redundancy and verified backup-and-replay. Event versioning is part of the release checklist. Event model is part of the artefacts handed to auditors. Cross-context translations are explicit, versioned, and monitored.

## Cross-references

- `../SKILL.md`: the architecture principle doc; principle 8 (sociotechnical alignment) introduces event sourcing and CQRS at callout depth.
- `../fitness-functions/README.md`: fitness functions for event-sourced systems often include "no aggregate exceeds N events without snapshotting" and "every event type has at least one upcaster path or is current schema."
- *Understanding Event Sourcing* (Martin Dilger, 2024): the canonical source for the vocabulary, event modeling notation, and testing patterns above.
- *Domain-Driven Design* (Eric Evans, 2003): aggregates, entities, value objects, bounded contexts.
- *Implementing Domain-Driven Design* (Vaughn Vernon, 2013): operational treatment of aggregates and event-driven integration.
- Suggested event-store technologies are listed in `../SKILL.md` under "Suggested technologies"; Syntropic137 EventSourcing Platform is the primary recommendation in this ecosystem.
