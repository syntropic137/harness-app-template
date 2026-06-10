---
name: "APSS ADR Standard for Harness App Template"
description: "Migration contract for APSS ADR01-compliant ADR files in docs/adrs"
status: accepted
---

# APSS ADR Standard for Harness App Template

This is the handoff contract for migrating decision docs into APSS ADR01 shape. It is based on AgentParadise/agent-paradise-standards-system PR 61 (`EXP-V1-0004` and `EXP-V1-0004.ADR01`).

This file is a temporary coordination document, not an ADR. Remove it or move it outside `docs/adrs/` before final ADR01 validation, because ADR01 validates every non-structural Markdown file in the ADR directory against the ADR naming pattern.

## APSS Configuration

The template keeps ADRs in `docs/adrs/`, so APSS must be configured away from the default `docs/adrs/` directory:

```toml
schema = "apss.config/v1"

[docs]
root = "docs"

[docs.index]
frontmatter_fields = ["name", "description"]

[docs.adr]
enabled = true
directory = "adrs"
naming_pattern = "ADR-\\d{4}-[a-z0-9-]+\\.md"
required_adr_keywords = []
backlinking = true
```

## Numbering Scheme

ADR files MUST be named `ADR-NNNN-kebab-case-title.md`.

- Use four zero-padded digits: `ADR-0001-stack-manager.md`, not `0001-stack-manager.md` and not `ADR-001-*.md`. The APSS validator strictly enforces this pattern.
- Preserve existing decision order during migration: legacy `0001-*.md` becomes `ADR-0001-*.md`, through `ADR-0016-*.md`.
- Allocate new ADRs with the next unused number. Never renumber, reuse, or rename an accepted ADR to change history.
- The ADR identifier is the filename stem, for example `ADR-0006-sensors`; code and docs backlinks must use that exact identifier.

## Required Sections

Each ADR MUST use this structure and order:

```markdown
---
name: "<human-readable title>"
description: "<one-line decision summary>"
status: proposed
---

# ADR-NNNN: <human-readable title>

**Date:** YYYY-MM-DD
**Category:** <Slot | Policy | Template governance | ...>
**Supersedes:** ADR-NNNN-old-title
**Superseded by:** ADR-NNNN-new-title
**Next review:** YYYY-MM-DD

## Context

## Decision

## Consequences

## Details
```

Required APSS fields: front matter `name`, `description`, and `status`; body headers `## Context`, `## Decision`, and `## Consequences`.

Template-required metadata: `Date` and `Category`. Use `Supersedes`, `Superseded by`, and `Next review` only when applicable. `## Details` is optional and is where migrated rationale, alternatives, operational notes, links, and source lists should go.

Do not use the legacy `## Status` section as the source of lifecycle truth. The APSS lifecycle value in front matter is authoritative.

## Status Lifecycle

Use only APSS/Fowler lifecycle values:

- `proposed`: draft, research, audit, or not yet final.
- `accepted`: active governing decision.
- `deprecated`: no longer recommended, with no direct replacement.
- `superseded`: replaced by a newer ADR; include `Superseded by`.

Legacy status mapping for this migration:

| Legacy value | APSS status |
|---|---|
| `active` | `accepted` |
| `active current-state summary` | `accepted` |
| `draft / research` | `proposed` |
| `audit` | `proposed` |
| `deprecated` | `deprecated` |
| `superseded` | `superseded` |

ADRs are append-only decision records. If an accepted decision changes materially, create a new ADR and mark the old ADR `superseded`; do not rewrite the old ADR as if it always said the new thing.

## Index Format

`docs/adrs/README.md` MUST contain an APSS-generated `## Index` section using the parent standard format:

```markdown
## Index

| Document | Description |
|----------|-------------|
| [Stack Manager](ADR-0001-stack-manager.md) | Rust binary stack manager using bollard, portpicker, and docker compose |
```

Sort order is filename order, which preserves ADR number order. Do not add hand-maintained `Status`, `Category`, or `Decision` columns to the generated `## Index`; PR 61's generator only populates `name` and `description` values. Put lifecycle in front matter and category/date in the ADR metadata block.

## ADR Directory Context Files

`docs/adrs/CLAUDE.md` and `docs/adrs/AGENTS.md` MUST exist. Each file MUST tell agents to read governing ADRs and to add backlinks in implementation files using the exact identifier, for example:

```text
// Implements ADR-0006-sensors
```

Backlinks are checked by ADR01 for dead references and references to deprecated or superseded ADRs.
