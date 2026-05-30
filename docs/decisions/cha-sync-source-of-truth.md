# Decision: cha-sync-source-of-truth — CHA is a STANDALONE canonical repo (no live lab upstream)

**Status:** active · **Date:** 2026-05-29 · **Next review:** 2026-11-29
**Revision pass 2 (re-scope):** 2026-05-29 — patched to align with the
operator re-scope `docs/specs/_arc-rescope-template-primary.md` (npm /
tarball language removed; canonical artifact is the polyglot monorepo
itself, distributed via fork / "Use this template" + tagged GitHub
Release as a discovery hook).
**Revision pass 3 (standalone re-scope):** 2026-05-29 — operator
decision `docs/specs/_option2-standalone-no-lab-upstream.md`. The lab
(`agentic-harness-lab`) is **R&D only**, NOT a live upstream. The
canonical-template repo (`syntropic137/create-harness-app`) is
**standalone** — extracted ONCE from the lab and then evolves on its
own. All lab-as-upstream machinery (`sync-from-lab.ts`, `.lab-sha`,
`lab-source.toml`, `.template-changes-since.json`, downstream-crawler
of lab-side provenance, lab→canonical strip-prefix maps) is DROPPED.
The only ongoing sync is **consumer self-update** (`just update` =
canonical → forked consumer, path-scoped to harness surfaces).

## Current pick

The canonical-template repo (`syntropic137/create-harness-app`) is a
**standalone** monorepo. It was extracted ONCE from the lab's
`templates/polyglot-monorepo/files/` subtree and then evolves
independently:

- All template-content changes — skill adaptations, slot picks, lint-rule
  bumps, etc. — are authored **directly in the canonical repo**, via
  Pull Request, gated by `.github/CODEOWNERS`.
- The lab continues to host experiments, retrospectives, and `docs/standard/decisions/*`
  research, but **none of that flows back into the canonical repo
  automatically.** Maintainers cherry-pick learnings by hand when they
  decide a finding is mature enough to ship.
- Consumers fork or "Use this template" from the canonical repo, then
  use `just update` (git remote `upstream` = the canonical repo) to
  pull subsequent harness-owned changes via a path-scoped checkout
  (`git checkout upstream/<ref> -- <harness-paths>`). Consumer code
  (`ws_apps/`, `ws_packages/`, etc.) is byte-for-byte untouched.

Concretely:

- **The lab** publishes ONE artifact to the canonical repo: the initial
  extraction commit. After that, the lab is a research workspace, not
  an upstream.
- **The canonical repo's `main`** is the source of truth that forks
  inherit on `just update`.
- **`scripts/update.ts`** (lives in the canonical repo, ships to every
  fork) is the only sync script: consumer-side, modes `--check` /
  `--write`, non-TTY = preview, never touches `ws_apps/` /
  `ws_packages/`.
- **Provenance** is git-native: `.harness-provenance.json` records
  `canonical_repo`, `canonical_commit`, `forked_at` (NO lab SHA). It's
  written once by `scripts/init.ts` at `just init` time and immutable
  after.

## Justification

The earlier `commit-templates-via-PR` design (revision pass 1) kept a
live lab→canonical sync that opened a PR per lab change. Two follow-on
observations forced re-scope:

1. **Lab cadence is experiment-driven, not release-driven.** Most lab
   commits are partial spikes, hypothesis drafts, and run-artifact churn
   that have no business landing in a forked consumer's harness. A live
   sync would either: (a) flood the canonical repo with PRs that are
   mostly noise, or (b) require a hand-tuned filter on the lab side that
   re-introduces the split-brain it was meant to prevent.
2. **Consumers don't want lab-velocity changes.** Consumers want the
   harness to be **stable** between intentional updates. A standalone
   canonical repo with manual cherry-picks gives the canonical
   maintainers a coherent batching surface (one release at a time, with
   notes) instead of a continuous trickle.

Picking standalone-canonical removes the entire lab-as-upstream
coupling: no `sync-from-lab.ts`, no `.lab-sha`, no `lab-source.toml`,
no downstream crawler of lab-side provenance, no fork-era `consumers.toml`
registry at the lab. The canonical repo and the lab become two
separate concerns that share a maintainer and an extraction event,
nothing more.

## Cross-platform / blast radius

- **Forked consumers** inherit `syntropic137/create-harness-app@<ref>`
  at fork time. Updates flow via `git remote add upstream` +
  `just update`. See `docs/specs/20260529_cha-sync-anti-rot.md` (S3)
  § Tier-C — the *only* tier that remains under this decision.
- **Canonical-repo maintainers** review PRs against the canonical repo
  directly. There is no automated "lab sync PR" surface.
- **Lab maintainers** keep editing `templates/polyglot-monorepo/files/*`
  for their own use (the lab still uses the polyglot harness for its
  experiments). When a lab change is mature enough to ship, a
  maintainer manually opens a PR against the canonical repo.
- **Discovery surface:** a tagged GitHub Release on the canonical repo
  (manual, via `gh release create v0.X.Y …`) drafts release notes
  pointing at the "Use this template" button. No artifacts attached;
  no `npm publish`, no tarball, no `pnpm dlx` flow. (Those mechanisms
  belong to the deferred scaffolder repo per
  `_arc-rescope-template-primary.md`.)

## Alternatives considered

### Alternative A — Live lab→canonical sync PR (REJECTED)

The revision-pass-1 design. A `scripts/sync-from-lab.ts` in the
canonical repo, driven by a weekly cron, opens `sync/lab-<short-sha>`
PRs that the canonical maintainers review and merge.

Rejected because of the cadence mismatch above. Even with manifest
windowing and consumer-relevance filters, the steady-state was
"canonical maintainers review a PR per cron tick that's mostly
noise." Manual cherry-pick on the canonical side is cleaner and gives
the canonical repo room to evolve at its own pace.

### Alternative B — Dynamic prepack copy from a submodule (REJECTED, original)

The pre-revision-1 design. CHA carried a `lib/agentic-harness-lab/`
submodule; `prepack` ran `sync-templates.mjs` to copy
`lib/agentic-harness-lab/templates/` into the package layout each
publish; `postpack` removed the staged copy.

Rejected at revision pass 1 because of the split-brain between
PR-reviewed commits and publish-time submodule copy. Now doubly moot
under standalone: there is no submodule to copy from, because the lab
isn't an upstream.

### Alternative C — Sync transformations at copy time (REJECTED, original)

`sync-from-lab.mjs` applies text transformations (lab-path rewrites,
skill-body merges) during the copy step. Rejected at revision pass 1
because it puts adaptation logic inside the sync script. Now moot: no
sync script.

### Alternative D — Snapshot release artifact (DEFERRED)

Lab CI publishes a `templates-snapshot-<sha>.tar.gz` per main push,
canonical maintainers run a manual import script that opens a PR.
Same problem as Alternative A (cadence mismatch) but without the
cron pressure. Deferred as a fallback if cherry-picks become too
labor-intensive to maintain.

## Maintenance signal

- **Lab → canonical drift** is now an explicit maintainer concern, not
  an automated invariant. The canonical repo's `harness.manifest.json`
  records the standard version it ships; the lab's
  `docs/standard/v0.X.md` records the version research is targeting.
  When the gap grows past one minor version, plan an extraction batch.
- **Forked consumer adoption** of `just update` is observable via:
  - `.harness-provenance.json#canonical_commit` ages (consumers pinned
    > 6 months stale should be nudged).
  - GitHub fork count + traffic insights on `syntropic137/create-harness-app`.

Re-evaluate the choice if any of:

- The lab → canonical extraction backlog grows past 3 unbatched lab
  cycles (signal: canonical's `harness.manifest.json` standard version
  trails the lab's by > 1 minor).
- The deferred scaffolder repo materializes — at that point an
  automated path-rewrite step may make sense again, but it lives in
  that repo, not here.

## Cross-spec impact

This ADR supersedes earlier wording in:

- **S1** (`docs/specs/20260529_cha-extraction.md`): the lab → canonical
  flow is a **one-time extraction**, not an ongoing sync. The lab's
  `templates/polyglot-monorepo/files/*` is copied verbatim into the
  standalone canonical repo's root at extraction time and then evolves
  in the canonical repo. Any subsequent lab change a maintainer wants
  to ship is cherry-picked manually via PR against the canonical repo.
- **S3** (`docs/specs/20260529_cha-sync-anti-rot.md`): **Tier-A and
  Tier-B are deleted.** There is no automated lab → canonical sync, no
  consumer → lab pull-back crawler, no `consumers.toml` registry at
  the lab, no `.lab-sha` anchor. Only **Tier-C** survives, renamed to
  the only sync there is: consumer self-update via `just update`.
- **S2** (`docs/specs/20260529_cha-canonical-readme.md`): consumer
  README leads with fork / "Use this template" + `just update`. No
  mention of lab provenance or `.lab-sha` verification — the
  fork's `.harness-provenance.json` (git-native fields) is the only
  provenance surface.
- **S4** (`docs/specs/20260529_cha-learnings-audit.md`): `cha_action =
  adapt` rows are now understood as **one-time** edits the lab
  maintainer applies when the lab finding is cherry-picked into the
  canonical repo. No "next sync" to worry about.

## Open issues / when to re-probe

- Re-probe the choice at next review (2026-11-29) against Alternative D
  if the manual cherry-pick cadence becomes a friction point.
- If CODEOWNERS becomes a friction point on the canonical repo itself
  (long-open PRs > 2 weeks), consider auto-merge for trusted-maintainer
  PRs that touch only the `harness.manifest.json` version field.
- If the deferred scaffolder repo materializes, its `npm publish`-shaped
  distribution lives there, not here. This ADR continues to govern the
  canonical-template repo only.

## Sources

- Operator standalone re-scope (`docs/specs/_option2-standalone-no-lab-upstream.md`,
  2026-05-29).
- Operator re-scope directive (`docs/specs/_arc-rescope-template-primary.md`,
  2026-05-29) — established canonical artifact is the polyglot
  monorepo itself.
- Operator finalize directive (`~/cha-finalize-directive.md`, 2026-05-29) —
  the original commit-templates-via-PR lock, now superseded.
- Agent Mail thread 34 — Gemini cross-spec findings F3, F4, F5 (the
  original split-brain that drove revision pass 1).
- `docs/specs/20260529_cha-sync-anti-rot.md` (S3) — sync contract.
- `docs/specs/20260529_cha-extraction.md` (S1) — extraction playbook.
- `docs/specs/20260529_cha-canonical-readme.md` (S2) — consumer surface.
- `docs/specs/20260529_cha-learnings-audit.md` (S4) — graduation index.
- `docs/standard/polyglot-monorepo-structure.md` — research deliverable
  underpinning the monorepo layout.
