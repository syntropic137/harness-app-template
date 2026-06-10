# LP_RECOMMENDATION (Reviewer Bravo)

Should the harness adopt `software-leverage-points` (SLP) as a first-class quality-gate slot? Reviewer Bravo recommendation, in slot-composition terms.

## TL;DR

**Recommend Option D below: reference (do not vendor) the SLP skill pack from `github.com/syntropic137/software-leverage-points` using the same upstream-clone pattern the template already uses for `harness-engineering`, plus an optional advisory `just lp-review` recipe. Do NOT make SLP the twelfth harness slot.**

The reasoning is short: every existing harness slot is a **mechanical contract** (hooks pass / fail, validator returns exit code, sensor crosses threshold). SLP findings are judgment calls (the agent that produced this very document downgraded five of its own CRITICALs after sanity-check). A judgment-heavy review fits poorly inside the slot contract model, but fits naturally into the skill-pack model the template already uses for principle skills.

## Slot-composition framing

The harness's 11 slots split cleanly along two axes:

| Axis | Examples | Failure mode |
|---|---|---|
| Mechanical (binary verdict) | hooks, secret-scanner, doc-validator, versioning, task-runner | Exit code |
| Mechanical (numeric verdict) | sensors, telemetry-sdk, observability-stack | Threshold crossed |
| Configuration (no verdict) | stack-manager, inspector, agent-plugins | Wrong shape |

SLP review is none of these. An SLP finding looks like *"this `unwrap_or_default()` masks a failure mode; here is a one-line fix"*, which is the shape of a code review comment. A code review comment is not a slot; it is an artifact that informs slot owners.

The harness already has a slot adjacent to this: **sensors** is the closest fit. Sensors emit Martin metrics (Ca / Ce / I / A / D) and a license-scan count. Those are mechanical proxies for some SLP lenses (architecture, dependencies). Wiring SLP findings into sensors as a count-per-lens is one way to make it mechanical, but the surface that produces the count is still a judgment-heavy reviewer (human or LLM).

## Four concrete options

### Option A: Vendor SLP skills into `.claude/skills/`

- 18 skill bodies (one per lens) committed under `.claude/skills/software-leverage-points/<lens>/`.
- Forks get the lens skills offline immediately.
- Cost: ~30 to 50 KB committed; future upstream drift is silent unless a doc-validator job watches the upstream sha.
- This is the heaviest local footprint and the model the template explicitly rejected for harness-engineering principle skills.

### Option B: Advisory CI gate

- Add a `lp-review` job in `.github/workflows/test.yml` that runs `claude -p` against the diff with an SLP-orchestrator prompt and posts findings as a non-blocking PR comment.
- Mechanical surface; no merge block.
- Cost: per-PR `claude -p` token spend on every PR (likely 1 to 5 USD per PR with the empirically-validated flag set in `AGENTS.md`).
- Risk: brittle (LLM output format drift), and the brief itself documents that 5 of 6 sub-agent CRITICALs in this review were false positives requiring human triage.

### Option C: First-class twelfth harness slot

- Add `software-leverage-points` to `harness.manifest.json` with a contract, swappable plugin, decisionAt ADR-0019.
- Forks could pick "SLP-orchestrator-claude" vs "SLP-orchestrator-gpt5" vs "human-only" implementations.
- Cost: contract design (what does the slot interface accept and return?), versioning-slot wiring, ADR write-up.
- The fundamental problem is the slot contract: a slot needs a mechanical interface. SLP's natural interface is "a human or LLM reads the diff and writes findings". That is hard to formalize as a slot CLI command without devolving into option B.

### Option D (RECOMMENDED): Reference-only skill pack + advisory `just lp-review` recipe

This is the model the template already uses for `harness-engineering` principle skills, documented in `AGENTS.md` line 50 to 65. The SLP project becomes a sibling upstream:

```sh
git clone https://github.com/syntropic137/software-leverage-points.git ~/.claude/plugins/software-leverage-points
claude plugin install ~/.claude/plugins/software-leverage-points --scope project
```

Plus a thin local recipe:

```sh
just lp-review          # invokes a `claude -p` SLP orchestrator over the diff, advisory only
just lp-review --pr 42  # same, scoped to a PR branch
just lp-review --offline # falls back to a `bun run` driver that just produces the lens checklist
```

The recipe does NOT block merges. The lefthook hook does NOT call it. CI does NOT call it. It is an on-demand review surface, analogous to the `/code-review` skill the template already references.

Why this fits:
- **No new slot contract to design.** SLP review is not a slot.
- **No vendored drift.** Upstream stays authoritative; the existing `harness-engineering` pattern is the established precedent.
- **Forks can adopt incrementally.** A fork that wants SLP can `git clone` the upstream + run the recipe. A fork that does not, ignores both.
- **Composability with existing slots is preserved.** SLP findings that the operator chooses to enforce can land as: a new doc-validator rule (e.g. "ADRs must declare supersedes/supersededBy in frontmatter"), a new sensors gate (e.g. "complexity per file <= 30"), or a tightened lefthook gate. The harness model absorbs the LP recommendations through slots that already exist.

## What to do with THIS review's findings

Independent of the slot question: the 82 findings in `LP_FINDINGS--bravo.md` (plus whatever Alpha produces) should be triaged by the orchestrator into beads. The "bead-filing list" section at the bottom of the findings file proposes ten beads covering 25 findings; the rest are individual quality cleanups suitable for inline PR fixes.

The five findings that most pay back the SLP review's cost (in the sense that fixing them improves the template's behavior under fork-amplification):

1. CI lockfile mode (`CD-01` / `SEC-01`).
2. Slot version semver normalization (`VER-01`).
3. ADR test-fixture relocation (`VER-03`).
4. Telemetry + stack coverage debt (`TST-01` / `TST-02` / `TST-03` / `TST-04`).
5. Structured error + logging contract for slot CLIs (`ERR-01..05` + `LOG-01..03`).

These are the five the operator should consider before the next standard-version bump.

## Caveats on this recommendation

- Reviewer Bravo could not coordinate with Reviewer Alpha. If Alpha argues the opposite (e.g., that SLP belongs as a sensors-style soft gate), the operator should weigh both. Slot-composition arguments are genuinely two-sided.
- This recommendation assumes the SLP upstream repository is healthy and its skill bodies are at least as authoritative as the `harness-engineering` plugin. If SLP turns out to be early-stage or actively churning, Option A (vendoring) becomes more attractive as a stability shim.
- The recommendation does not preclude a future twelfth slot. If forks accumulate enough SLP usage that a mechanical contract becomes obvious, promoting it then costs less than designing the contract speculatively now.
