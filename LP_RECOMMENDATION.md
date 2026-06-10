# LP_RECOMMENDATION: should the harness adopt software-leverage-points?

> Companion to [`LP_FINDINGS.md`](./LP_FINDINGS.md). The brief asks
> whether the harness should treat the software-leverage-points (SLP)
> review skills (`https://github.com/syntropic137/software-leverage-points`)
> as a first-class input the harness gives to every fork, framed against
> the slot-composition model. Below: framing, options, recommendation,
> and an implementation sketch.

## Framing: SLP inside the slot-composition model

The harness already separates **contracts** (what a slot must do) from
**plugins** (the specific tool filling the contract). Read the harness
v0.2 Standard and you see the same separation at every layer
(`docs/standard/v0.2.md:35-43`).

SLP is not a single tool. It is a set of seventeen review lenses
(architecture, configuration, continuous-delivery, dependencies,
developer-experience, documentation, dry, environments,
error-handling, logging, principles-and-patterns, purpose-and-scope,
security, software-complexity, testing, types, versioning). Each lens
is a body of guidance an agent invokes when looking at a diff or a
codebase. Mechanically: the SLP skill bodies are read-only context for
the agent's reasoning loop, paired with the agent's own ability to
read code and form findings.

Two mappings into the harness fit cleanly:

1. **Skill set** — SLP becomes a vendor-shipped set of `.claude/skills/`
   (and the matching agent-vendor parallels). Picked up by the
   skill-routing layer, invoked when a relevant task arrives.
2. **Quality-gate slot** — SLP becomes the basis for a new
   `quality-review` slot whose plugin is "the SLP review skills + an
   orchestrator," with contract "given a diff, produce structured
   findings keyed by lens." The slot composes with the existing
   `sensors`, `doc-validator`, and `secret-scanner` slots as one more
   advisory or hard gate.

Both interpretations are consistent with the slot model. They differ
in the strength of the obligation the harness imposes on forks, and in
who pays the cost when the gate runs.

## The four real options

### Option A: do nothing

Keep SLP outside the harness. Forks that want it run the skills
themselves. The harness today already references upstream
harness-engineering skills in `AGENTS.md:42-58` exactly this way. No
new code, no new gate. The harness stays small.

Pros: zero implementation cost; no new mandatory dependency; forks
that do not care pay nothing.

Cons: the harness loses a lever to encode review quality into the
template's "given to every fork" surface. SLP becomes one of many
optional skill sets a user might or might not install. The harness's
own findings (e.g., the 30 issues in `LP_FINDINGS.md`) demonstrate
that "advisory but not wired" controls reliably drift out of
existence (see `sec-01`, `sec-03`, `sec-05` in the findings: every
"standard" control that is not wired stays unenforced).

### Option B: ship SLP as a skill set forks get for free

Vendor the SLP skill bodies (or pointers to them) into
`.claude/skills/`, matched by per-vendor symlinks per the existing
"Pragmatic vendor primacy" principle. No new gate; no manifest change.
The harness ships a richer agent-context surface, and forks pick up
the lenses with zero added obligation.

Pros: low implementation cost; preserves "Plug-and-play" (forks can
remove skills they do not want); aligned with the
"upstream-by-reference" pattern AGENTS.md already documents for
harness-engineering principle skills.

Cons: skills are discretionary; the harness has no mechanism to ensure
the review actually runs. The lens findings in `LP_FINDINGS.md` would
not have been produced without a brief explicitly asking for the
review.

### Option C: add a `quality-review` slot, advisory

Define a twelfth slot (or extend `sensors` / `doc-validator` if the
contract fits) whose contract is "run a structured review against a
diff and emit findings keyed by lens, with severity." Plugin pick: an
orchestrator that drives the SLP skills against the diff. Wire it as
an **advisory** CI step plus an opt-in `just review-slp` recipe.
Findings land as JSON next to the existing UBS findings JSONL.

Pros: lifts the SLP review from optional to "structured artifact every
fork gets." Same shape as the existing sensors gate, which is the
harness's closest precedent for an advisory-plus-baseline quality
slot. Composes with the slot model without surprising forks.

Cons: real implementation cost (orchestrator, JSON contract, CI job,
ADR, manifest entry). Adds another moving part to the harness's own
fitness story. Advisory gates trend toward decorative unless the
output is consumed by a downstream gate or human reviewer.

### Option D: hard-gate `quality-review` in CI

Same as C, but escalate the gate to PR-blocking when CRITICAL findings
appear. Pair it with a baseline file (mirror of `sensors/baseline.json`)
so existing CRITICAL/HIGH findings are accepted at adoption time and
only new ones block.

Pros: highest leverage; matches the §Controls 8 principle that "fast
hooks get respected and become a real control" applied at the review
layer instead of the lint layer. The baseline pattern is well-trodden
in this harness, so adoption friction is low.

Cons: requires CRITICAL/HIGH calls to be reproducible and low-noise.
SLP findings are LLM-judged, so reproducibility is weaker than for
deterministic tools (sensors, doc-validator). A flaky gate is worse
than no gate.

## Recommendation: B now, C next, D only after a baseline experiment

The harness should adopt SLP in two staged steps:

**Step 1 (do now): Option B** — vendor the SLP skill set into
`.claude/skills/` with the same upstream-pointer pattern that
`AGENTS.md:42-58` uses for harness-engineering. Cost is hours, not
days; benefit is that every fresh fork has the lenses available the
first time an agent opens a diff. This is the lowest-regret move and
is already idiomatic in the harness today.

**Step 2 (next): Option C** — once Step 1 has shipped to a few forks
and the lenses are being invoked in practice, add a `quality-review`
slot with a baseline-driven advisory gate. Use the
`harness/sensors/baseline.json` pattern: emit findings as JSON, store
a baseline, fail only on regression. Wire it into pre-push (soft) and
CI (advisory) first; let the false-positive rate settle.

**Step 3 (only if Step 2 stabilises): Option D** — promote the gate to
PR-blocking on CRITICAL findings once an experiment under
`experiments/<date>--slp-gate-reproducibility/` shows the
finding-list is stable across two consecutive runs against the same
diff. Until that experiment lands a `go` verdict, the harness should
not stake fork-blocking authority on an LLM judgment that may oscillate.

This staging matches the harness's own evidence-driven principle
(`docs/standard/v0.2.md:41`): plugins earn their slot via a go-verdict
experiment, not by adoption-by-decree.

### Why not Option D first

Two reasons specific to this harness:

1. The findings in `LP_FINDINGS.md` include four CRITICALs that block
   even routine first-commit flow (`cd-01`, `cfg-01`, `sec-01`,
   `sec-02`). Promoting an advisory review gate above those open
   issues misorders the work: fix the existing gate gaps first, then
   add a new one.
2. SLP findings are higher-variance than the existing harness
   signals. The sensors gate compares numeric instability/distance;
   the doc-validator checks deterministic file shape; UBS detects a
   fixed pattern set. SLP findings are produced by a judgment
   process, and the variance is highest exactly where forks most need
   stability (architecture-level findings).

### Why not Option A

Doing nothing leaves SLP in the same "advertised but not wired"
category as `pnpm audit`, the `gitleaks detect` CI job, and the
`.gitleaksignore` rule (see `LP_FINDINGS.md` `sec-01`, `sec-03`,
`sec-05`). The harness already has a credibility gap between standard
and reality; adding one more advertised-but-optional skill set
deepens it.

## Implementation sketch for the recommended path

### Step 1: vendor SLP skills (Option B)

1. Add a `.claude/skills/software-leverage-points/` directory (or one
   subdirectory per lens, matching how
   `.claude/skills/running-experiments/` is structured today).
2. Add a `## Software-leverage-points lenses` section to `AGENTS.md`
   following the same upstream-by-reference pattern as the existing
   `harness-engineering` block (`AGENTS.md:42-58`).
3. Add a `just review-slp` recipe that prints the lens menu and
   one-line guidance per lens. No CI wiring yet.
4. Cost estimate: under a day.

### Step 2: advisory `quality-review` slot (Option C)

1. ADR-0019 (next free number) documenting the slot contract: input
   = diff against base ref; output = JSON findings list keyed by
   `{lens, severity, file, line, message, recommendation}`.
2. Plugin: `harness/quality-review/bin/quality-review` shelling out to
   the orchestrator. Reference the existing `harness/sensors/bin/sensors`
   shape so forks can read the two side by side.
3. Baseline file at `harness/quality-review/baseline.json`. Gate
   semantics mirror `harness/sensors/gate.mjs`: advisory until a
   baseline lands, then regression-only.
4. Pre-push hook (soft-skip when the orchestrator is missing,
   matching the cov-rust pattern at `lefthook.yml:127-138`).
5. CI job in `.github/workflows/test.yml` running the gate
   advisory-only.
6. Cost estimate: an experiment plus three to five days of wiring.

### Step 3: PR-blocking on CRITICAL (Option D, conditional)

Only enter Step 3 after the reproducibility experiment posts a `go`
verdict. The gate stays advisory until then. The promotion is a
one-line change in the GitHub Actions step that escalates exit
status, plus a CODEOWNERS or branch-protection toggle.

## How this composes with the existing slot family

The harness today ships three quality-related slots:

- `sensors` — architecture fitness signals + APSS topology gate.
- `doc-validator` — Markdown cross-reference + ADR shape + APSS doc gate.
- `secret-scanner` — Gitleaks credential gate.

A `quality-review` slot fits cleanly as the fourth, with this division
of labor:

| Slot | Signal type | Reproducibility | Speed | Where it gates |
|---|---|---|---|---|
| sensors | numeric architectural | deterministic | seconds | pre-push, CI |
| doc-validator | deterministic shape | deterministic | sub-second | pre-commit, CI |
| secret-scanner | regex pattern | deterministic | sub-second | pre-commit, CI |
| quality-review (new) | judged review | probabilistic | minutes | advisory CI, opt-in local |

The slot composition story remains: each slot covers a different
signal class, contracts are stable, plugins swap. SLP is a natural
fit; the harness should welcome it, but it should arrive as the
fourth deterministic-shoulder-to-judgment-head member of the family,
not the centerpiece.

## A note on prerequisites

Steps 1 and 2 should not start until the four CRITICAL findings in
`LP_FINDINGS.md` are closed. The first improvement the harness owes
its forks is making the existing gates actually work as documented;
adding a fifth gate over four broken ones is the wrong order.

In particular, `cd-01` (hard-failing doc-validator at HEAD) and
`cfg-01` (hard-failing APSS hook on a fresh clone) need to land
before any new advisory layer arrives, because both currently train
forks to bypass hooks. A new gate added to a tree where every fork
already uses `--no-verify` is decorative by construction.
