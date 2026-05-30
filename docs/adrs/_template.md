---
name: "<Human-readable title>"
description: "<One-line decision summary — what was chosen, in active voice>"
status: proposed
---

<!--
ADR Template — APSS ADR01 shape (bead create-harness-app-n48.12).

How to use this file:

1. Copy it to `docs/adrs/ADR-NNNN-kebab-case-title.md` where NNNN is the
   next unused four-digit number. (Check `docs/adrs/README.md` § Index
   for the current high-water mark; never reuse a number, never renumber
   an accepted ADR.)
2. Replace every `<…>` placeholder. Delete sections that don't apply
   (e.g., drop the `Supersedes`/`Superseded by` metadata lines if this
   ADR doesn't relate to another).
3. Update `docs/adrs/README.md` § Index with a row pointing at the new
   file.  The doc-validator pre-push hook enforces both the ADR shape
   and that every numbered ADR appears in the index.
4. When the decision flips from `proposed` to `accepted`, edit the
   front-matter `status` field. Add a `Superseded by:` metadata line
   in the old ADR when a new one replaces it (partially or fully).

This file itself is a TEMPLATE, not an ADR. The leading underscore in
`_template.md` keeps it sorted ahead of `ADR-0001-*.md` and signals
"meta / not a record". The doc-validator's ADR-shape rule skips files
beginning with `_` so this template doesn't have to pass the rule it
documents.

Authoritative spec: `docs/coordination/APSS-ADR-STANDARD.md`
(the APSS PR 61 ADR01 sub-standard, as scoped for this template).
-->

# ADR-NNNN: <Human-readable title>

**Date:** YYYY-MM-DD
**Category:** <Slot | Policy | Template governance | Cross-cutting>
**Supersedes:** ADR-NNNN-old-title <!-- optional; delete the line if N/A -->
**Superseded by:** ADR-NNNN-new-title <!-- optional; only added later, when a successor lands -->
**Next review:** YYYY-MM-DD

## Context

<!--
What is the problem this ADR responds to? Cite the constraint, the
external pressure, the experiment that surfaced the question, or the
previous ADR whose limits you've hit. Be specific — "we need to track
performance" is too vague; "since the v0.4.x sensors arc landed, the
gate runs but no perf characteristic is enforced, and an agent's
sub-second startup-time claim drifted to 4 s before we noticed" is
load-bearing.

Preservation-first: when this ADR layers on another, name the prior
ADR by its exact identifier (e.g. ADR-0006-sensors). Don't restate the
prior decision; link to it.
-->

## Decision

<!--
What did we decide? One sentence is best; bullet lists when there are
2–3 sub-decisions. Active voice. Examples:

  "Wire `harness/perf/bench.sh | harness/perf/gate.mjs` into pre-push
   as a baseline-snapshot fitness function (mirrors n48.4 for runtime
   performance)."

  "Promote APSS to canonical cross-language measurement (Decision 1)
   and preserve sentrux + the per-language adapters as available in
   the catalog (Decision 2)."

If the ADR has a deliberate non-choice (e.g. "we are NOT renumbering
existing ADRs"), state that here too.
-->

## Consequences

<!--
What follows from the decision? Both first-order (what the system does
now that it didn't before) and second-order (what becomes possible,
what becomes harder, what now needs follow-up).

Required sub-bullets when applicable:
  - **What this enables.** New capabilities, gates, or signals.
  - **What this constrains.** Anything a future change must respect.
  - **Migration cost.** If pre-existing artifacts need updating.
  - **Preservation audit.** When the change preserves an upstream or
    in-tree artifact rather than replacing it, name what was kept and
    why (per the preservation-first rule in CLAUDE.md and the
    operator's framing under `create-harness-app-n48`).

Don't paper over trade-offs. If the chosen path costs something, name
the cost.
-->

## Details

<!--
Optional but encouraged when the ADR has substantial supporting
material. Use sub-headings as needed. Conventions:

- **Alternatives considered.** Each alternative is one paragraph: what
  it would have looked like + why it was rejected. List even the ones
  that were obvious non-picks if they were raised — preserves the
  decision lineage.

- **Sources.** WebSearch-anchored where the decision involves a tool
  pick (per CLAUDE.md rule #0 — recommending tools from training data
  alone is not allowed). Quote the search date if URLs may move.

- **Backlinks.** Where else in the tree this decision is referenced
  (code, other ADRs, manifests). Helps doc-validator's
  principle ↔ ADR ↔ skill round-trip.

- **Operational notes.** Anything an agent or contributor needs to
  know when working in the area governed by this ADR. Often a few
  lines about how to bypass, audit, or extend.
-->
