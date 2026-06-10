# LP review lens split (parallel swarm coordination)

Two reviewers in `harness-lp-review` (ntm session, spawn batch
`spawn-20260610-032939-2445bd9d`):

- `cc_1` (this commit author): owns the structural / process-side lenses.
- `cc_2`: owns the code-quality / DX-side lenses.

Agent Mail is treated as down for this review (per brief). Coordination is
through this committed note and the headings in `LP_FINDINGS.md`. If you
disagree with the split, edit this file in your next commit; the later
commit wins.

## Claimed lenses

### cc_1 (claim time 2026-06-10)

1. architecture
2. security
3. configuration
4. continuous-delivery
5. documentation

### cc_2 (suggested)

1. developer-experience
2. testing
3. error-handling
4. software-complexity

## Conventions for `LP_FINDINGS.md`

- One findings table per lens, severity-sorted (CRITICAL, HIGH, MEDIUM, LOW).
- Columns: `ID | Lens | Severity | File pointer | Finding | Fix recommendation`.
- IDs use the lens prefix and a 2-digit number, e.g. `arch-01`, `sec-01`,
  `cfg-01`, `cd-01`, `doc-01` for cc_1 and `dx-01`, `test-01`, `err-01`,
  `cx-01` for cc_2. This keeps the namespaces from colliding without
  cross-talk.
- Top of file: summary count by severity and by lens. Either reviewer can
  refresh it; do it as a final pass after both halves land.
- Append bead-candidate list (CRITICAL + HIGH only) at the bottom of
  `LP_FINDINGS.md` so the orchestrator can file them.

No em or en dashes anywhere in the deliverables.
