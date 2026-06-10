---
name: "Merge gating — main is protected with required status checks, no required approvals"
description: "Enable GitHub branch protection on `main` so that auto-merge MUST wait for every PR-time CI check (workspace qa × 2, check, scripts, rust-coverage, python-coverage, documentation, fitness, fork-check) before the merge can land. Do NOT require human PR approvals — the autonomous loop has no reviewer to gate against. Codify the required-check set in `scripts/protect-main.ts` and expose it as the idempotent `just protect-main` recipe so a fresh fork can re-apply the policy."
status: accepted
---

<!--
ADR-0022 closes the post-mortem question opened by the merge-time green-but-
red-on-main incidents around PRs #20 and #22: the branch protection page
returned 404 for `main`, which meant auto-merge merged with zero required
status checks — green PR + red main was structurally allowed. This ADR
records the policy that closes that gap and the script + recipe that make
it reproducible for forks.
-->

# ADR-0022: Merge gating — protect main with required CI checks, no required approvals

**Date:** 2026-06-10
**Category:** Policy (cross-cutting; affects every PR and every fork)
**Supersedes:** none (refines [ADR-0011](./ADR-0011-versioning.md) by giving the versioning workflow an enforcing gate, and refines [ADR-0019](./ADR-0019-closed-loop-architectural-quality.md) / [ADR-0020](./ADR-0020-architectural-fitness-ratchet.md) by guaranteeing the fitness ratchet actually blocks merges instead of merely emitting a check)
**Next review:** 2026-12-10

## Context

PRs #20 and #22 both showed green at merge time and turned `main` red within
the next push. The post-mortem walk-back found the structural cause: the
`main` branch on `syntropic137/harness-app-template` had no branch
protection at all — `gh api repos/.../branches/main/protection` returned a
404 "Branch not protected". With no protection, GitHub's auto-merge feature
treats "no required checks" as "every check is satisfied", so a PR could
flip auto-merge on, ignore the still-running `workspace qa`, `fork-check`,
and `fitness` jobs, and merge the moment the merge button became
available. Whatever job finished failing after the merge then became a red
push on `main`.

The harness ships ten check contexts that exist precisely to catch this
class of regression. They run on every PR (per `.github/workflows/test.yml`
and `versioning.yml`) but the harness was treating their failure as
information rather than as a gate. The question this ADR closes:

> What is the minimum policy that makes a merge into `main` provably
> impossible while any PR-time check is still failing, without
> introducing a human-review deadlock for the autonomous loop?

## Decision

Three related decisions, all accepted:

1. **Enable GitHub branch protection on `main` with a `required_status_checks`
   block listing every PR-time check context that the harness already runs.**
   The canonical required-context list is held in
   [`scripts/protect-main.ts`](../../scripts/protect-main.ts) as the
   exported constant `REQUIRED_PR_CONTEXTS`:

   - `check` (versioning workflow — PR title + release-check)
   - `workspace qa (ubuntu-latest)` (test workflow matrix leg)
   - `workspace qa (macos-latest)` (test workflow matrix leg)
   - `scripts` (test workflow — `pnpm test:coverage`, 100% TS coverage)
   - `rust-coverage` (test workflow — `just cov-rust`, 100% lines/functions)
   - `python-coverage` (test workflow — `just cov-py`, 100% coverage)
   - `documentation` (test workflow — APSS APS-V1-0003 doc validator)
   - `fitness` (test workflow — APSS fitness + perf gate + ratchet)
   - `fork-check` (test workflow — fresh-fork E2E onboarding)

   `release` is intentionally excluded: it runs only on `push` to `main`
   and on `workflow_dispatch`, so it shows as SKIPPED on every PR. Requiring
   a never-reported context would deadlock auto-merge.

   The protection block also sets `strict: true`, so a PR whose base is
   stale relative to `main` re-runs the checks before the merge button
   becomes available. That closes the merge-skew window where a fix on
   `main` invalidates the PR's prior green run.

2. **Do NOT require human PR approvals.** The protection block sets
   `required_pull_request_reviews: null`. The autonomous swarm loop has no
   reviewer who can dismiss-stale or approve at scale; requiring approvals
   would deadlock auto-merge and turn the loop into a manual-merge queue.
   The required-status-checks gate is the merge-gate; approvals would be
   redundant policy theatre with no signal.

3. **Codify the policy as a re-runnable `just protect-main` recipe so a fork
   can re-apply it.** [`scripts/protect-main.ts`](../../scripts/protect-main.ts)
   exports `REQUIRED_PR_CONTEXTS`, builds the protection body, and
   `PUT`s it to `repos/<owner>/<repo>/branches/main/protection` via
   `gh api`. The PUT is a full-document replace, so re-running overwrites
   operator drift rather than silently inheriting a stale prior body. The
   `just protect-main` recipe is the operator-facing surface; forks call
   it once after enabling Actions and the policy is live.

The other branch-protection knobs (`enforce_admins: false`,
`allow_force_pushes: false`, `allow_deletions: false`,
`required_linear_history: false`) are chosen to keep the operator's
hotfix path open while preserving `main`'s history.

## Consequences

- **Green PR cannot land on a red `main` anymore.** Auto-merge now waits
  for every check in `REQUIRED_PR_CONTEXTS` to report `success` before
  the merge button is reachable. The class of incident that produced PRs
  #20 and #22 — checks-still-running auto-merge into a broken `main` —
  is mechanically impossible while this policy is applied.
- **Auto-merge keeps working.** No required approvals means the
  autonomous loop's "open PR → enable auto-merge → wait → merge" shape
  still terminates without a human in the loop. The wait is bounded by
  the slowest CI check, not by reviewer availability.
- **Adding a new CI context requires updating `REQUIRED_PR_CONTEXTS` and
  re-running `just protect-main`.** A new check that exists on the PR
  but is not in the required set provides no gating signal. The
  expected change shape: add the check to `.github/workflows/`, add the
  context name to `REQUIRED_PR_CONTEXTS`, re-run `just protect-main`.
- **Renaming a CI context breaks the gate.** GitHub matches by context
  string. A workflow rename without an `REQUIRED_PR_CONTEXTS` update
  leaves the named context permanently `pending` and auto-merge stalls.
  Catching this is the `fork-check` job's responsibility once the
  required-set verification is added there (see "When to re-evaluate").
- **Forks inherit the policy as code, not as a manual click-through.**
  `just protect-main` is reproducible across forks; the only fork-side
  prerequisite is an authenticated `gh` and write permission on the
  fork's `main`. Forks that swap an entire workflow (e.g. replace
  `fork-check` with their own E2E) update `REQUIRED_PR_CONTEXTS` to
  match the new context names and re-run the recipe.

## Details

### Why these specific contexts

The list is the intersection of "runs on every `pull_request`" and "must
be green for the PR to be safe to merge into `main`". The membership was
read off `gh pr view <n> --json statusCheckRollup` for PRs #22 and #23
so that the names are verbatim what GitHub reports — no inferred names,
no guesses. `release` is excluded for the SKIPPED reason described above;
all other PR-time contexts are required.

### Why `strict: true`

`strict: true` is the GitHub branch-protection flag that forces a PR to
be up to date with `main` before the merge button is reachable.
Without it, the green-on-stale-base failure mode (`main` is at SHA-Y,
PR was last checked at SHA-X, the diff against SHA-Y would fail) is
allowed. With the gate, the PR re-runs against the current `main` head
before merging.

### Why `enforce_admins: false`

Locking out admins is a footgun for a small repo: it has no positive
effect on the loop and removes the operator's only hotfix path when CI
itself is the regression. The chosen posture trusts the operator to use
`main` direct-push only as the last resort it should always be, while
the loop uses PRs exclusively.

### Why a script + just recipe rather than a one-shot `gh` call

Two reasons. First, the PUT body is long and the context list will grow
as new workflows are added; keeping it as a typed constant in
`scripts/protect-main.ts` is auditable and unit-testable. Second, a
fork-readiness probe needs to be able to re-apply the policy
non-interactively. The `just protect-main` recipe is the discoverable
surface that satisfies both needs.

### Alternatives considered

- *Require human PR approvals.* Rejected. The autonomous loop has no
  reviewer to gate against; setting `required_approving_review_count: 1`
  would deadlock auto-merge into "wait forever for an approver". The
  trigger that would make this the right choice later is "a human
  reviewer joins the loop"; until then, the status-check gate is the
  single source of truth.
- *Use a single composite "all-checks-pass" gate via a workflow that
  fans out and reports one rolled-up context.* Rejected on the
  marginal-cost axis. The harness already runs each gate as a separate
  workflow job for legibility; adding a roll-up workflow would
  duplicate the reporting surface and introduce a SPOF without
  changing the policy outcome. The trigger that would justify it
  later is "the required-context list grows past ~15 names and the
  re-apply step becomes a chore".
- *Skip protection on `main` and rely on the fitness ratchet alone.*
  Rejected. The ratchet emits a check result, but without
  branch-protection no check result has merge-gating force —
  precisely the structural cause of the PR #20 / #22 incidents.
- *Configure the policy via the GitHub web UI rather than as code.*
  Rejected on the fork-readiness axis. A clicked-through policy is
  invisible to fresh forks and silently drifts when operators change.

### Backlinks

When the wiring lane lands additional gates, the references below will
appear with the exact identifier `ADR-0022-merge-gating`:

- [`scripts/protect-main.ts`](../../scripts/protect-main.ts) — the
  `REQUIRED_PR_CONTEXTS` constant + idempotent applier.
- `scripts/tests/protect-main.test.ts` — coverage of body shape and
  error paths.
- `justfile` `protect-main` recipe — operator-facing entrypoint.
- `.github/workflows/test.yml` and `versioning.yml` — the workflows
  that emit the gated check contexts.

### Sources

- [GitHub REST API — Update branch protection (PUT
  `/repos/{owner}/{repo}/branches/{branch}/protection`)](https://docs.github.com/en/rest/branches/branch-protection#update-branch-protection).
- [ADR-0011](./ADR-0011-versioning.md) — versioning workflow + `check`
  context that the gate now hard-enforces.
- [ADR-0019](./ADR-0019-closed-loop-architectural-quality.md) — closed-
  loop fitness signal that needed an enforcing gate to be load-bearing.
- [ADR-0020](./ADR-0020-architectural-fitness-ratchet.md) — fitness
  ratchet whose `fitness` check is now a required merge-gate.
- Post-mortem of PRs #20 and #22 (green PR, red main): the audit
  surface that motivated this ADR.

### When to re-evaluate

- A new CI check is added and is not in `REQUIRED_PR_CONTEXTS` — that
  check provides no gating signal and the policy needs to be
  re-applied.
- A CI check is renamed — the prior name becomes permanently `pending`
  on every PR and auto-merge stalls; the policy needs to be re-applied
  with the new name.
- A reviewer joins the loop — the
  `required_pull_request_reviews: null` posture should be re-evaluated.
- GitHub deprecates the `contexts` field on `required_status_checks` in
  favor of the typed `checks` array — `buildProtectionBody` should
  migrate. The shape change is backwards-compatible today; the
  re-evaluation trigger is the deprecation notice on the REST API
  reference.
