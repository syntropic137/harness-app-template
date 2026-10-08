# Landing: `just land`

Gated, isolated landing of a branch onto the target branch, for forks with no CI
and no branch protection. Decision record: [ADR-0033](../adrs/ADR-0033-gated-landing-flow.md).

```sh
just land <branch-or-commit>                 # gate, then push
just land <ref> -- --dry-run                 # gate and run the real pre-push guards, push nothing
just land <ref> -- --mode cherry-pick        # auto (default) | ff-only | cherry-pick | merge
```

## What it does

1. Takes the per-machine lock (`~/.cache/harness-land/land.lock`, override with `HARNESS_LAND_LOCK`). Waiting landings print the holder and when it started. A dead PID or a lock from before a reboot is released automatically.
2. Waits while the 1-minute load average is above `loadMax`.
3. Resets a persistent landing worktree (`~/.cache/harness-land/<repo>/worktree`) to fresh `origin/<target>` and applies the ref. Ignored caches (`node_modules`, `target/`) are kept; the caller's `CARGO_TARGET_DIR` is never inherited.
4. Classifies the diff into scopes, prints the plan, and runs the applicable gates once, through `lefthook run pre-push --force --job ...`. Each job must appear as passed in lefthook's summary; exit 0 alone is not trusted.
5. Pushes with `HARNESS_LAND_GATE=<sha>` and `LEFTHOOK_EXCLUDE` naming only the jobs verified on that exact SHA (plus jobs inapplicable to the diff). Everything else, including `guard-main-push`, `push-scope-guard` and any job `land.config.json` does not list, still runs at push time and takes seconds.
6. Decides success by fetching and checking `git merge-base --is-ancestor <sha> origin/<target>`, not by the push's exit status. A signal-killed push reports the signal.
7. If the target moved meanwhile, re-fetches, re-applies and re-gates. Evidence belongs to one SHA: after a re-apply it resets, unless `inheritUnaffectedEvidence` is on and the diff between the two SHAs provably misses a gate's scopes.

When unsure it runs everything: an unmapped path, a path in `full`, an unreadable diff, or any change to `land.config.json`, `lefthook.yml`, `scripts/land.ts` or `scripts/lib/land/**`.

## `land.config.json` (consumer-owned)

`just update` never touches it. Keys: `remote`, `targetBranch`, `loadMax`, `loadPollSeconds`, `loadWaitMaxSeconds`, `lockWaitMaxSeconds`, `maxAttempts`, `markerEnv`, `lefthook`, `inheritUnaffectedEvidence`, `metadataSafe` (globs a direct push to the target may change without the gate), `scopes` (name to globs), `full` (globs that force every gate), `bootstrap`, `preflight`, `gates`, `checks`, `env`.

- A **gate** with no `run` is a lefthook pre-push job of that name. With `run` it is a shell command. `when` lists scope names; omit it for an unconditional gate.
- A **check** is a shell command that always runs after the gates. Placeholders: `{base}`, `{head}`, `{worktree}`, `{source}`. `cwd` is `worktree` (default) or `source` (the invoking checkout, which the applied ref cannot alter). Project-specific rules (for example "baseline.json must not differ from the base") live here, not in the engine.
- `preflight` checks run before the lock is taken.

Ambient `LEFTHOOK`, `LEFTHOOK_EXCLUDE`, `CARGO_TARGET_DIR` and the marker variable are stripped from the environment of every gate and the push.

## Exit codes

`0` landed (or dry run ok), `1` a gate or check failed, `2` push or fetch failed, `64` usage, `75` lock or load wait exhausted.
