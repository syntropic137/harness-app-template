---
name: "Task Runner"
description: "Use just as the human-facing polyglot task runner"
status: accepted
---

# ADR-0008: Task Runner

**Date:** 2026-05-14
**Category:** Slot
**Next review:** 2026-11-14

## Context

Humans and agents need a terse, discoverable command surface for a polyglot monorepo without making npm, cargo, or make the universal entrypoint.

## Decision

Use `just` as the root task runner and keep recipes as the canonical human-facing commands.

## Consequences

The template gets single-binary task discovery and polyglot recipe bodies. Windows users may need a compatible shell; Windows-first templates should re-evaluate `go-task`.

## Details

## Current pick
`just` (casey/just), v1.51.0 released 2026-05-10 ([release page][rel]). Single Rust binary, MIT-licensed.

## Justification
`just` remains the cleanest, lowest-friction fit for the Standard's `task-runner` slot: single static binary, polyglot recipe bodies via shebang lines (sh/python/node/ruby/pwsh), and a discoverable `just --list` showing each recipe's doc-comment one-liner — which satisfies §4.8's "with no args lists every recipe with a description" requirement when paired with a default `help: @just --list` recipe ([just docs][js], [field notes][fn]). It is the lowest-leverage pick that meets the contract; richer runners add scope we don't yet need.

## Maintenance signal
Active and healthy: 1.51.0 shipped 2026-05-10, prior 1.5x line through Q1–Q2 2026, single-maintainer (Casey Rodarmor) but consistent monthly cadence on GitHub releases ([releases][rel]).

## License
MIT (permissive, OSI).

## Cross-platform (esp. Windows behavior)
First-class macOS/Linux/FreeBSD; Windows x64 + aarch64 binaries shipped, installable via `winget install --id Casey.Just --exact` ([github][gh]). Caveat: by default `just` invokes `sh` for recipe bodies, which on Windows requires Git Bash / WSL / busybox unless the justfile sets `set shell := ["powershell.exe", "-c"]` or uses shebang recipes. This is a real ergonomic tax on Windows users — the Standard already labels Windows as "supported when reasonable" (§2), and Windows users on this harness already need Docker Desktop, so the dependency footprint is acceptable. Shebang recipes are the documented polyglot escape hatch and work uniformly across platforms ([just manual][js]).

## Alternatives considered
- **`mise`** — tool-version manager + task runner, parallel execution, source-change skipping, monorepo task discovery ([mise tasks][mt], [HN][hn]). Strictly more capable than `just`, but couples task-running to mise's version manager and uses TOML+monorepo conventions we don't yet need. Reconsider if/when EXP probes show parallel task execution or change-aware skipping moves the needle.
- **`go-task` (Taskfile)** — YAML-defined, cross-platform-by-design (own shell interp, no `sh` on Windows), checksum-based change detection, latest 2026-04-13 ([taskfile.dev][tf], [releases][tfr]). Strong contender; loses on syntax verbosity (YAML) and on agent-friendliness (less terse `--list`). Re-probe if Windows-without-sh becomes a blocker.
- **`make`** — universal but tab-sensitive, .PHONY ceremony, weak Windows story. Explicitly excluded by §2.
- **`cargo-make`** — Rust-ecosystem locked; non-starter for polyglot templates.
- **Bun/Deno tasks, npm scripts** — language-locked; violate polyglot-first.

## Open issues / when to re-probe
- Windows-first templates: if a template targets Windows-primary users, switch to `go-task` (its built-in shell interp avoids the sh-on-Windows tax).
- Parallel/change-aware tasks: if hooks or sensor runs grow expensive, probe `mise` or `go-task` checksums.
- Re-probe at v0.2 of the Standard, or sooner if `just` releases slip past 6 months.

## Sources
- [casey/just GitHub][gh] · [Releases][rel] · [Just manual][js]
- [Stuart Ellis — Shared Tooling with just][fn]
- [mise tasks docs][mt] · [HN discussion on mise monorepo tasks][hn]
- [taskfile.dev][tf] · [go-task releases][tfr]
- [Taskfile vs Just vs Make comparison][cmp]

[gh]: https://github.com/casey/just
[rel]: https://github.com/casey/just/releases
[js]: https://just.systems/man/en/
[fn]: https://www.stuartellis.name/articles/just-task-runner/
[mt]: https://mise.jdx.dev/tasks/
[hn]: https://news.ycombinator.com/item?id=45491621
[tf]: https://taskfile.dev/
[tfr]: https://github.com/go-task/task/releases
[cmp]: https://mylinux.work/guides/taskfile-vs-just-vs-make/
