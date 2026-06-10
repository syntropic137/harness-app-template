---
name: "<human-readable title>"
description: "<one-line decision summary>"
status: proposed
---

<!--
ADR template — copy this file to `docs/adrs/ADR-NNNN-kebab-case-title.md`
and edit. The leading underscore keeps this file out of the numbered ADR
ordering and signals "meta / not a record"; the doc-validator skips files
beginning with `_`, so this template does not have to pass its own rule.

The canonical contract for the ADR shape lives at
`../coordination/APSS-ADR-STANDARD.md`. Front matter (`name`, `description`,
`status`) is required. The canonical sections (`## Context`, `## Decision`,
`## Consequences`) are required. Use `## Details` for migrated rationale,
alternatives considered, sources, and operational notes.
-->

# ADR-NNNN: <human-readable title>

**Date:** YYYY-MM-DD
**Category:** <Slot | Policy | Template governance | Cross-cutting>
**Supersedes:** <ADR-NNNN-old-title or "none">
**Next review:** YYYY-MM-DD

## Context

What forces are at play? What constraint, observation, prior ADR, or
operator framing makes this decision necessary now? Cite the prior ADRs
this layers on top of. State the *question* this ADR closes in one
sentence.

## Decision

The decision itself — usually one or two paragraphs, or a numbered list
when the ADR records multiple related sub-decisions. Be concrete about
what changes in code, in manifests, in operator practice. Name the
preservation-first non-choices explicitly (what this ADR does *not*
change), so future readers can distinguish "deliberately preserved" from
"forgotten".

## Consequences

What this enables, what this constrains, what it costs, and what the
preservation audit looks like (which prior artifacts are unchanged, which
are added, which are deprecated-but-kept-for-reference). Be honest about
the trade-offs the next ADR will need to re-evaluate.

## Details

### Sub-headings as needed

Migrated rationale, alternatives considered, slot contract compatibility
hooks, backlinks the wiring lane will add, sources, and
when-to-re-evaluate triggers all live here. Subsections keep the
canonical three sections above scannable.

### Alternatives considered

For each rejected alternative, state the alternative, the reason it was
rejected, and the trigger that would make it the right choice later.

### Backlinks

Code, docs, and manifests that will reference this ADR when the wiring
lane lands (use the exact identifier `ADR-NNNN-kebab-case-title` when
wiring).

### Sources

Prior ADRs, lab decisions, upstream specs, packaged crates, research
notes — link them so a future reader can reconstruct the evidence base.

### When to re-evaluate

Concrete triggers (upstream changes, measured regressions, operator
framing shifts) that would justify a successor ADR. "Never" is rarely
the right answer for any of these.
