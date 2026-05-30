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
just update -- --force         # apply even with dirty harness-owned paths (stash + pop)
```

The update is **path-scoped by construction**: only harness-owned surfaces (see below) get fast-forwarded. `ws_apps/`, `ws_packages/`, and `infra/` stay byte-for-byte untouched. There is no whole-repo merge.

## Why path-scoped

The risky alternative is `git merge upstream/main`. That works for a vanilla fork, but the moment you've edited `ws_apps/your-service/src/main.ts` and upstream has improved a harness slot, the merge tries to reconcile both — and you spend an afternoon in a 3-way diff over code upstream doesn't even own.

`just update` does the opposite: it runs

```sh
git fetch upstream <ref>
git checkout upstream/<ref> -- <harness-owned-paths-only>
git commit -m 'update: harness sync from upstream@<sha>'
```

so `ws_apps/`, `ws_packages/`, and your other consumer-owned trees never enter the checkout's path list. Upstream changes to harness pieces ARE applied (overwriting any local harness edits — that's the trade-off); upstream changes to consumer paths CAN'T be applied because they're never asked for.

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

Anything not on this list is **consumer-owned** and never touched by `just update`. The seed examples in `ws_apps/example-*` and `ws_packages/` are sync-owned only **at fork time** (when you click "Use this template"); from your first commit onward they belong to you.

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

When you have local edits to harness-owned files (e.g. you customised `lefthook.yml`), `just update` refuses by default — overwriting them silently is the wrong shape. With `--force`, `update.ts` stash-pushes the dirty harness-owned paths, runs the checkout, then stash-pops, leaving your local edits to merge against the new upstream by hand. Consumer-owned paths are never stashed (they're never touched).

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

The `local harness edits:` line is informational — it shows which harness-owned files have your local changes. If that list overlaps with what upstream is bringing, expect a conflict on the apply.

## Provenance (`.harness-provenance.json`)

`scripts/init.ts` writes a small git-native provenance file at `just init` time:

```jsonc
{
  "schemaVersion": "1.0",
  "canonical_repo": "https://github.com/syntropic137/harness-app-template",
  "canonical_commit": "<sha>",                  // upstream commit you forked from
  "forked_at": "2026-05-12T08:21:00.000Z"        // UTC, ISO 8601
}
```

The file is **immutable after init** — `just update` refuses to run if you've modified `.harness-provenance.json` (revert with `git checkout HEAD -- .harness-provenance.json` first). It's informational to `just update` (used in the preview line), not load-bearing on the merge mechanic. Missing file = legal — older consumers may not have one; the update path still works.

If you want to re-stamp the file (e.g. you wiped it by accident), `git checkout` is the right answer rather than re-running `just init` — `init` is idempotent for the rename set, but it resets seed example names which you've probably edited.

## Choosing the upstream branch

The default is `main`. Override per-clone:

```sh
git config harness.upstreamRef next
```

`update.ts` reads this from git config — it's never stored in a tracked file (otherwise `just update` would overwrite your preference on the next sync). Useful if upstream cuts release branches like `release/v0.5.x` and you want to track a specific one.

## When `just update` fails

| Error | What it means | Fix |
|---|---|---|
| `no `upstream` remote configured` | You didn't run `git remote add upstream …` in Get Started step 3 | Run `git remote add upstream https://github.com/syntropic137/harness-app-template` |
| `.harness-provenance.json is immutable after init; revert it before updating` | You edited the provenance file | `git checkout HEAD -- .harness-provenance.json` |
| `dirty harness-owned paths would be overwritten: …` | You have uncommitted edits to harness-owned files | Commit them, stash them, or rerun with `--force` (stashes + pops automatically) |
| `no harness-owned paths found upstream; nothing to update` | The upstream `<ref>` doesn't carry any files matching the harness path list (extremely rare; usually means `upstream` is pointed at the wrong repo) | Verify `git remote -v` shows the canonical CHA repo |

The script exits 0 with `already up to date with upstream <sha>` when your template base matches upstream — no commit is created.

## What `just update` doesn't do

- **No `ws_apps/` / `ws_packages/` changes.** Path-scoping is enforced by `git checkout upstream/<ref> -- <harness-paths-only>`. There is no opt-in for "also update the seed examples" — once you've forked, the seeds are yours.
- **No `infra/` changes.** `infra/` is reserved for *your* deploy infra (compose files for your app's databases, k8s manifests, etc.). The harness's observability compose lives at `harness/observability/compose.harness.yml`.
- **No rebase semantics.** Path-scoped checkout + commit produces a fast-forward-shaped history, but the underlying mechanic is `git checkout` + `git commit`, not `git rebase`. If you want a linear history relative to upstream, run `just update` regularly so the per-update commits stay small.
- **No automatic conflict resolution.** If `--force` stashes dirty harness-owned edits and the upstream changes conflict, you'll see the conflict in `git stash pop` and resolve normally. The script doesn't try to be smart about it.
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
