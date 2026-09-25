# Updating your fork

How to keep your fork's harness in sync with upstream improvements, without your application code ever being touched. This is the consumer-facing reference for `just update`; the implementation lives at [`scripts/update.ts`](../scripts/update.ts) and the architectural rationale at [`docs/adrs/ADR-0015-cha-sync-source-of-truth.md`](./adrs/ADR-0015-cha-sync-source-of-truth.md).

## TL;DR

```sh
# one-time, after `git clone <your-fork>`:
git remote add upstream https://github.com/syntropic137/harness-app-template

# whenever you want to pull harness improvements:
just update                    # preview (in non-TTY) or apply (in TTY)
just update -- --check         # preview, never mutate, exit non-zero if updates exist
just update -- --write         # apply, even without a TTY
just update -- --force         # upstream wins for conflicts; dirty harness edits stashed + popped
```

The update is **path-scoped by construction**: only harness-owned surfaces (see below) are touched, each one three-way merged per file. `ws_apps/`, `ws_packages/`, and `infra/` stay byte-for-byte untouched. There is no whole-repo merge.

## Why path-scoped

The risky alternative is `git merge upstream/main`. That works for a vanilla fork, but the moment you've edited `ws_apps/your-service/src/main.ts` and upstream has improved a harness slot, the merge tries to reconcile both — and you spend an afternoon in a 3-way diff over code upstream doesn't even own.

`just update` does the opposite: it fetches `upstream/<ref>` and runs a **per-file three-way merge over the harness-owned paths only**. base = the upstream commit you last synced to (recorded as a `Harness-Upstream:` trailer on the previous sync commit), falling back to `git merge-base HEAD upstream/<ref>`; ours = `HEAD`; theirs = upstream.

| Category | When | Result |
|---|---|---|
| `fast-forward` | you never changed the file | take upstream (including upstream adds and deletes) |
| `keep-local` | upstream never changed the file | keep yours |
| `merge-clean` | both changed, `git merge-file` merges cleanly | merged result applied |
| `conflict` | overlapping edits; binary or symlink changed on both sides | standard `<<<<<<<` markers left in the working tree (binary/symlink keep your copy), **nothing committed**, exit 1 listing each file |
| `kept-deleted` | you deleted it, upstream changed it | stays deleted, reported; does not block the update |
| `kept-modified` | upstream deleted it, you changed it | stays (yours), reported; does not block the update |

With no conflicts the result is committed as `update: harness sync from upstream@<sha>` with a `Harness-Upstream: <full-sha>` trailer. The commit is path-limited to the harness files the update touched, so anything else you had staged stays staged and out of it. On conflict, every non-conflicting change is staged; resolve the listed files, `git add` them, and run the path-limited `git commit` the error prints (keep the trailer so the next update merges from this point).

So your committed customizations to harness files (a tweaked `.claude/skills/*/SKILL.md`, a hardened `lefthook.yml` job) survive updates unless upstream changed the same lines. `ws_apps/`, `ws_packages/`, and your other consumer-owned trees are never part of the merge.

## What `just update` touches (harness-owned paths)

The exact list, sourced from [`scripts/update.ts`](../scripts/update.ts):

```
harness/                       # slot plugins (stack, inspector, sensors, hooks, …)
.claude/                       # agent context (skills, hooks, settings)
scripts/                       # TS runners under just (init, update, bootstrap, …)
docs/standard/                 # the Tool-Belt Harness Standard
security.md                    # the security standard
lefthook.yml                   # hook gates
biome.jsonc                    # formatter / linter config
turbo.json                     # task graph + cache
cog.toml                       # cocogitto config
tsconfig.base.json             # root TS config
vitest.config.ts               # root test runner config
.gitignore
.github/CODEOWNERS
.github/workflows/test.yml
harness.manifest.json          # slot ⟶ plugin documentation
```

Anything not on this list is **consumer-owned** and never touched by `just update`. That includes the coverage-gate extension point `vitest.consumer.json` — see [Excluding your own scripts from the coverage gate](#excluding-your-own-scripts-from-the-coverage-gate). The seed examples in `ws_apps/example-*` and `ws_packages/` are sync-owned only **at fork time** (when you click "Use this template"); from your first commit onward they belong to you.

## Modes

`just update` accepts arguments after `--` because it delegates to `scripts/update.ts` through `bun run`.

### `just update` (default)

- **TTY:** applies the update (`--strategy=merge`).
- **Non-TTY** (CI / piped output / `nohup`): prints a preview and stops without mutating, with a `rerun with --strategy=merge to apply` hint.

The non-TTY safety default exists because automated runs SHOULD opt into the change, not have it happen silently.

### `just update -- --check`

Preview only, never mutate. Exits **non-zero** if upstream is ahead of your template base. Useful in CI to fail the pipeline when a sync is overdue:

```yaml
# .github/workflows/check-harness-sync.yml
- run: just update -- --check
```

### `just update -- --write`

Force the apply path even without a TTY. Use in trusted automation:

```yaml
- run: just update -- --write
- run: git push  # if the commit landed
```

### `just update -- --force`

`--force` means **upstream wins wherever the merge could not decide**: every `conflict`, `kept-deleted` and `kept-modified` file takes the upstream side (the old wholesale-overwrite behaviour, now limited to files that actually conflict). Clean merges and `keep-local` files are unaffected.

It also covers *uncommitted* edits: without `--force`, dirty harness-owned paths refuse the update; with it, `update.ts` stash-pushes them, applies, then stash-pops. If that pop conflicts, the sync commit stands, the stash is kept, and the command exits non-zero naming the conflicted files and the recovery steps. Consumer-owned paths are never stashed (they're never touched).

### `just update -- --strategy=preview` / `--strategy=merge`

Override the TTY heuristic explicitly. The `--write` flag is shorthand for `--strategy=merge`.

## Output shape

A typical preview:

```
upstream upstream/main is 3 commit(s) ahead of template base a1b2c3d
provenance: forked at d4e5f6a (2026-05-12T08:21:00Z)
- f1a2b3c hooks: add `harness.hookBaseRef` override
- e2b3c4d security: pin actions to commit SHA
- d3c4b5a docs: expand updating.md
local harness edits: .claude/skills/observability-queries/SKILL.md
just update: preview only (no TTY detected). rerun with
  `just update -- --strategy=merge` to apply harness updates.
```

The `local harness edits:` line lists harness-owned files you have changed. The preview also prints the per-file plan, one block per category, e.g.:

```
fast-forward (take upstream): 2
  harness/stack/boot.ts
  lefthook.yml
merge-clean (both changed, merges cleanly): 1
  .claude/skills/observability-queries/SKILL.md
conflict (needs manual resolution): 1
  scripts/test-coverage.ts (both modified)
```

## Provenance (`.harness-provenance.json`)

`scripts/init.ts` writes a small git-native provenance file at `just init` time:

```jsonc
{
  "schemaVersion": "1.0",
  "canonical_repo": "https://github.com/syntropic137/harness-app-template",
  "canonical_commit": "<sha>",                  // HEAD at init: the commit you started from
  "forked_at": "2026-05-12T08:21:00.000Z"        // UTC, ISO 8601
}
```

The file is **immutable after init** — `just update` refuses to run if you've modified `.harness-provenance.json` (revert with `git checkout HEAD -- .harness-provenance.json` first). When your history shares commits with upstream (a clone or fork), `just update` finds the merge base with `git merge-base` and the file is informational. When it does not (a `fresh` scaffold or a GitHub "Use this template" repo, which starts from a squashed root commit), `canonical_commit` is the merge base: used directly if it is an upstream commit, otherwise resolved to the upstream commit with the identical tree (what `just init` records for a "Use this template" repo). If neither resolves (the file is missing, or the recorded commit's tree matches no upstream commit because it already carried your changes), `just update` stops: set `canonical_commit` to the upstream commit you scaffolded from, commit that edit, and re-run. Missing file = legal only with shared history.

If you want to re-stamp the file (e.g. you wiped it by accident), `git checkout` is the right answer rather than re-running `just init` — `init` is idempotent for the rename set, but it resets seed example names which you've probably edited.

## Choosing the upstream branch

The default is `main`. Override per-clone:

```sh
git config harness.upstreamRef next
```

`update.ts` reads this from git config — it's never stored in a tracked file (otherwise `just update` would overwrite your preference on the next sync). Useful if upstream cuts release branches like `release/v0.5.x` and you want to track a specific one.

## Excluding your own scripts from the coverage gate

The root [`vitest.config.ts`](../vitest.config.ts) enforces 100 percent coverage over `scripts/**/*.ts` (see [ADR-0013](./adrs/ADR-0013-coverage-enforcement.md)). It is harness-owned, so editing its `coverage.exclude` array works exactly until your next `just update` — and then silently reverts, breaking the pre-push `cov-ts` gate with no obvious cause.

The supported lever is an optional `vitest.consumer.json` at the repo root. It is **not** in the harness-owned path list above, so `just update` never overwrites or deletes it:

```jsonc
// vitest.consumer.json — consumer-owned, commit it to your fork
{
  "coverage": {
    "exclude": ["scripts/ingest-my-seed-data.ts", "scripts/adhoc/**/*.ts"]
  }
}
```

`vitest.config.ts` reads the file at config-load time and appends the entries to its own `coverage.exclude`. Semantics:

- **Absent file** (the canonical template's own state) contributes zero entries — include globs, excludes, and thresholds are byte-identical to a fresh clone.
- **Malformed JSON** or a non-array / non-string `coverage.exclude` **fails loudly** with a message naming the file, rather than degrading to "no excludes". A silent degrade would reproduce the exact confusion this hatch exists to remove.
- Entries are ordinary vitest coverage globs, relative to the repo root.

The thresholds themselves stay at 100 percent and remain harness-owned; the lever exempts files from the measurement, it does not lower the bar. Exempt deliberately — a throwaway offline data-ingest script is a fair exemption; your app's business logic is not (and that belongs under `ws_apps/` with its own config anyway).

## When `just update` fails

| Error | What it means | Fix |
|---|---|---|
| `no `upstream` remote configured` | You didn't run `git remote add upstream …` in Get Started step 3 | Run `git remote add upstream https://github.com/syntropic137/harness-app-template` |
| `.harness-provenance.json is immutable after init; revert it before updating` | You edited the provenance file | `git checkout HEAD -- .harness-provenance.json` |
| `dirty harness-owned paths would be overwritten: …` | You have uncommitted edits to harness-owned files | Commit them, stash them, or rerun with `--force` (stashes + pops automatically) |
| `just update: N harness-owned file(s) conflict; NOTHING was committed.` | You and upstream changed the same lines (or the same binary/symlink) | Resolve the listed files, `git add`, commit with the printed message; or run the printed path-scoped `git restore --source=HEAD --staged --worktree -- <paths>` (touches only this update's files) and rerun with `--force` to take upstream for those files |
| `no harness-owned paths found upstream; nothing to update` | Neither your fork nor upstream `<ref>` carries any file matching the harness path list (if upstream deleted them all, that is a normal update instead) (extremely rare; usually means `upstream` is pointed at the wrong repo) | Verify `git remote -v` shows the canonical CHA repo |

The script exits 0 with `already up to date with upstream <sha>` when your template base matches upstream — no commit is created.

## What `just update` doesn't do

- **No `ws_apps/` / `ws_packages/` changes.** Path-scoping is enforced by merging only the harness-owned path list. There is no opt-in for "also update the seed examples" — once you've forked, the seeds are yours.
- **No `infra/` changes.** `infra/` is reserved for *your* deploy infra (compose files for your app's databases, k8s manifests, etc.). The harness's observability compose lives at `harness/observability/compose.harness.yml`.
- **No rebase semantics.** Per-file merge + commit produces a fast-forward-shaped history, but the underlying mechanic is `git merge-file` + `git commit`, not `git merge` or `git rebase`. If you want a linear history relative to upstream, run `just update` regularly so the per-update commits stay small.
- **No automatic conflict resolution.** Overlapping edits are left as conflict markers for you; `--force` is the only automatic choice, and it always picks upstream.
- **No lab upstream.** The R&D lab ([`agentic-harness-lab`](https://github.com/NeuralEmpowerment/agentic-harness-lab)) is research, NOT a live upstream. `upstream` always points at the canonical template repo ([`syntropic137/harness-app-template`](https://github.com/syntropic137/harness-app-template)). See [`docs/adrs/ADR-0015-cha-sync-source-of-truth.md`](./adrs/ADR-0015-cha-sync-source-of-truth.md) for the standalone framing.

## Pushing improvements back upstream

If your fork develops a harness improvement worth merging back, open a PR against the canonical repo with a commit-subject convention:

```
harness-engineering: from <your-repo>@<sha>: <one-line summary>
```

The `from <your-repo>@<sha>` suffix lets the maintainer trace the improvement back to its origin. The maintainer triages from there; not every back-contribution will land (the harness is opinionated), but the convention makes the path legible.

## Related reading

- [`scripts/update.ts`](../scripts/update.ts) — the implementation. ~250 lines, no external deps beyond `node:fs`, `node:path`, and the in-tree `lib/git.ts`.
- [`docs/adrs/ADR-0015-cha-sync-source-of-truth.md`](./adrs/ADR-0015-cha-sync-source-of-truth.md) — the architectural decision: why the canonical repo is standalone, why the update is path-scoped, what was rejected and why.
- [`docs/adrs/ADR-0008-task-runner.md`](./adrs/ADR-0008-task-runner.md) — why `just` is the human-facing entrypoint.
- [`security.md`](../security.md) — the security standard, including the controls that run on every commit / push.
