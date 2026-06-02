---
name: "Agent Plugins"
description: "Use AGENTS.md as the canonical agent-context file plus the .claude directory, with vendor symlinks pointing at AGENTS.md so every vendor agent reads the same body on a fresh clone"
status: accepted
---

# ADR-0007: Agent Plugins

**Date:** 2026-05-14
**Last updated:** 2026-06-02 (canonical body flipped from `CLAUDE.md` to `AGENTS.md` per the WS1 fork-readiness spec)
**Category:** Slot
**Next review:** 2026-08-14

## Context

The template needs one canonical source for agent context, skills, commands, hooks, and settings while remaining usable by multiple coding-agent CLIs.

## Decision

Use `AGENTS.md` as the canonical agent-context text file and `.claude/` as the canonical agent-plugins directory. Ship committed symlinks (`CLAUDE.md`, `GEMINI.md`, `.codex`, `.gemini`) pointing at `AGENTS.md` so every vendor agent reads the same body on a fresh clone with zero setup.

## Consequences

The template avoids duplicating agent instructions across vendors. Non-Claude vendors (Codex, Gemini) land with full context on `git clone`. `just bootstrap` verifies the vendor symlinks and repairs any that are missing or stale. Vendor-specific rule formats that require frontmatter or directory schemas remain out of scope until they can be represented without drift.

## Details

Confirms Standard v0.1 §4.7 with the v0.2 canonical-body flip. `AGENTS.md` is the AAIF-stewarded open spec that the broadest set of coding agents reads natively (Codex, OpenCode, Aider per roadmap, Amp, Devin, Copilot), so anchoring the canonical body there gives the widest reach without per-vendor maintenance. The `.claude/` directory stays canonical for the Claude-specific tree (skills, commands, hooks, settings).

## Canonical source
- `AGENTS.md` (root agent-context body; canonical text file)
- `.claude/` (dir: `skills/`, `commands/`, `agents/`, `hooks/`, `settings.json`)

## Vendor symlinks shipped in v0.4.x of polyglot-monorepo template

| Symlink | Target | Vendor | Source |
|---|---|---|---|
| `CLAUDE.md` | `AGENTS.md` | Claude Code root agent-context file | [Anthropic Claude Code docs](https://docs.anthropic.com/claude/docs/claude-code) |
| `GEMINI.md` | `AGENTS.md` | Gemini CLI default project context filename, hierarchically loaded | [Gemini CLI docs](https://geminicli.com/docs/cli/gemini-md/) |
| `.codex` | `AGENTS.md` | Codex CLI conventional project root indicator; the symlink resolves to the same body so a Codex agent without an explicit project dir still sees the canonical text | [OpenAI Codex docs](https://developers.openai.com/codex/guides/agents-md) |
| `.gemini` | `AGENTS.md` | Gemini CLI project-dir indicator; same resolution as `.codex` | [Gemini CLI docs](https://geminicli.com/docs/cli/gemini-md/) |

`AGENTS.md` is itself the AAIF-stewarded open spec. The vendor symlinks above guarantee that Claude, Gemini, Codex, OpenCode, Aider (per roadmap), Amp, Devin, and Copilot all read the same body without any per-vendor setup.

## Other vendors surveyed (not shipped in v0.1)

| Vendor | File | Dir | Status | Source |
|---|---|---|---|---|
| Cursor | `.cursorrules` (deprecated since 0.43/0.45) | `.cursor/rules/*.mdc` (current) | Skip — `.mdc` format with YAML frontmatter is not a drop-in symlink target | [Cursor rules guide 2026](https://techsy.io/en/blog/cursor-rules-guide) |
| Windsurf | `.windsurfrules` (legacy, pre-Wave 8) | `.windsurf/rules/` (current, per-rule frontmatter) | Skip — same reason as Cursor | [Windsurf docs](https://docs.windsurf.com/windsurf/cascade/memories) |
| Aider | `CONVENTIONS.md` (opt-in via `--read` or `.aider.conf.yml`) | none | Skip — not auto-loaded; users wire it themselves | [Aider docs](https://aider.chat/docs/usage/conventions.html) |
| OpenCode | `AGENTS.md` (covered by symlink above) | `~/.config/opencode/` global only | Already covered | [OpenCode rules](https://opencode.ai/docs/rules/) |
| Continue.dev | none at root | `.continue/rules/*.md`, `.continue/configs/` | Skip — directory-of-rules, not single file | [Continue rules docs](https://docs.continue.dev/customize/deep-dives/rules) |
| Sourcegraph Cody | none on disk | server-side Context Filters | Skip — not file-based | [Cody context docs](https://sourcegraph.com/docs/cody/core-concepts/context) |

## Open issues / when to re-probe
- AAIF AGENTS.md spec evolution (Linux Foundation, Dec 2025 launch) — watch for v1.0 schema.
- Cursor/Windsurf `.mdc` + YAML frontmatter diverges from plain `AGENTS.md`; re-probe Aug 2026.
- AGNTCon Oct 2026 likely produces movement among new entrants.

## Sources
- [agents.md open spec](https://agents.md/) · [Agentic AI Foundation](https://intuitionlabs.ai/articles/agentic-ai-foundation-open-standards)
- [OpenAI Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [Gemini CLI GEMINI.md](https://geminicli.com/docs/cli/gemini-md/)
- [Cursor rules 2026](https://techsy.io/en/blog/cursor-rules-guide) · [Windsurf memories](https://docs.windsurf.com/windsurf/cascade/memories)
- [Aider conventions](https://aider.chat/docs/usage/conventions.html) · [OpenCode rules](https://opencode.ai/docs/rules/) · [Continue rules](https://docs.continue.dev/customize/deep-dives/rules)
