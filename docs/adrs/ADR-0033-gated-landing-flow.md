---
name: "Gated landing flow — gate once before the network, land with a SHA-bound fast push"
description: "Add a first-class `just land` flow: an isolated persistent landing worktree, a per-machine lock plus load check, diff-scoped gates run once through lefthook before any network use, a SHA-bound fast push, re-gating on main movement, and success decided by origin/main containing the SHA. Project specifics are configuration in land.config.json, not forked code."
status: proposed
---

# ADR-0033: Gated landing flow

**Date:** 2026-10-08
**Category:** Slot (task-runner / hooks)
**Supersedes:** none
**Next review:** 2027-04-08

## Context

Forks without CI or branch protection need one property: only commits that
passed the full gate set on top of fresh `main` reach `main`, and never from a
shared checkout. DreamShip built this locally (`scripts/mac-land.ts`) and it
failed repeatedly. Observed failures, all in one day:

1. Gates ran inside `git push` as pre-push hooks. The SSH connection idled 7-12
   minutes, GitHub closed it, and the push died after every gate passed.
2. Gates ran twice (`just test` + sensors, then 17 pre-push jobs). `cov-ts`
   alone took 330-770 s, even on diffs touching no TypeScript.
3. Every land built in a cold throwaway worktree.
4. Concurrent lands drove load to 60-190, flaked vitest, and a shared cargo
   target dir gave one land stale rlibs from another land's source.
5. A signal-killed child (`status === null`) was reported as "status 1". One
   reported failure actually landed; others reported failure and did not.
6. `main` moved during the long run and the land failed instead of re-applying.

## Decision

`scripts/land.ts` (+ `scripts/lib/land/*`), run as `just land <ref>`, with
behaviour read from consumer-owned `land.config.json`.

1. **Serialize.** Per-machine lock (`O_EXCL` file, pid + start time, stale
   detection) so landings queue and print who holds it. After acquiring it, wait
   while the 1-minute load exceeds `loadMax` (poll, bounded, fail loudly).
2. **Persistent worktree per repo** under `~/.cache/harness-land/<repo-id>/`,
   reset each run to fresh `origin/<target>` (`reset --hard`, `clean -fd`, never
   `-x`, so `node_modules` and its own `target/` stay warm). Its cargo target dir
   lives inside it, never shared across repos. The lock makes it single-writer.
3. **Apply** the ref (ff-only / cherry-pick / merge, as today).
4. **Scope.** Changed files = `base..HEAD`. `scopes` in config maps glob sets to
   names; each gate declares `when`. A path in the `full` scope, or an
   unreadable diff, runs every gate. Docs/beads-only runs only `always` gates.
5. **Gate once, before the network.** Selected lefthook pre-push jobs run via
   `lefthook run pre-push --force --job ...` in the worktree (lefthook stays the
   single source of the job commands and runs them in parallel). Success is
   measured, not inferred: every selected job must appear as passed in the
   summary, so a silent skip cannot pass. Extra land-only gates and project
   `checks` (shell, with `{base}` `{head}` `{worktree}`) follow.
6. **Main moved?** Re-fetch, re-apply, and re-gate only gates whose scope
   intersects `old_base..new_base` (all of them if the delta hits `full`);
   `always` gates and project checks always re-run. Bounded retries.
7. **Fast push.** `git push` with the SHA-bound marker env (name configurable,
   default `HARNESS_LAND_GATE`) and `LEFTHOOK_EXCLUDE` set to exactly the jobs
   this run verified green or scoped out on this commit. Any job the config does
   not list still runs at push (fail-safe: unknown jobs are slow, never skipped).
   The guards (`guard-main-push`, `push-scope-guard`, versioning) run in seconds.
8. **Success = origin/main contains the SHA**: after the push, fetch and
   `git merge-base --is-ancestor <sha> origin/<target>`, regardless of push exit
   status. A killed child reports its signal name. A signal or exit 128 push that
   did not land, with `main` unmoved, is retried (gates are already green).
9. **Logs:** child output goes to per-gate log files and a summary; carriage-return
   progress is folded to its final line; `CI=1 NO_COLOR=1` and cargo progress off.
10. `--dry-run` runs everything and then executes the real pre-push hook with
    synthetic ref lines (`git hook run`), so the guards are exercised too.

The template also ships generalized `guard-main-push` and `push-scope-guard`
(marker env name and metadata-safe paths from config), since the SHA binding is
meaningless without them.

## Acceptance criteria

Measured on the DreamShip dogfood (phase 3), same machine, comparing the old
`just land` against this flow on a docs-only diff and a Rust-only diff. Numbers
are recorded in the "Measured results" section below when the dogfood lands;
this ADR stays `proposed` until they are filled in and meet the bar.

| Property | Bar |
|---|---|
| Docs-only land, wall clock, idle machine | at most 60 s of gating; no Rust or TS suite runs |
| Rust-only land, wall clock | gating at most the Rust gates alone (no `cov-ts`); warm-cache rebuild not a cold compile |
| `git push` duration | under 15 s; no gate runs inside the push |
| Gates executed per land | each selected gate once per SHA (no second pre-push pass) |
| Push killed or reported failed | outcome decided by `origin/<target>` containing the SHA; signal name printed |
| `LEFTHOOK_EXCLUDE` at push | lists only jobs that passed on the exact SHA pushed, plus jobs inapplicable to its diff; evidence resets when the SHA changes (tested) |
| Unsure | an unmapped path, an unmatched glob, an unreadable diff, or a change to `land.config.json`, `lefthook.yml` or the land engine runs the full suite (tested) |
| Lock | one per machine (not per path or worktree), released by a dead PID or a reboot, prints holder and start time (tested) |

Before (old flow, 2026-10-07, DreamShip): 7-12 min of gates inside the push,
the connection closed by GitHub after the gates passed; gates ran twice;
`cov-ts` 330-770 s even on non-TS diffs.

### Measured results

To be recorded here from the DreamShip dogfood.

## Consequences

- Push duration drops to seconds; the idle-SSH failure class disappears.
- Gates run once. Docs-only lands skip Rust and TS suites.
- The scope map is a trust surface: a wrong mapping skips a gate. Mitigations:
  `full` scope for shared paths, unknown paths fall into `full`, and the
  scope-to-gate plan is printed on every run.
- `baseline.json`-style project aborts are `checks` entries, not engine code.
- Fail closed on soft skips: a gate may declare `requires` (programs that must be on PATH), because
  several hooks exit 0 when a tool is missing. Every hook's diff base is bound to the landing base
  through injected `harness.hookBase*` config, ambient git routing/config variables are stripped, and
  after gating HEAD must be unchanged and tracked files clean (except `ignoreDirty`), so evidence
  binds the pushed SHA. The push names the literal SHA.
- Not solved: `--no-verify`, `LEFTHOOK=0`, an ad hoc `LEFTHOOK_EXCLUDE` and a forged marker remain conscious
  bypasses. Real enforcement needs server-side protection.
