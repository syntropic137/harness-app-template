---
name: "Issue Tracker: br to bd"
description: "Migrate the project issue store from br (beads_rust 0.2.11, a deliberate frozen fork) to bd (gastownhall/beads 1.0.4, the maintained upstream), behind a reversible transform script. Records what survives, what is lost irreversibly, the three atomic-import blockers, and the four unrequested side effects bd init has on a repo."
status: accepted
---

# ADR-0032: Issue Tracker — `br` to `bd`

**Date:** 2026-08-19
**Category:** Slot (issue tracking)
**Supersedes:** none
**Next review:** 2027-02-19

## Context

This project tracked issues with [`br`](https://github.com/Dicklesworthstone/beads_rust)
(beads_rust 0.2.11). `br` is a **deliberate fork, frozen** — its own README
states it "freezes the 'classic beads' architecture" of SQLite + JSONL rather
than track upstream. It will not gain gates, federation, or any other upstream
capability. [`bd`](https://github.com/gastownhall/beads) (1.0.4) is the
maintained upstream, is Dolt-backed, and was already installed on this machine.

The migration cost is one-time; the cost of staying on a frozen fork is
permanent. That is the whole argument. **It is explicitly not "1.0 is safer"** —
see Consequences: `bd` has silent-failure modes of its own, and trades one class
of data-loss risk for another.

This repo was chosen to go first because its store is the smallest on the
machine (84 records against a largest of 2,765). **The durable deliverable is
the transform script, not this migrated store.** Eleven further stores follow.

## Decision

Migrate to `bd`, behind `scripts/beads-migrate.ts` — a transform that works in
both directions, with a preflight that is a hard gate.

```sh
bun run scripts/beads-migrate.ts preflight <br.jsonl>              # scan; exits 1 on a fatal blocker
bun run scripts/beads-migrate.ts forward   <br.jsonl> -o <bd.jsonl> --preserve-provenance
bun run scripts/beads-migrate.ts reverse   <bd.jsonl> -o <br.jsonl> --reference <br-original.jsonl>
bun run scripts/beads-migrate.ts verify    <before.jsonl> <after.jsonl>
```

The reverse direction is not optional. It is the rollback path, and without it
the migration is one-way (see Consequences).

## Verification of this store

Measured before and after, not asserted. All five checks passed:

| Check | Before | After | Result |
|---|---|---|---|
| Records | 84 | 84 | exact (no tombstones to reconcile) |
| Dependency triples `(issue, depends_on, type)` | 31 | 31 | **sorted triples diffed — zero lines either direction** |
| Label assignments / unique labels | 211 / 50 | 211 / 50 | exact set match |
| Comments | 3 | 3 | text byte-identical |
| Longest description | 5,327 bytes | 5,327 bytes | md5 identical |
| `bv --robot-triage` | works | works | output byte-identical against `br` and `bd` copies |

Dependency counts alone would not have been proof; the triples were compared as
sorted sets so that an edge silently rewired to a different target would fail.

`verify` compares values rather than totals throughout — record **ids**, titles,
status/type/priority, description byte sizes, label sets, and provenance — after
review found it reconciling only counts, which a run that dropped one record and
gained another would have passed.

A full `br → bd → br` round trip was also run against real binaries: `br`
imported the reverse-transformed file cleanly (84/84) with comments — including
their original integer ids — byte-identical to the source.

## Consequences

### The three blockers on `bd import`

They fire in this order, and `bd import` is **atomic**: one bad record rolls
back the entire file and leaves the store at count 0, with the real error
scrolled off above a usage dump. A caller reading the tail sees nothing wrong.
**Success is `bd count`, never the tail of the import.**

1. `issue_type` outside bd's built-ins → `bd config set types.custom "..."`
2. `status` outside bd's built-ins → `bd config set status.custom "..."`
3. `description` over **65535 bytes** — a hard Dolt/MySQL column ceiling that no
   config changes. The limit is **bytes, not characters**: 40,000 `é` is 80,000
   bytes and fails while appearing to have room.

`bd init --from-jsonl`, bd's own documented happy path, dies on blocker 1 before
there is any opportunity to configure around it. Use init → config → import.

`bd config set types.custom` prints `Warning: "types.custom" is not a recognized
config key` **and then applies it**. That warning is not a failure.

**This store triggered none of the three** — its four types are all bd
built-ins, it holds no tombstones, and its longest description has 60KB of
headroom. That is precisely why the blocker paths are covered by fixtures in
`scripts/tests/beads-transform.test.ts` rather than by this migration: migrating
this store proves the happy path only, and the eleven stores that follow are
known to carry `docs`/`question` types, tombstones, and a 107,962-byte
description.

### What is lost, irreversibly

- **Sub-second timestamp precision.** `2026-06-01T23:04:32.755847387Z` becomes
  `2026-06-01T23:04:33Z` on all 84 records. Note this is **rounding, not
  truncation** — the recorded second moves *forward*, so a record can cross a
  second, and in principle a date, boundary. This degrades session forensics in
  `docs/retrospectives/`.
- **`source_repo` and `source_repo_path`.** bd tags `SourceRepo` as `json:"-"`
  and has no `source_repo_path` field at all. This store carries three records
  originating in other repos (`harness-lab`, `harness-vendor-slp`), so the
  migration ran with `--preserve-provenance`, which copies both into `metadata`.
  **Verified to survive**: all 84 records round-trip their provenance through
  import and export, and `bd show` renders a METADATA block. This was an open
  question before the migration, not a documented guarantee.
- **`compaction_level`, `original_size`, `thread_id`.** Dropped, but verified
  null/empty across all 84 records: no actual loss here.

### What bd loses silently — enumerate before, not after

- **Tombstones vanish.** bd has no tombstone concept; its importer skips them
  and still reports success (upstream: "Imported 762 issues" from a 764-line
  file, with no mention of the gap). **Consequence: deletions stop replicating.**
  Anything deleted in `br` returns from the dead on a round trip. This store has
  zero tombstones, so nothing was lost here — but the preflight enumerates them
  because after the import there is nothing left to notice.
- **Closed issues with no `closed_at` get one fabricated.** Invented data, which
  is worse than missing data for forensics. Zero records here were affected.

### Not bidirectional without the transform

`br` cannot read `bd`'s export as emitted. bd rewrites every comment `id` from
an integer to a UUID string; `br`'s schema requires an `i64` and aborts on the
first one:

```
Error: Configuration error: Invalid JSON at line 29: invalid type: string
"e4a4cec4-...", expected i64 at line 1 column 6603
```

Rewriting those ids back to integers makes `br` import cleanly. `reverse`
does this, and with `--reference <original.jsonl>` it restores each comment's
*original* integer id by matching on issue, occurrence ordinal, and text — so
the round trip is exact rather than merely valid. Without the reference it
assigns fresh sequential ids and says so; comment text survives either way.

**The timestamp is deliberately not part of that match key.** bd stores comment
timestamps at whole-second resolution and *rounds* to get there, so br's
`...:19.987654321Z` returns as `...:20Z` — probe-verified against bd 1.0.4. An
earlier revision keyed on the timestamp, which meant every ns-precision comment
(br's default) missed the index and was silently renumbered on rollback. This
store's own comments happen to sit on whole seconds, so both the fixtures and
the live round trip passed while the bug was present; it was caught by review,
not by the migration.

### `bd init` has four unrequested side effects on the repo

Running it is not idempotent housekeeping. On this repo it:

1. **created a git commit** (`bd init: initialize beads issue tracking`) under
   the operator's name, staging 13 files;
2. **repointed `core.hooksPath`** to `.beads/hooks/`, having copied lefthook's
   scripts there with its own block appended. Gates keep running — but
   `.git/hooks/` is now the *unread* copy, so the next `lefthook install`
   updates hooks git no longer looks at, and gate changes silently stop taking
   effect;
3. **injected `SessionStart` and `PreCompact` hooks running `bd prime` into
   `.claude/settings.json`**, wiring itself into every future agent session's
   context, and stripped the file's trailing newline;
4. **appended an instruction block to `AGENTS.md`** — the repo's canonical agent
   context — including a mandatory-push session protocol that conflicts with
   this project's PR-based workflow.

All four were reverted. The bd sync step is instead declared in `lefthook.yml`
(`beads-export` on pre-commit, `beads-import` on post-merge and post-checkout),
which keeps `lefthook.yml` this repo's single gate surface. `AGENTS.md` carries
a do-not-run-`bd init` warning.

Side effect 3 is the one to weigh deliberately: a tracker that installs its own
`SessionStart` hook is a self-installing context-injection path. If `bd prime`
in agent context is wanted here, it should be added as an explicit, reviewed
change — not inherited from an init command.

### Repointing cost, measured

Cheaper than the upstream spike projected, because this repo has **no
`validate-beads-jsonl.py` and no `beads-jsonl-schema` lefthook gate** — the
predicted "fails on every commit" breakage does not exist here. Actual surface:
`CONTRIBUTING.md`, `AGENTS.md`, `docs/development/beads-viewer.md`,
`docs/development/README.md`, the `orchestrating-a-vps-agent-swarm` skill, and
two vendored `br` help dumps (replaced with `bd` equivalents). A historical plan
under `docs/superpowers/plans/` still names `br`; it is a dated record of a past
plan and was deliberately left alone.

This is the evidence for upstream issue
[syntropic137/harness-app-template#73](https://github.com/syntropic137/harness-app-template/issues/73),
which asks the template to make the tracker a swappable slot instead of
hard-wiring one binary. The repointing above is exactly the cost that a real
slot boundary would have removed.

### `bv` is backend-agnostic to read, but not to write

`bv --robot-triage` produces **byte-identical** output against `br` and `bd`
copies of this store, so triage is not a day-one breakage. But every command
string it emits — `commands.claim_top`, every `claim_command` — is hardcoded to
`br` (`CI=1 br update <id> --status in_progress --json`). Those commands do not
work after migration. The upstream spike predicted `bv` would work and it does;
what it did not predict is that `bv`'s *emitted* commands do not. Documented in
`docs/development/beads-viewer.md` with a translation table.

## Rollback

`.beads/issues.jsonl` before migration is preserved in git history (this ADR's
parent commit). To roll back:

```sh
git show <pre-migration-sha>:.beads/issues.jsonl > /tmp/br-restore.jsonl
# or, from the current bd store:
bd export -o /tmp/bd-current.jsonl
bun run scripts/beads-migrate.ts reverse /tmp/bd-current.jsonl \
  -o .beads/issues.jsonl --reference /tmp/br-restore.jsonl
br sync --import-only
```

Do not delete `.beads/issues.jsonl` from git history; it is the rollback.
