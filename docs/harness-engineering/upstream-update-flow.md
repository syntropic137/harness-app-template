# Upstream Update Flow

This document is the template's Tier 1 / Tier 2 / Tier 3 mechanism for
keeping the canonical harness template and downstream consumer forks coherent.

The original lab version closed the drift problem called out by harness
engineering research: once teams instantiate templates, they start drifting
from upstream improvements. In this repo, the canonical upstream is
`syntropic137/harness-app-template`. The lab remains the R&D reference source,
not a live sync target for consumers.

## Provenance

Every initialized consumer fork has `.harness-provenance.json` at its root.
`scripts/init.ts` writes it during `just init`, and `just doctor` validates that
it is still present and internally consistent with `harness.manifest.json`.

```json
{
  "schemaVersion": "1.0",
  "mode": "fresh",
  "template": "polyglot-monorepo",
  "templateVersion": "0.4.0",
  "standardVersion": "0.2",
  "canonical_repo": "https://github.com/syntropic137/harness-app-template",
  "canonical_commit": "436a6155a7d8e11eac46a94270acfd77533d799a",
  "forked_at": "2026-05-30T18:33:00.000Z"
}
```

The provenance block answers two questions:

- What canonical template commit did this consumer start from?
- Which downstream changes touched harness-shaped paths and might be worth
  promoting back to the canonical template?

Treat this file as an audit anchor. Do not hand-edit it to hide drift. If a
consumer intentionally pulls template changes, record that through the update
tooling once it exists rather than rewriting history.

## Tier 1: Manual, Ship Now

When a consumer fork finds a generally useful harness improvement, cherry-pick
it into the canonical template and prefix the commit body with its source:

```text
harness-engineering: from <downstream-repo>@<sha>
<original commit message>

<why this is generally useful>
```

Promote changes like:

- New lefthook or doctor checks that caught real defects.
- New skills, commands, or agent context under `.claude/`.
- Coverage or architecture-quality thresholds that can be tightened.
- New sensor adapters, validator rules, or slot wrappers under `harness/`.
- New experiments or retrospectives that generalize beyond one application.

Do not promote changes like:

- Product or business logic.
- Tool picks dictated by one consumer's legacy constraint.
- Secrets, environment-specific paths, or local operator preferences.

Tier 1 is intentionally manual. A maintainer reads the diff, decides whether it
belongs in the template, and preserves the source reference.

## Tier 2: Semi-Automated Digest

Tier 2 is a scheduled crawler proposal for when there are enough opted-in
consumers to justify automation.

The crawler would:

1. Read `consumers.toml`, the opt-in registry of downstream repos.
2. Clone each consumer and read `.harness-provenance.json`.
3. Compute commits after `forked_at`, excluding the scaffold commit by
   `canonical_commit` where possible.
4. Filter to harness-shaped paths:
   - `.claude/`
   - `docs/adrs/`
   - `docs/harness-engineering/`
   - `experiments/`
   - `harness/`
   - `lefthook.yml`
   - `biome.json` / `biome.jsonc`
   - `tsconfig.base.json`
   - `Cargo.toml`
   - `pyproject.toml`
5. Emit a weekly issue or digest: "consumer X changed these N harness-shaped
   files since it forked."
6. Let a maintainer triage each candidate as promote, discard, or proposal.

The lab's note about `git log --after=<time>` still applies: `--after` is
inclusive at second granularity on common Git versions, so time-only filtering
can re-emit the scaffold commit. Prefer SHA-based exclusion when
`canonical_commit` is known.

## Tier 3: PR Generation With LLM-as-Judge

Tier 3 is future work. It should not exist until Tier 2 has produced enough
digests to measure its signal.

After at least six months of digests, evaluate an LLM judge only if the tracked
promotion rate is high enough to justify automation. The judge would classify
candidate commits as:

- general improvement
- project-specific
- regression
- already covered upstream

For high-confidence general improvements, it can draft an experiment proposal
or PR. A maintainer still reviews and merges. The LLM drafts; it does not own
the template.

## consumers.toml

`consumers.toml` is the opt-in registry Tier 2 would read. It does not need to
exist until multiple consumers want scheduled drift review.

```toml
[[consumer]]
repo = "github.com/example/my-real-project"
scaffolded_at = "2026-06-01T10:00:00Z"
template_version = "0.4.0"
contact = "@owner"
```

## Failure Modes

Noise: the crawler reports every trivial change.
Mitigation: path filters, commit-size heuristics, and maintainer triage.

Intentional divergence: a consumer made a local-only choice.
Mitigation: consumers can mark commits or PRs as project-specific so the
crawler skips them.

Provenance staleness: a consumer pulls template changes but does not update its
provenance.
Mitigation: future update tooling should append an `upstream_pulls` entry
instead of overwriting the original fork anchor.

Over-automation: Tier 3 opens noisy PRs and burns maintainer time.
Mitigation: require measured Tier 2 signal before enabling LLM drafting.

## Operating Rule

Preserve lineage. When moving a lesson between the lab, this template, and a
consumer fork, keep the source repo and commit visible in the receiving commit
or proposal. The path can be manual today and automated later, but the audit
trail is not optional.
