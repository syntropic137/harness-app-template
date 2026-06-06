# Agent context ({{PROJECT_NAME}})

> This file is the canonical agent context for this project. `CLAUDE.md`,
> `GEMINI.md`, `.codex`, and `.gemini` are committed symlinks that point at
> this file, so every vendor agent reads the same body on a fresh clone.
> Edit only this file. `just bootstrap` verifies the symlinks and repairs
> any that are missing or stale.

## What this project is

A polyglot monorepo scaffolded from `templates/polyglot-monorepo` against [Tool-Belt Harness Standard v0.1](./docs/standard/v0.1.md) (or whichever version this scaffold targets; check the template's `manifest.json`).

The harness gives you 11 named slots wired in: `stack-manager`, `inspector`, `hooks`, `telemetry-sdk`, `observability-stack`, `sensors`, `agent-plugins`, `task-runner`, `secret-scanner`, `doc-validator`, and `versioning`. Some slots ship as stubs until you replace them with a real plugin; each slot has a contract.

## Quick runbook

```sh
just                  # list every recipe with a one-line description
just bootstrap        # verify vendor symlinks + validate cross-cutting deps
just stack boot       # boot the isolated observability stack
just stack ports      # print eval-safe per-worktree ports
just stack --help     # stack-manager slot entrypoint
just inspector --help # evidence-capture utilities (screenshot, record, keyframes)
```

## Skills available in this project

This scaffold ships with on-demand skills under `.claude/skills/`. When a task matches a skill's purpose, invoke it via the Skill tool by name (bare, unnamespaced; project-local skills take precedence over plugin-installed ones with the same name):

- **`running-experiments`**: use when creating, scaffolding, executing, scoring, or auditing a hypothesis-first experiment in this repo, OR when capturing a prospective experiment as a proposal under `docs/experiments/proposals/`. Covers the `experiments/<date>--<slug>/` four-file layout, the two-commit rule, verdict vocabulary (go / no-go / inconclusive), and the proposal-to-experiment promotion lifecycle.
- **`observability-queries`**: use when investigating a bug via logs/metrics/traces, building an evidence bundle, or wiring a new alert. Provides canonical LogsQL / PromQL / TraceQL queries against the harness Victoria stack with copy-pasteable curl examples and the syntax pitfalls (severity not level; case-sensitive enum; `| fields` projection mandatory).
- **`before-after-evidence`**: use when claiming a fix is verified and you need a reviewable evidence bundle (screenshot pair, optional flow recording, ffmpeg keyframe grid, trace correlation) that another reviewer (human or LLM) can diff.

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
- `docs/adrs/`: numbered architecture decision records; the load-bearing shape that quality gates are compositional slots is recorded in [ADR-0018-quality-gate-slot-composition](./docs/adrs/ADR-0018-quality-gate-slot-composition.md), and the slot decisionAt backlinks in `harness.manifest.json` resolve here.
- `experiments/<date>--<slug>/`: hypothesis-first probes
- `docs/retrospectives/`: post-mortems per experiment
- `docs/journal/`: context journals across sessions

---

_This template is a v0.1 draft. Edit freely for your project; the canonical Standard lives in the agentic-harness-lab repo._
