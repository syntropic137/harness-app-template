# ADR Directory Instructions

This directory contains APSS ADR01 architecture decision records for the harness app template.

Before changing harness-owned architecture, tooling, or policy, read the governing ADRs in this directory and preserve their lifecycle semantics:

- Accepted ADRs govern current behavior.
- Proposed ADRs are not binding until accepted.
- Deprecated ADRs should not guide new work.
- Superseded ADRs must point to the replacement ADR.

When implementation files are governed by an ADR, add a backlink using the exact ADR identifier:

```text
// Implements ADR-0006-sensors
```

Do not renumber accepted ADRs. If a decision changes materially, create the next `ADR-NNNN-kebab-case-title.md` file and mark the older record as superseded.
