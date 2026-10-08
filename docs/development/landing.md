# Landing: `just land`

Gated, isolated landing of a branch onto the target branch, for forks with no CI
and no branch protection. Decision record: [ADR-0033](../adrs/ADR-0033-gated-landing-flow.md).

```sh
just land <branch-or-commit>                 # gate, then push
just land <ref> -- --dry-run                 # gate and run the real pre-push guards, push nothing
just land <ref> -- --mode cherry-pick        # auto (default) | ff-only | cherry-pick | merge
```

## What it does

1. Takes the per-machine lock (`~/.cache/harness-land/land.lock`, override with `HARNESS_LAND_LOCK`). By default it **refuses at once** and names the holder (PID, user, repo, ref, start time, minutes elapsed), so a blocked agent can do other work; `--wait <seconds>` (or `lockWaitMaxSeconds`) queues instead. The holder is recorded explicitly in the lock, never inferred from process shapes. A dead PID or a lock from before a reboot is released automatically.
2. Waits while the 1-minute load average is above `loadMax`, or while `quietCommand` (optional shell command, exit 0 means quiet) fails. Load average misjudges an I/O-starved box (a stalled disk shows little CPU load), which is what fails vitest's fixed worker timeouts; put a disk or paging check in `quietCommand`.
3. Resets a persistent landing worktree (`~/.cache/harness-land/<repo>/worktree`) to fresh `origin/<target>` and applies the ref. Ignored caches (`node_modules`, `target/`) are kept; the caller's `CARGO_TARGET_DIR` is never inherited.
4. Classifies the diff into scopes, prints the plan, and runs the applicable gates once, through `lefthook run pre-push --force --job ...`. Each job must appear as passed in lefthook's summary; exit 0 alone is not trusted.
5. Pushes with `HARNESS_LAND_GATE=<sha>` and `LEFTHOOK_EXCLUDE` naming only the jobs verified on that exact SHA (plus jobs inapplicable to the diff). Everything else, including `guard-main-push`, `push-scope-guard` and any job `land.config.json` does not list, still runs at push time and takes seconds.
6. Decides success by fetching and checking `git merge-base --is-ancestor <sha> origin/<target>`, not by the push's exit status. A signal-killed push reports the signal.
7. If the target moved meanwhile, re-fetches, re-applies and re-gates. Evidence belongs to one SHA: after a re-apply it resets, unless `inheritUnaffectedEvidence` is on and the diff between the two SHAs provably misses a gate's scopes.

When unsure it runs everything: an unmapped path, a path in `full`, an unreadable diff, or any change to `land.config.json`, `lefthook.yml`, `scripts/land.ts` or `scripts/lib/land/**`.

## `land.config.json` (consumer-owned)

`just update` never touches it. Keys: `remote`, `targetBranch`, `loadMax`, `quietCommand`, `loadPollSeconds`, `loadWaitMaxSeconds`, `lockWaitMaxSeconds`, `maxAttempts`, `markerEnv`, `lefthook`, `lefthookSelector` (`--job` default; `--commands` for lefthook 1.x), `inheritUnaffectedEvidence`, `metadataSafe` (globs a direct push to the target may change without the gate), `scopes` (name to globs), `full` (globs that force every gate), `bootstrap`, `preflight`, `earlyChecks`, `gates`, `checks`, `env`.

- A **gate** with no `run` is a lefthook pre-push job of that name. With `run` it is a shell command. `when` lists scope names; omit it for an unconditional gate.
- A **check** is a shell command that always runs after the gates. Placeholders: `{base}`, `{head}`, `{worktree}`, `{source}`. `cwd` is `worktree` (default) or `source` (the invoking checkout, which the applied ref cannot alter). Project-specific rules (for example "baseline.json must not differ from the base") live here, not in the engine.
- `preflight` checks run before the lock is taken. `earlyChecks` run once the plan is printed, before bootstrap and any gate (for example: is the evidence host reachable), with the same placeholders as `checks`.

Ambient `LEFTHOOK`, `LEFTHOOK_EXCLUDE`, `CARGO_TARGET_DIR`, the marker variable and git routing or config variables (`GIT_DIR`, `GIT_CONFIG_*`, ...) are stripped from the environment of every gate and the push, after `env` is merged. `harness.hookBaseRemote` and `harness.hookBaseRef` are injected so every diff-scoped hook uses the landing base.

A gate may list `requires` (programs on PATH): many hooks exit 0 when a tool is missing, which a landing must treat as failure. `ignoreDirty` lists tracked paths a gate may rewrite; any other change to the tree, or to HEAD, after gating aborts the land. Gates named `guard-main-push` or `push-scope-guard.sh` are rejected, so the guards can never be excluded from the push.

## Exit codes

`0` landed (or dry run ok), `1` a gate or check failed, `2` push or fetch failed, `64` usage, `75` lock or load wait exhausted.

Deletion-only landings are refused by `push-scope-guard`: lefthook treats a push whose changed paths no longer exist on disk as empty and skips every other pre-push job, and a land cannot know the jobs it was never configured to run. Land such a change together with a non-deleting edit.
