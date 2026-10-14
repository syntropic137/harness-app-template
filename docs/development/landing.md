# Landing: `just verify`, then `just land`

Gated, isolated landing of a branch onto the target branch, for forks with no CI
and no branch protection. Decision record: [ADR-0033](../adrs/ADR-0033-gated-landing-flow.md).
Land v2 (verify, then land): ADR-0034 (proposed in PR #103), slice 2, simplified: everything runs on the machine that invokes it (no remote worker, no queue).

```sh
just land <branch-or-commit>                 # gate, then push
just land <ref> -- --dry-run                 # gate and run the real pre-push guards, push nothing
just land <ref> -- --mode cherry-pick        # auto (default) | ff-only | cherry-pick | merge
```

## Two steps: `just verify`, then `just land`

```sh
just verify <ref>                            # gates on fresh main, records a pass, pushes nothing
just land <ref>                              # from a current pass: seconds, no gates
just land <ref> -- --require-pass            # refuse (exit 3) instead of falling back to the full land
just land <ref> -- --pass-from <remote>      # use a pass verified in another clone (fetched from <remote>)
```

**Verify** does everything the full land below does except the lease and the push: it applies the
ref onto the fresh `origin/<target>` tip `B`, runs the same diff-scoped gates, checks and pre-push
dry run with the same `land.config.json`, and on success records a **pass** for the verified commit
`C` (`C` is the ref itself on a fast-forward, a new commit after a cherry-pick or merge). It runs in
a verification worktree of its own, `<landing home>/<repo>/verify/<n>/worktree` for
`n = 1..verifySlots` (default 3), each with its own `node_modules`, `target/` and bootstrap marker,
so several refs verify at once without sharing a build directory (a configured `cargoTargetDir` is
split per slot too). It never takes the landing lease. When every slot is busy it refuses at once
and names the holders (`--wait <seconds>` queues).

Verify first checks that the invoking checkout's land files are identical to `B`'s, including
uncommitted and untracked changes, and refuses before any gate when they are not: a pass is only
ever judged by the rules main holds. Rebase, or restore those files, and verify again. The land
files are `land.config.json`, `scripts/lib/land/`, `scripts/land.ts`, and every file lefthook reads
its rules from: `lefthook`, `.lefthook`, `lefthook-local` and `.lefthook-local` in each format
(`yml`, `yaml`, `json`, `jsonc`, `toml`), at the root and under `.config/`, plus the `.lefthook` and
`.lefthook-local` script directories. Lefthook merges a local file over the main one, so a
candidate adding `lefthook-local.yml` could otherwise replace a gate's command.

The hook rules a pass vouches for are lefthook's own merged view, not file names: verify runs
`<lefthook> dump --format json` in the verification worktree at `C` and again at `B`, and records a
pass only when the two are equal (`hooks_key`). That covers `extends` files and every config
format without parsing them. A config that uses `remotes` gets no pass (their content is fetched,
so the same dump can stand for different rules later), and neither does a dump that fails or is not
JSON. Every worktree that runs hooks (a verification slot, the landing worktree) refuses to run
while it holds any `lefthook-local*` or `.lefthook-local*` file or directory, tracked, untracked or
ignored: a plain filesystem test, because `git clean -fd` keeps ignored files and ignore rules hide
them from git.

Every push and every pre-push dry run (verify, `--dry-run`, the full land, and a land from a pass)
first installs the pre-push hook with the configured runner (`<lefthook> install pre-push`; the
configured bootstrap runs once if it cannot), then checks the hook exists, is executable and
invokes the runner, and that every `pushRequires` tool is on PATH; otherwise it refuses. The hook
is the only place the push guards run, so a clone without it must not push. Every `LEFTHOOK*`
variable (`LEFTHOOK=0`, `LEFTHOOK_CONFIG`, `LEFTHOOK_BIN`, an ambient `LEFTHOOK_EXCLUDE`) is
stripped from gates, hook runs and the push; only the engine sets `LEFTHOOK_EXCLUDE`.

The pass is two git refs, so it travels with git: `refs/land/verified/<ref_sha>` points at `C`
(keeping it reachable), and the record is a git note on `C` under `refs/notes/land-pass`:
`{ format, ref_sha, C, B, mode, message, config_key, gates: [{name, seconds, retried}], passed,
started, seconds, host, engine_version, hooks_key }` (`mode` and `message` are the `--mode` and `--message`
the ref was applied with). `config_key` hashes the git tree ids of those land files at `B`;
`engine_version` is the same key for the files that actually ran (equal to `config_key`, or verify
would have refused). `passed` names every gate with evidence on `C` plus every early check and
check. The note is written with a compare-and-swap on `refs/notes/land-pass`, so concurrent
verifies never lose each other's notes.

Every `cwd: source` step of a verify (preflight, early checks, checks, command gates, and the
`{source}` placeholder) runs from a clean, slot-owned checkout of `B` (`verify/<n>/source`), never
from the invoking checkout, so a local edit to a source-run script cannot change what a pass says
ran. That checkout has no ignored caches (`node_modules`), so source-run steps must not need them.

**Land** fetches and accepts the ref's pass only when the record is complete and: it asks for the
same `--mode` and `--message` verify applied (`C` is what that request makes); `B` is the current
tip `M`; `config_key` and `engine_version` both equal `M`'s key; `C` does not itself change the
land files; `passed` covers every gate `M`'s `land.config.json` makes applicable to `B..C` plus every
early check and check; and the invoking checkout's land files equal `M`'s (the rule verify applies). The fast path then runs entirely under `M`'s validated `land.config.json`
(`pushRequires`, the hook runner, the marker, the remote), never the invoking checkout's. It does
only this: take the lease (if it had to wait, fetch again and report **already landed** when
another lander got there first), check out `C` in the landing worktree, install the pre-push hook
itself with the configured runner (`<lefthook> install pre-push`, main's config; about 0.3 s), so
whatever hook was there is replaced by a known one (after one run of the configured bootstrap if
the runner cannot install; otherwise it refuses), check the installed hook exists, is executable
and invokes the runner, require every `pushRequires` tool on PATH, require `lefthook dump` here to equal the pass's `hooks_key` (else stale), push `C` with `--force-with-lease=refs/heads/<target>:<M>`
(a compare-and-swap) and the SHA-bound marker, then observe the outcome. When the push exited 0 on
its own (not signal-killed) and its `--porcelain` report is unambiguous (`Done`, exactly one line
for `C:refs/heads/<target>`, flagged pushed or `=` up to date), that remote report is the
observation and no fetch runs (`confirm: "porcelain"` in the receipt). Any other outcome (non-zero
exit, a signal, an unparsable or ambiguous report) fetches and checks
`git merge-base --is-ancestor C origin/<target>` (`confirm: "fetched"`). The push's `LEFTHOOK_EXCLUDE` is derived from
main's config and the validated evidence, never read from the record, and never names a guard:
`guard-main-push`, `push-scope-guard` and `versioning-release-check` always run on the real push.
The receipt line in `runs.jsonl` has `stage: "land"` and per-step seconds (lease, checkout,
guards, hooks, push, and confirm when it fetched).

- `C` already on the target: **already landed**, exit 0, nothing pushed (also when the push moved
  nothing because another lander pushed `C` first).
- No pass, an incomplete record, missing evidence, main moved since `B`, a land-config or engine
  change (in main, in the ref, or in this checkout), `C` missing, or the compare-and-swap rejected
  because main moved during the push: land prints `not verified on current main: <reason>; run
  just verify <ref>` and runs the full land below, unchanged. `--require-pass` refuses instead
  (exit 3).
- `--pass-from <remote>` fetches that remote's `refs/land/verified/*` and `refs/notes/land-pass`
  into `refs/land/pass-from/<remote>/verified/*` and `refs/notes/land-pass-from/<remote>` (never over
  local passes) and applies the same rules. Use it when the verify ran in another clone, for example
  `git remote add tower <tower clone>` then `just land <ref> -- --pass-from tower`. The landing
  clone still needs its own hooks and guard tools.

A deliberately forged record is outside what a local pass can prevent (ADR-0034).


A pass is bound to `B`: any push to the target after verify makes it stale, so verify close to
landing. Carrying evidence across main moves is a later slice (ADR-0034).

## What the full land does

1. Takes the per-machine lock (`~/.cache/harness-land/land.lock`, override with `HARNESS_LAND_LOCK`). By default it **refuses at once** and names the holder (PID, user, repo, ref, start time, minutes elapsed), so a blocked agent can do other work; `--wait <seconds>` (or `lockWaitMaxSeconds`) queues instead. The holder is recorded explicitly in the lock, never inferred from process shapes. A dead PID or a lock from before a reboot is released automatically.
2. Waits while the 1-minute load average is above `loadMax`, or while `quietCommand` (optional shell command, exit 0 means quiet) fails. Load average misjudges an I/O-starved box (a stalled disk shows little CPU load), which is what fails vitest's fixed worker timeouts; put a disk or paging check in `quietCommand`.
3. Resets a persistent landing worktree (`~/.cache/harness-land/<repo>/worktree`) to fresh `origin/<target>` and applies the ref. Ignored caches (`node_modules`, `target/`) are kept; the caller's `CARGO_TARGET_DIR` is never inherited.
4. Classifies the diff into scopes, prints the plan, and runs the applicable gates once, through `lefthook run pre-push --force --job ...`. Each job must appear as passed in lefthook's summary; exit 0 alone is not trusted.
5. Pushes with `HARNESS_LAND_GATE=<sha>` and `LEFTHOOK_EXCLUDE` naming only the jobs verified on that exact SHA (plus jobs inapplicable to the diff). Everything else, including `guard-main-push`, `push-scope-guard` and any job `land.config.json` does not list, still runs at push time and takes seconds.
6. Decides success by fetching and checking `git merge-base --is-ancestor <sha> origin/<target>`, not by the push's exit status. A signal-killed push reports the signal.
7. If the target moved meanwhile, re-fetches, re-applies and re-gates. Evidence belongs to one SHA: after a re-apply it resets, unless `inheritUnaffectedEvidence` is on and the diff between the two SHAs provably misses a gate's scopes.

When unsure it runs everything: an unmapped path, a path in `full`, an unreadable diff, or any change to `land.config.json`, `lefthook.yml`, `scripts/land.ts` or `scripts/lib/land/**`.

## `land.config.json` (consumer-owned)

`just update` never touches it. Keys: `remote`, `targetBranch`, `loadMax`, `quietCommand`, `loadPollSeconds`, `loadWaitMaxSeconds`, `lockWaitMaxSeconds`, `maxAttempts`, `verifySlots`, `pushRequires` (programs the push-time guards need; checked before every push and pre-push dry run), `markerEnv`, `lefthook`, `lefthookSelector` (`--job` default; `--commands` for lefthook 1.x), `inheritUnaffectedEvidence`, `metadataSafe` (globs a direct push to the target may change without the gate), `scopes` (name to globs), `full` (globs that force every gate), `bootstrap`, `preflight`, `earlyChecks`, `gates`, `checks`, `env`.

- A **gate** with no `run` is a lefthook pre-push job of that name. With `run` it is a shell command. `when` lists scope names; omit it for an unconditional gate.
- A **check** is a shell command that always runs after the gates. Placeholders: `{base}`, `{head}`, `{worktree}`, `{source}`. `cwd` is `worktree` (default) or `source` (the invoking checkout, which the applied ref cannot alter). Project-specific rules (for example "baseline.json must not differ from the base") live here, not in the engine.
- `preflight` checks run before the lock is taken. `earlyChecks` run once the plan is printed, before bootstrap and any gate (for example: is the evidence host reachable), with the same placeholders as `checks`.

Every ambient `LEFTHOOK*` variable (`LEFTHOOK`, `LEFTHOOK_CONFIG`, `LEFTHOOK_BIN`, `LEFTHOOK_EXCLUDE`, ...), `CARGO_TARGET_DIR`, the marker variable and git routing or config variables (`GIT_DIR`, `GIT_CONFIG_*`, ...) are stripped from the environment of every gate and the push, after `env` is merged. `harness.hookBaseRemote` and `harness.hookBaseRef` are injected so every diff-scoped hook uses the landing base.

A gate may list `requires` (programs on PATH): many hooks exit 0 when a tool is missing, which a landing must treat as failure. `ignoreDirty` lists tracked paths a gate may rewrite; any other change to the tree, or to HEAD, after gating aborts the land. Gates named `guard-main-push`, `push-scope-guard.sh` or `versioning-release-check` are rejected, so the guards can never be excluded from the push.

## Exit codes

`0` landed, already landed, verified (or dry run ok), `1` a gate or check failed, `2` push or fetch failed, `3` not verified on current main (`--require-pass`), `64` usage, `75` lock, verification slots or load wait exhausted.

Deletion-only landings are refused by `push-scope-guard`: lefthook treats a push whose changed paths no longer exist on disk as empty and skips every other pre-push job, and a land cannot know the jobs it was never configured to run. Land such a change together with a non-deleting edit.

