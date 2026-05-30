---
name: "Decision and ADR corpus gap analysis"
description: "Inventory of lab decision records versus template ADR records and APSS ADR01 directory conformance"
---

# Decision and ADR Corpus Gap Analysis

Discovery date: 2026-05-30

Sources inspected:

- Lab decisions directory: `/home/ubuntu/Code/NeuralEmpowerment/agentic-harness-lab/docs/standard/decisions` at lab `HEAD` `e094fd3`
- Template committed ADR corpus: `docs/adr/` at template `HEAD` `d4ae415`
- Template current working tree ADR corpus: `docs/adrs/` after interrupted, uncommitted plural-directory rename
- APSS PR 61 ADR01 substandard: `default_adr_directory()` returns `adrs`; spec examples resolve ADRs under `docs/adrs/`

This is discovery only. No implementation recommendation here is applied by this report.

## Summary

The lab has 16 decision records under `docs/standard/decisions`.

The template has 16 numbered ADR records. Fifteen map directly to lab decision records. One lab record is missing from the template: `sensors-v0.3-apss-canonical.md`. One template ADR has no lab decision counterpart: `ADR-0016-createapp-wrapper-design.md`.

APSS ADR01 conformance differs by state:

| Corpus | Directory | Directory conforms to APSS PR 61 default? | File naming conforms? | Notes |
|---|---:|---:|---:|---|
| Lab | `docs/standard/decisions/` | No | No | Unnumbered legacy decision records. |
| Template committed `HEAD` | `docs/adr/` | No | Yes | Uses singular `adr`; ADR files use `ADR-NNNN-kebab-case.md`. |
| Template working tree | `docs/adrs/` | Yes | Yes | Rename is present locally but uncommitted and mixed with other dirty files. |

## Lab Record Inventory

| Lab record | Template status | Template ADR | Notes |
|---|---|---|---|
| `agent-plugins.md` | Ported | `ADR-0007-agent-plugins.md` | Direct slug match. |
| `binary-distribution.md` | Ported | `ADR-0012-binary-distribution.md` | Direct slug match. |
| `cha-sync-source-of-truth.md` | Ported | `ADR-0015-cha-sync-source-of-truth.md` | Direct slug match. |
| `coverage-enforcement.md` | Ported | `ADR-0013-coverage-enforcement.md` | Direct slug match. |
| `doc-validator.md` | Ported | `ADR-0010-doc-validator.md` | Direct slug match. |
| `hooks.md` | Ported | `ADR-0003-hooks.md` | Direct slug match. |
| `inspector.md` | Ported | `ADR-0002-inspector.md` | Direct slug match. |
| `observability-stack.md` | Ported | `ADR-0005-observability-stack.md` | Direct slug match. |
| `secret-scanner.md` | Ported | `ADR-0009-secret-scanner.md` | Direct slug match. |
| `sensors-v0.3-apss-canonical.md` | Missing | None | Lab superseding/canonical sensors record is absent from template. |
| `sensors.md` | Ported | `ADR-0006-sensors.md` | Template has the base sensors decision but not the v0.3 APSS-canonical follow-up. |
| `stack-manager.md` | Ported | `ADR-0001-stack-manager.md` | Direct slug match. |
| `strict-typing.md` | Ported | `ADR-0014-strict-typing.md` | Mapped from lab audit status to APSS `proposed`. |
| `task-runner.md` | Ported | `ADR-0008-task-runner.md` | Direct slug match. |
| `telemetry-sdk.md` | Ported | `ADR-0004-telemetry-sdk.md` | Direct slug match. |
| `versioning.md` | Ported | `ADR-0011-versioning.md` | Direct slug match. |

## Template-only ADRs

| Template ADR | Lab counterpart | Notes |
|---|---|---|
| `ADR-0016-createapp-wrapper-design.md` | None | Template-local future wrapper design. Not present in the lab decisions directory. |

## Missing Lab Decisions

`sensors-v0.3-apss-canonical.md` is the only lab decision record with no template ADR counterpart.

The lab record title is `Decision: sensors v0.3 - APSS as canonical measurement layer`. It marks APSS as the canonical measurement layer and partially supersedes the earlier sensors adapter-set record. The template's `ADR-0006-sensors.md` mentions APSS-canonical history as upstream context, but no local numbered ADR exists for that decision.

If ported later, the next available template number after the current corpus is `ADR-0017-*`. A likely name would be `ADR-0017-sensors-v0-3-apss-canonical.md`, preserving the lab slug while satisfying `ADR-NNNN-kebab-case.md`.

## APSS ADR01 Conformance Notes

APSS PR 61 establishes:

- Default docs root: `docs`
- Default ADR directory: `adrs`
- Effective default ADR path: `docs/adrs/`
- Default ADR filename pattern: `ADR-\d{3,5}-[a-zA-Z0-9-]+\.md`
- Required ADR directory context files: `CLAUDE.md` and `AGENTS.md`
- Required ADR sections: `## Context`, `## Decision`, and `## Consequences`

Template `HEAD` is only partially conformant:

- Conformant: ADR filenames use `ADR-0001-...` through `ADR-0016-...`, which satisfies the 3-to-5 digit APSS regex.
- Conformant: `README.md`, `CLAUDE.md`, and `AGENTS.md` exist in the ADR directory.
- Conformant: migrated ADR bodies have APSS front matter and required Context/Decision/Consequences sections.
- Nonconformant: committed directory path is `docs/adr/`, singular, not APSS default `docs/adrs/`.

The current working tree has an interrupted uncommitted plural-directory rename to `docs/adrs/`. That working tree state conforms on directory and filename shape, but it is not committed and should not be treated as repository truth until intentionally staged, reviewed, and committed.

## Recommended Follow-up Beads

No beads were filed as part of this discovery-only pass.

Candidate follow-up work:

| Candidate | Reason |
|---|---|
| Correct committed ADR directory to `docs/adrs/` | Required for APSS ADR01 default-directory conformance. |
| Port `sensors-v0.3-apss-canonical.md` as `ADR-0017-*` | Only missing lab decision record; needed to preserve APSS-canonical sensors lineage locally. |
| Update existing n48 child bead text that still says `docs/adr` | Several bead descriptions in the local bead database still mention singular paths, but they were not edited in this discovery pass. |
