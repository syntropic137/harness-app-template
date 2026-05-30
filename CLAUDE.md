# Agent context — {{PROJECT_NAME}}

> This file is the canonical agent context for this project. Other vendors (Codex, Gemini, Cursor, …) read it via symlinks (`AGENTS.md`, `GEMINI.md`, etc.). Edit only this file.

## What this project is

A polyglot monorepo scaffolded from `templates/polyglot-monorepo` against [Tool-Belt Harness Standard v0.1](./docs/standard/v0.1.md) (or whichever version this scaffold targets — check the template's `manifest.json`).

The harness gives you 11 named slots wired in: `stack-manager`, `inspector`, `hooks`, `telemetry-sdk`, `observability-stack`, `sensors`, `agent-plugins`, `task-runner`, `secret-scanner`, `doc-validator`, and `versioning`. Some slots ship as stubs until you replace them with a real plugin; each slot has a contract.

## Quick runbook

```sh
just                  # list every recipe with a one-line description
just bootstrap        # install vendor symlinks + validate cross-cutting deps
just boot up          # boot the observability compose stack
just stack --help     # stack-manager slot stub / replacement entrypoint
just inspector --help # evidence-capture utilities (screenshot, record, keyframes)
```

## Skills available in this project

This scaffold ships with on-demand skills under `.claude/skills/`. When a task matches a skill's purpose, invoke it via the Skill tool by name (bare, unnamespaced — project-local skills take precedence over plugin-installed ones with the same name):

- **`running-experiments`** — use when creating, scaffolding, executing, scoring, or auditing a hypothesis-first experiment in this repo, OR when capturing a prospective experiment as a proposal under `docs/experiments/proposals/`. Covers the `experiments/<date>--<slug>/` four-file layout, the two-commit rule, verdict vocabulary (go / no-go / inconclusive), and the proposal → experiment promotion lifecycle.
- **`observability-queries`** — use when investigating a bug via logs/metrics/traces, building an evidence bundle, or wiring a new alert. Provides canonical LogsQL / PromQL / TraceQL queries against the harness Victoria stack with copy-pasteable curl examples and the syntax pitfalls (severity not level; case-sensitive enum; `| fields` projection mandatory).
- **`before-after-evidence`** — use when claiming a fix is verified and you need a reviewable evidence bundle (screenshot pair, optional flow recording, ffmpeg keyframe grid, trace correlation) that another reviewer (human or LLM) can diff.

Invocation pattern (this is how the Skill tool dispatches them):

```
Skill({skill: "running-experiments"})
```

## Workspace layout

- `ws_apps/` — your runnable units. Each subdir can pick its own stack (TS, Rust, Python, Go, …).
- `ws_packages/` — shared libs. Same polyglot rule.
- `harness/` — slot plugins. Rust-first where it makes sense; see Standard §4.
- `infra/` — the observability-stack plugin (docker-compose'd).
- `.claude/` — agent plugins (skills, commands, subagents, hooks). Canonical source; `.codex` and `.gemini` are symlinks here.

## Cross-platform notes

- macOS + Linux: first-class. Just install `just` and a container runtime.
- Windows: aspirational. Vendor symlinks need dev-mode or admin; a copy-sync fallback ships in template v0.2.

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
- Strong-verb "WebSearch and cite" — descriptive verbs like "verify" are silently ignored (S12 vs S13 found a 0 → 2 WebSearch delta).
- Explicit "Use conventional commits" — without it, `claude -p` stops at *"Ready to commit when you say go"* instead of actually committing (S13 → S14).

**What works mechanically (no prompt phrasing required):**
- Hard gates — lefthook (`cargo fmt`, `cargo clippy`, `secret-scan`, etc.) and commit-msg (`cog-verify`) bind every commit. The agent retries after gate bounces; it does NOT use `--no-verify`.

**What needs explicit naming:**
- Project-local skills under `.claude/skills/` — dispatched via the Skill tool by **bare unnamespaced name** when the task mentions them. Skills are NOT auto-discovered in `-p`.

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

- `docs/standard/v<X.Y>.md` — the Standard this project targets
- `docs/standard/decisions/<slot>.md` — per-slot tool picks (with experiment links)
- `experiments/<date>--<slug>/` — hypothesis-first probes
- `docs/retrospectives/` — post-mortems per experiment
- `docs/journal/` — context journals across sessions

---

_This template is a v0.1 draft. Edit freely for your project; the canonical Standard lives in the agentic-harness-lab repo._
