# Beads Viewer (`bv`) — Agent Reference

This project uses [beads](https://github.com/gastownhall/beads) (`bd`) for issue
tracking and [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer)
(`bv`) for graph-aware triage. Issues live in a local Dolt database under
`.beads/`; `.beads/issues.jsonl` is a passive export and is the only part of the
store git tracks.

> **Migrated from `br` on 2026-08-19.** This project previously used
> [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`), a
> deliberate fork frozen at the classic SQLite + JSONL architecture. See
> [ADR-0032](../adrs/ADR-0032-issue-tracker-br-to-bd.md) for the rationale,
> the measured losses, and the rollback path. `scripts/beads-migrate.ts` is the
> transform, in both directions.

**Scope boundary:** `bv` handles *what to work on* (triage, priority, planning).
`bd` handles creating, modifying, and closing beads.

**CRITICAL: Use ONLY `--robot-*` flags. Bare `bv` launches an interactive TUI that blocks your session.**

## Start Here: Triage

```bash
bv --robot-triage        # single entry point — returns everything
bv --robot-triage --format toon   # token-optimized output (lower LLM context)
bv --robot-next          # minimal: single top pick + claim command
```

`--robot-triage` returns:
- `quick_ref` — at-a-glance counts + top 3 picks
- `recommendations` — ranked actionable items with scores, reasons, unblock info
- `quick_wins` — low-effort high-impact items
- `blockers_to_clear` — items that unblock the most downstream work
- `project_health` — status/type/priority distributions, graph metrics
- `commands` — copy-paste shell commands for next steps

Before claiming, verify current state with `bd show <id> --json` or
`bd ready --json`. `recommendations` can include graph-important blocked or
assigned work; only `quick_ref.top_picks` and non-empty `claim_command` fields
represent claimable work.

> **Gotcha: `bv` emits `br` commands.** `bv` reads a `bd` store correctly —
> verified identical output against `br` and `bd` copies of this store — but the
> strings in its `commands` block and in every `claim_command` field are
> hardcoded to `br` (`CI=1 br update <id> --status in_progress --json`). Those
> commands will not work here. Translate to `bd` (see the table below) rather
> than pasting what `bv` prints. Tracked upstream in
> [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer).

## All `--robot-*` Commands

| Command | Returns |
|---------|---------|
| `--robot-triage` | Full triage: picks, wins, blockers, health, commands |
| `--robot-next` | Single top pick + claim command |
| `--robot-plan` | Parallel execution tracks with unblocks lists |
| `--robot-priority` | Priority misalignment detection with confidence |
| `--robot-insights` | Full metrics: PageRank, betweenness, HITS, eigenvector, critical path, cycles, k-core |
| `--robot-alerts` | Stale issues, blocking cascades, priority mismatches |
| `--robot-suggest` | Hygiene: duplicates, missing deps, label suggestions, cycle breaks |
| `--robot-diff --diff-since <ref>` | Changes since ref: new/closed/modified issues |
| `--robot-graph [--graph-format=json\|dot\|mermaid]` | Dependency graph export |

Note that `project_health.graph.edge_count` counts only `blocks`-type edges;
`parent-child` edges are modelled as hierarchy and do not appear in that number.
This store has 31 dependency edges but reports `edge_count: 1`, and did so under
`br` too — it is `bv` behaviour, not migration loss.

## Scoping & Filtering

```bash
bv --robot-plan --label backend              # scope to label's subgraph
bv --robot-insights --as-of HEAD~30          # historical point-in-time
bv --recipe actionable --robot-plan          # pre-filter: ready to work (no blockers)
bv --recipe high-impact --robot-triage       # pre-filter: top PageRank scores
```

## `bd` Issue Management

```bash
bd ready                                     # issues ready to work (no blockers)
bd list --status open                        # all open issues
bd show <id>                                 # full issue details with dependencies
bd create "title" -t task -p 2 -d "..."
bd update <id> --claim                       # atomic claim (assignee + in_progress)
bd close <id> --reason "Completed"
bd close <id1> <id2>                         # close multiple at once
bd export -o .beads/issues.jsonl             # export DB to JSONL
bd dep add <issue> <depends-on>              # add dependency
bd dep tree <id>                             # dependency tree, with [BLOCKED] markers
```

**Priority:** P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers 0–4)
**Types:** task, bug, feature, epic, chore, decision. Anything else needs
`bd config set types.custom "<comma,separated>"` *before* the type is used —
`bd` rejects unknown types, and on import that rejection is fatal to the whole
file (see below).

### Translating from `br`

| `br` | `bd` |
|---|---|
| `br ready` | `bd ready` |
| `br list --status=open` | `bd list --status open` |
| `br show <id>` | `bd show <id>` |
| `br create --title="T" --type=task --priority=2` | `bd create "T" -t task -p 2` |
| `br update <id> --status=in_progress` | `bd update <id> --claim` |
| `br close <id> --reason="..."` | `bd close <id> --reason "..."` |
| `br sync --flush-only` | `bd export -o .beads/issues.jsonl` (also runs in pre-commit) |
| `br dep add <a> <b>` | `bd dep add <a> <b>` |
| `br delete <id>` (tombstone) | *no equivalent* — `bd` has no tombstone concept |

## Session Workflow

1. **Triage** — `bv --robot-triage` to find highest-impact actionable work
2. **Claim** — `bd update <id> --claim`
3. **Work** — implement the task
4. **Complete** — `bd close <id> --reason "..."`
5. **Sync** — the lefthook `beads-export` pre-commit job exports the DB to
   `.beads/issues.jsonl` and stages it; commit `.beads/` with your change

```bash
git status
git add <files>
git commit -m "..."   # beads-export runs here
git push
```

## `bd import` is atomic — never judge it by its output

One bad record rolls back the entire file and leaves the store at count 0, with
the real error scrolled off *above* a usage dump. A caller reading the tail sees
no error at all.

**Always confirm with `bd count`, never with the tail of `bd import`.**

Three things abort an import, in the order they fire:

1. an `issue_type` outside bd's built-ins → `bd config set types.custom "..."`
2. a `status` outside bd's built-ins → `bd config set status.custom "..."`
3. a `description` over **65535 bytes** — a hard Dolt/MySQL column ceiling that
   no config changes. The limit is **bytes, not characters**: 40,000 `é` is
   80,000 bytes and fails while looking like it has room.

`bd config set types.custom` prints `Warning: "types.custom" is not a recognized
config key` **and then works**. That warning is not a failure.

Run `bun run scripts/beads-migrate.ts preflight <file.jsonl>` before importing
any foreign JSONL; it reports all three and exits non-zero on the third.
