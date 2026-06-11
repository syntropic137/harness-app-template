# Beads Viewer (`bv`) — Agent Reference

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`) for issue tracking and [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) (`bv`) for graph-aware triage. Issues are stored in `.beads/` and tracked in git.

**Scope boundary:** `bv` handles *what to work on* (triage, priority, planning). `br` handles creating, modifying, and closing beads.

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

Before claiming, verify current state with `br show <id> --json` or `br ready --json`. `recommendations` can include graph-important blocked or assigned work; only `quick_ref.top_picks` and non-empty `claim_command` fields represent claimable work.

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

## Scoping & Filtering

```bash
bv --robot-plan --label backend              # scope to label's subgraph
bv --robot-insights --as-of HEAD~30          # historical point-in-time
bv --recipe actionable --robot-plan          # pre-filter: ready to work (no blockers)
bv --recipe high-impact --robot-triage       # pre-filter: top PageRank scores
```

## `br` Issue Management

```bash
br ready                                     # issues ready to work (no blockers)
br list --status=open                        # all open issues
br show <id>                                 # full issue details with dependencies
br create --title="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason="Completed"
br close <id1> <id2>                         # close multiple at once
br sync --flush-only                         # export DB to JSONL
br dep add <issue> <depends-on>              # add dependency
```

**Priority:** P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers 0–4)  
**Types:** task, bug, feature, epic, chore, docs, question

## Session Workflow

1. **Triage** — `bv --robot-triage` to find highest-impact actionable work
2. **Claim** — `br update <id> --status=in_progress`
3. **Work** — implement the task
4. **Complete** — `br close <id>`
5. **Sync** — `br sync --flush-only` then commit `.beads/`

```bash
git status
git add <files>
br sync --flush-only
git commit -m "..."
git push
```
