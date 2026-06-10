# Agent context ({{PROJECT_NAME}})

> This file is the canonical agent context for this project. `CLAUDE.md`,
> `GEMINI.md`, `.codex`, and `.gemini` are committed symlinks that point at
> this file, so every vendor agent reads the same body on a fresh clone.
> Edit only this file. `just bootstrap` verifies the symlinks and repairs
> any that are missing or stale.

## What this project is

A polyglot monorepo scaffolded from `templates/polyglot-monorepo` against [Tool-Belt Harness Standard v0.1](./docs/standard/v0.1.md) (or whichever version this scaffold targets; check the template's `manifest.json`).

The harness gives you 12 named slots wired in: `stack-manager`, `inspector`, `hooks`, `telemetry-sdk`, `observability-stack`, `sensors`, `profiling`, `agent-plugins`, `task-runner`, `secret-scanner`, `doc-validator`, and `versioning`. Some slots ship as stubs until you replace them with a real plugin; each slot has a contract.

## Quick runbook

```sh
just                  # list every recipe with a one-line description
just bootstrap        # verify vendor symlinks + validate cross-cutting deps
just stack boot       # boot the isolated observability stack
just stack ports      # print eval-safe per-worktree ports
just stack --help     # stack-manager slot entrypoint
just inspector --help # evidence-capture utilities (screenshot, record, keyframes)
just fitness          # READ-ONLY architectural-health report (see below)
just profile --help   # backend, frontend, startup profiles + per-signal budgets
```

## Architectural fitness feedback (read this before changing code)

This template measures architectural fitness on every commit and ratchets
the floor upward — so a regression on complexity, coupling, cycles,
security findings, or licensing fails the gate. The ratchet is
implemented in `harness/sensors/gate.mjs` and the floors live in
`harness/sensors/baseline.json`.

The agent-facing feedback surface is `just fitness`:

```sh
just fitness                      # full live report (slow, ~108 s); runs the
                                  #   full sensors pipeline read-only
just fitness --quick              # floor-only view, instant; reads baseline.json
                                  #   without re-scanning
just fitness --quick --format=summary  # one-line summary (used by pre-commit)
just fitness --format=json        # structured payload for automation
```

Read the report before changing code that touches:

- function complexity (MT01 `max-cognitive`, `max-cyclomatic`, `high-cognitive-fn-count`)
- module coupling and main-sequence distance (MD01)
- circular dependencies (ST01)
- security findings (SC01) and license allowlist (LG01)
- startup-time benchmarks (PF01)

Status taxonomy:

- `[ OK ] PASS` — comfortable headroom against the floor; safe to ship.
- `[NEAR] AT-RISK` — at or within ~10% of the floor; the next regression
  on that metric will trip the ratchet. Refactor before committing if
  you are about to add complexity or coupling on this axis.
- `[FAIL]` — already below the floor; `just sensors gate` will reject
  the commit. Fix the code so the metric returns at or below the floor,
  or, if the change is intentional, run `just sensors gate
  --update-baseline` to relax the floor as a reviewable audit-trailed
  edit to `harness/sensors/baseline.json`.
- `[ -- ] SKIP` — no reading or no floor for that metric (typically
  because `--quick` skipped the live scan or the adapter is not present
  in this environment).

The pre-commit hook always prints the one-line summary so you do not
need to remember to run the command — but `just fitness` is the
canonical surface when you want the full per-metric headroom table.
The report is READ-ONLY: it never mutates `baseline.json` or changes
gating behavior. The ratchet authority remains `just sensors gate`
(local single-shot) and the `fitness` GitHub Actions job (canonical CI
ratchet).

## Skills available in this project

This scaffold ships with on-demand skills under `.claude/skills/`. When a task matches a skill's purpose, invoke it via the Skill tool by name (bare, unnamespaced; project-local skills take precedence over plugin-installed ones with the same name).

The list below is GENERATED from each skill's `SKILL.md` frontmatter by
`scripts/agents-skills.ts`. Do not edit it by hand: change the skill's
frontmatter instead, then run `just agents skills --write`. A drift check
(`just agents skills`) runs in lefthook pre-commit and in the CI `scripts`
job, so a stale list fails the gate.

<!-- agents-skills:begin -->
- **`architecture`**: Use when reviewing architectural concerns: module boundaries, dependency direction, layer discipline, bounded-context isolation, ADR coverage, premature abstraction, and structural fitness for change
- **`before-after-evidence`**: Produce a verifiable evidence bundle for a fix: screenshot pair, optional flow recording, ffmpeg keyframe grid, trace correlation. Use when claiming "fix verified" so the artifacts can be diffed by a reviewer (human or LLM).
- **`chrome-devtools-deep`**: Reach for raw Chrome DevTools Protocol when Playwright's high-level API isn't enough: performance traces, source-mapped console stacks, heap snapshots, deep network introspection. Stay inside Playwright via `newCDPSession` rather than running raw websocat.
- **`configuration`**: Use when reviewing configuration concerns: env-var layering, typed config objects, startup validation, secret/non-secret separation, schema discoverability, environment-dependent defaults, twelve-factor compliance, magic numbers
- **`continuous-delivery`**: Use when reviewing delivery concerns: DORA four key metrics, pre-merge gating, trunk-based development, fast feedback, single-artifact promotion, health-gated deploys, automated rollback, deploy/release decoupling via feature flags, deploy frequency, runbook freshness, deploy-credential scoping, pipeline bottleneck visibility, supply-chain attestation
- **`dependencies`**: Use when reviewing dependency concerns: lockfile health, version pinning, immutable references, maintenance signals, transitive audit gates, monorepo version skew, reviewable lockfiles, license posture
- **`developer-experience`**: Use when reviewing developer-experience concerns: single-command onboarding (contributors and end-users), inner-loop speed, task-runner discoverability, recipe-as-thin-wrapper discipline, error-message actionability, formatter/linter automation, AI-agent ergonomics, reproducible local environment, parallel-worktree dev stacks
- **`documentation`**: Use when reviewing documentation concerns: README presence and quality, public API documentation, ADR coverage for non-obvious decisions, inline rationale comments, TBD/placeholder hygiene in shipped docs
- **`dry`**: Use when reviewing DRY concerns: knowledge-vs-text duplication, repeated business rules across boundaries, magic constants, configuration duplication, copy-pasted test fixtures, premature abstraction risk, rule-of-three for extraction
- **`environments`**: Use when reviewing environment concerns: dev/staging/prod parity, declarative environment manifests, build vs runtime separation, environment promotion path, secret-loader parity across environments, reproducible local setup, ephemeral / preview environments per PR with auto-teardown, data parity (shape-realistic seed and anonymized prod copies), mechanically enforced parity rules
- **`error-handling`**: Use when reviewing error-handling concerns: error taxonomy, propagation discipline, swallow-vs-crash, retry semantics with backoff and idempotency, exit codes as API, error messages as contract, cause-chain preservation
- **`logging`**: Use when reviewing logging concerns: structured-vs-unstructured logs, log-level policy, secret and PII redaction, correlation IDs in distributed systems, log/trace linkage, print statements in production code paths
- **`observability-queries`**: Canonical LogsQL, PromQL, and Jaeger-compatible trace queries against the harness Victoria stack. Use when investigating a bug via logs, metrics, traces, building an evidence bundle, or wiring a new alert. Includes copy-pasteable curl examples and gotchas: severity, not level; case-sensitive enum; mandatory `| fields` projection.
- **`orchestrating-a-vps-agent-swarm`**: Guidance for managing a multi-agent swarm on this template's VPS environment. Use when coordinating multiple autonomous agents (Claude Code, Codex, Gemini) across parallel beads, handling double-claim collisions via Agent Mail, and using beads for global task state. Covers per-agent autonomy toggles (YOLO vs review-gated), multi-model layered review, the human framing gate, and the canonical CLI surface (`br`, `bv`, `am`, `proj`, `ntm`).
- **`playwright-debug`**: Drive your app via Playwright for UI debugging: navigation, console errors, network failures, accessibility-tree DOM snapshots, JS evaluation. Use when investigating UI bugs, validating fixes, or capturing what the user sees.
- **`principles-and-patterns`**: Use when reviewing cross-cutting design principles: SOLID applicability, separation of concerns, dependency direction, composition vs inheritance, coupling and cohesion, OO-vs-functional style consistency, pattern enforcement style, project-level bounded-context coupling
- **`purpose-and-scope`**: Use when reviewing purpose-and-scope concerns: stated project purpose, declared in-scope and out-of-scope, non-goals, plan-purpose alignment, scope-creep within a single change, project-level bounded contexts, dependency-purpose linkage
- **`running-experiments`**: Use when creating, scaffolding, executing, scoring, or auditing a hypothesis-first experiment in this project, OR when capturing a prospective experiment as a proposal under `docs/experiments/proposals/`. Trigger phrases include "new experiment", "new probe", "run an experiment", "score the probe", "write the verdict", "hypothesis first", "design the eval pack", "two-commit rule", "hypothesis scorecard", "write a retrospective for", "is this an experiment", "capture this as a proposal", "prospective experiment", "lock this idea", "promote this proposal". Covers the `experiments/<date>--<slug>/` four-file layout (README / eval-pack / results / verdict), the verdict vocabulary (go / no-go / inconclusive), the proposal lifecycle (`docs/experiments/proposals/<slug>.md` → promoted experiment), and the relationship between an experiment and its retrospective under `docs/retrospectives/`. Do NOT use for: ad-hoc debugging sessions, code review, or skill authoring.
- **`security`**: Use when reviewing security concerns: secrets in code, SAST coverage, input validation, authn/authz boundaries, sensitive-data handling, dependency CVEs, SSRF, hand-rolled escaping, threat modeling for high-stakes changes, defense in depth, agentic-AI / LLM tool-call attack surface (prompt injection, indirect injection, MCP abuse)
- **`software-complexity`**: Use when reviewing software complexity concerns: cognitive load, cyclomatic and cognitive complexity bounds, deep-vs-shallow modules, accidental coupling, premature abstraction, asymmetric simplicity, comments-explain-why
- **`testing`**: Use when reviewing testing concerns: pyramid coverage (unit, integration, E2E), test code quality, TDD discipline, regression discipline, FIRST principles, feedback-loop speed
- **`types`**: Use when reviewing type-system concerns: type-coverage in public APIs, primitive obsession vs refinement, runtime validation at trust boundaries, soundness gaps and escape hatches, narrow vs wide types, strict-mode discipline
- **`versioning`**: Use when reviewing versioning concerns: declared scheme (semver/calver/ZeroVer), changelog hygiene, deprecation policy and migration paths, public-API stability classification, version-bump automation, manifest-drift across multiple files, release process (cut-a-release flow, release branches, release gates)
<!-- agents-skills:end -->

Invocation pattern (this is how the Skill tool dispatches them):

```
Skill({skill: "running-experiments"})
```

## Upstream harness-engineering principle skills

This template references, but does not vendor, the upstream harness-engineering
plugin skills from
[`syntropic137/harness-engineering/skills`](https://github.com/syntropic137/harness-engineering/tree/main/skills).
Keeping the principle bodies upstream avoids duplicated guidance drifting across
consumer forks.

Install the Claude plugin from a local clone:

```sh
git clone https://github.com/syntropic137/harness-engineering.git ~/.claude/plugins/harness-engineering
claude plugin install ~/.claude/plugins/harness-engineering --scope project
```

For Codex-style skill discovery, keep the same upstream clone and symlink the
skills directory:

```sh
git clone https://github.com/syntropic137/harness-engineering.git ~/.codex/harness-engineering
mkdir -p ~/.agents/skills
ln -s ~/.codex/harness-engineering/skills ~/.agents/skills/harness-engineering
```

Smoke-check the reference from a fresh clone:

```sh
bun run scripts/harness-engineering-skills.ts --fresh-clone
```

The upstream skill inventory is:

| Skill | Role | Template note |
|---|---|---|
| `application-legibility` | Expose runtime state, errors, causal chains, and trace context as machine-readable application surfaces. | Use when adding real app endpoints; the bare template has only example apps. |
| `approved-scenarios` | Define what agents may do unilaterally versus what requires escalation. | Reference-only until this template grows a machine-readable approval policy file. |
| `authoring-skills` | Author or audit Claude skills and their routing/frontmatter shape. | Useful immediately for project-local skill maintenance. |
| `autonomous-validation-loop` | Shape observe-fix-restart-rerun-diff loops with iteration budgets and structured verdicts. | Use when a consumer adds deterministic workloads or UI journeys. |
| `browser-legibility` | Wire browser perception through CDP, Playwright, DOM, accessibility tree, network, console, screenshots, and video evidence. | Complements the local Playwright and Chrome DevTools skills. |
| `harness-review` | Orchestrate the sibling principle skills into a parallel harness audit. | Invoke from a top-level `claude -p` session after installing the plugin. |
| `long-running-durability` | Keep multi-hour agent tasks resumable through checkpoints, durable state, retries, and budgets. | Reference-only until long-running task state is wired into this template. |
| `performance-gates` | Design startup, latency, span-duration, and journey performance budgets as mechanical gates. | Useful now for the startup-time gate; expand as consumers add real workloads. |
| `repo-knowledge-map` | Keep agent-facing context small, discoverable, co-located, and mechanically drift-checked. | Useful now; this `CLAUDE.md` is the repo map entry point. |
| `skill-testing` | Empirically test skill routing and whether a skill body earns its context cost. | Useful for both upstream plugin and in-tree skill edits. |
| `telemetry-pipeline` | Shape OTLP/OpenTelemetry collection, routing, enrichment, fanout, buffering, and backend independence. | Useful with the template observability stack; apps must still emit signal. |
| `telemetry-query` | Make logs, metrics, traces, schemas, and cross-signal correlation queryable by agents. | Pairs with the local concrete `observability-queries` skill. |
| `worktree-isolation` | Separate parallel agent work by worktree, ports, databases, logs, telemetry labels, and teardown. | Design guide only until per-task worktree wiring lands. |

Use the upstream orchestrator like this after installation:

```sh
claude -p --verbose \
  --permission-mode bypassPermissions \
  --append-system-prompt-file ./CLAUDE.md \
  "Use the harness-review skill from the installed harness-engineering plugin to audit this repository. Target: . Return findings first, then residual risks."
```

## Workspace layout

- `ws_apps/`: your runnable units. Each subdir can pick its own stack (TS, Rust, Python, Go, and so on).
- `ws_packages/`: shared libs. Same polyglot rule.
- `harness/`: slot plugins. Rust-first where it makes sense; see Standard §4.
- `infra/`: the observability-stack plugin (docker-compose'd).
- `.claude/`: agent plugins for Claude Code (skills, commands, subagents, hooks). The text-file vendor mirrors `CLAUDE.md`, `GEMINI.md`, `.codex`, and `.gemini` are committed symlinks pointing at `AGENTS.md`.

## Cross-platform notes

- macOS + Linux: first-class. Just install `just` and a container runtime.
- Windows: aspirational. Vendor symlinks need dev-mode or admin; a copy-sync fallback ships in template v0.2. Until then, `git config core.symlinks true` is required before cloning on Windows or the committed vendor links materialize as plain text files containing the link target.

## Delegating work to `claude -p`

If you delegate an implementation task to a non-interactive `claude -p` invocation inside this project, use the empirically-validated flag set + prompt template (5 paired trials in `agentic-harness-lab` retro 023 + S12-S16 synthesis):

```sh
claude -p --verbose \
  --permission-mode bypassPermissions \
  --append-system-prompt-file ./CLAUDE.md \
  --output-format stream-json --include-hook-events --include-partial-messages \
  --max-budget-usd 4.00 \
  --no-session-persistence \
  "$TASK_DESCRIPTION

Before extending: WebSearch <topic> and CITE >=N sources in the commit message.
Use conventional commits. N commits total (Part 1 then Part 2 if applicable)."
```

**Why each piece:**
- `bypassPermissions`: `acceptEdits` denies Bash; this is the realistic-autonomy mode (S5).
- `--append-system-prompt-file`: injects this CLAUDE.md so the agent sees project conventions. CWD auto-discovery also works.
- `--output-format stream-json --verbose`: tool calls are otherwise invisible; required together (S7 footgun).
- `--include-hook-events`: emits lefthook firings as parseable events.
- `--max-budget-usd`: hard cap. macOS lacks `timeout`; this is the only enforced cap.
- `--no-session-persistence`: clean trials don't pollute interactive history.

**Why the prompt template:**
- Strong-verb "WebSearch and cite": descriptive verbs like "verify" are silently ignored (S12 vs S13 found a 0 to 2 WebSearch delta).
- Explicit "Use conventional commits": without it, `claude -p` stops at *"Ready to commit when you say go"* instead of actually committing (S13 to S14).

**What works mechanically (no prompt phrasing required):**
- Hard gates: lefthook (`cargo fmt`, `cargo clippy`, `secret-scan`, etc.) and commit-msg (`cog-verify`) bind every commit. The agent retries after gate bounces; it does NOT use `--no-verify`.

**What needs explicit naming:**
- Project-local skills under `.claude/skills/`: dispatched via the Skill tool by **bare unnamespaced name** when the task mentions them. Skills are NOT auto-discovered in `-p`.

## Agent Mail wiring (opt-in)

This template targets the VPS swarm workflow (see
`.claude/skills/orchestrating-a-vps-agent-swarm/`). Cross-agent
coordination flows through Agent Mail, exposed to Claude Code, Codex,
and Gemini as the `mcp-agent-mail` HTTP MCP server at
`http://127.0.0.1:8765/mcp/`.

The wiring is **opt-in by design**: the Bearer token is per-host and
MUST NOT be committed. Copy `.claude/settings.local.example.json` to
`.claude/settings.local.json` (gitignored) and replace
`YOUR_BEARER_TOKEN_HERE` with your host's token.

```sh
cp .claude/settings.local.example.json .claude/settings.local.json
# edit .claude/settings.local.json and set the Bearer token
```

The token is provisioned by the operator from the launchpad's
`services-setup` wizard (see `~/CLAUDE.md` on a provisioned VPS for the
ACFS path). On the VPS the Agent Mail server runs as a systemd user
unit; the wiring above will be a dead handle until the unit is active:

```sh
systemctl --user status agent-mail
systemctl --user start agent-mail   # if not running
```

Without the unit, `am macros start-session` and every other `am`
operation will return a connection-refused error. With the unit and the
local settings file in place, Claude Code, Codex, and Gemini all see
the same MCP surface.

For forks that do not run a VPS swarm, leave
`.claude/settings.local.json` absent. The template degrades cleanly:
no Agent Mail tools appear, beads still tracks state per-project, and
no other slot depends on the MCP wiring.

## Conventions worth knowing

- **Token-aware:** harness binaries default to terse output. Use `--verbose` when you need it.
- **Evidence-driven:** big changes get a hypothesis-first experiment under `experiments/<date>--<slug>/`. See `.claude/skills/running-experiments/`.
- **Security gates:** read [`security.md`](./security.md) once before changing hook, dependency, or CI policy. `lefthook.yml` runs diff-scoped Biome, Gitleaks, and UBS gates; `.claude/settings.json` runs `.claude/hooks/ubs-diff.sh` after Claude file writes. `scripts/init.ts` preserves global attribution hooks by chaining any global `core.hooksPath` `prepare-commit-msg` hook into local `.git/hooks`.
- **No `.sh` or `Makefile` as primary entrypoints.** `justfile` is the single discovery surface. Language-native scripts allowed where `just` would be awkward.

## When you change something significant

1. **Load-bearing on cost/wall-clock claims** → write a hypothesis-first experiment under `experiments/<date>--<slug>/`. Two-commit rule (hypothesis, then run).
2. **Tool selection** → research-backed per Standard §2. Drop a decision pointer at `docs/standard/decisions/<slot>.md` linking to the experiment.
3. **Adding a vendor (Cursor, Aider, OpenCode, …)** → add to the `just agents link` recipe.

## Where things live

- `docs/standard/v<X.Y>.md`: the Standard this project targets
- `docs/standard/decisions/<slot>.md`: per-slot tool picks (with experiment links)
- `experiments/<date>--<slug>/`: hypothesis-first probes
- `docs/retrospectives/`: post-mortems per experiment
- `docs/journal/`: context journals across sessions

---

_This template is a v0.1 draft. Edit freely for your project; the canonical Standard lives in the agentic-harness-lab repo._
