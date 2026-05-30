---
name: "Agent Plugins"
description: "Use .claude as canonical agent context with vendor symlinks"
status: accepted
---

# ADR-0007: Agent Plugins

**Date:** 2026-05-14
**Category:** Slot
**Next review:** 2026-08-14

## Context

The template needs one canonical source for agent context, skills, commands, hooks, and settings while remaining usable by multiple coding-agent CLIs.

## Decision

Use `.claude/` and `CLAUDE.md` as canonical, then expose compatible vendor entrypoints through symlinks such as `AGENTS.md`, `GEMINI.md`, `.codex/`, and `.gemini/`.

## Consequences

The template avoids duplicating agent instructions across vendors. Vendor-specific rule formats that require frontmatter or directory schemas remain out of scope until they can be represented without drift.

## Details

Confirms Standard v0.1 §4.7. `.claude/` is canonical (primary user's vendor); other tools interop via symlinks.

## Canonical source
- `.claude/` (dir: `skills/`, `commands/`, `agents/`, `hooks/`, `settings.json`)
- `CLAUDE.md` (root agent context file)

## Vendor symlinks shipped in v0.1 of polyglot-monorepo template

| Symlink | Target | Vendor | Source |
|---|---|---|---|
| `AGENTS.md` | `CLAUDE.md` | Codex CLI — concatenated into context at session start; AAIF-stewarded open spec adopted by Codex/Cursor/Gemini CLI/Windsurf/Copilot | [OpenAI Codex docs](https://developers.openai.com/codex/guides/agents-md), [agents.md](https://agents.md/) |
| `GEMINI.md` | `CLAUDE.md` | Gemini CLI — default project context filename, hierarchically loaded | [Gemini CLI docs](https://geminicli.com/docs/cli/gemini-md/) |
| `.codex/` | `.claude/` | Codex home/project dir (`~/.codex` global; project-level walked from CWD up) | [OpenAI Codex docs](https://developers.openai.com/codex/guides/agents-md) |
| `.gemini/` | `.claude/` | Gemini CLI project dir (stores `GEMINI.md`, `extensions/`, config) | [Gemini CLI docs](https://geminicli.com/docs/cli/gemini-md/) |

`AGENTS.md` covers a long tail (OpenCode, Aider via roadmap, Amp, Devin, Copilot) without per-vendor symlinks — they all read the same root file.

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
