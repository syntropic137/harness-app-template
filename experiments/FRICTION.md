# FRICTION.md (shared, append-only)

Tag each item: tooling-bug | docs-gap | config | workaround-found.
Format: `- [EXP-NN] [tag] one-line item (agent, date).`
Sole-editor rule does NOT apply here; append-only.

- [EXP-01] [tooling-bug] APSS doc-validator pre-commit gate blocks ALL commits today on pre-existing repo state: negative-test ADR fixtures (`ADR-0001-Bad.md`, `ADR-0001-no-extension.md`, `ADR-0003-no-frontmatter.md`, `ADR-0004-no-status.md`) and a broken link in `docs/adrs/README.md:43` to `./_template.md`. Fresh-clone adopters cannot land a first benign commit without --no-verify. (CobaltCoast, 2026-06-10.)
- [EXP-01] [tooling-bug] Pre-commit hook auto-modifies `.gitignore` (adds `.bv/`), introducing side-effect drift on a benign commit. (CobaltCoast, 2026-06-10.)
- [EXP-03] [docs-gap] AGENTS.md never names the docs UI app (`ws_apps/docs`), its dev port (3001), or the HMR loop; fresh agents must guess from `package.json`. (CobaltCoast, 2026-06-10.)
- [EXP-03] [tooling-bug] VictoriaLogs LogsQL returns empty body for the same emission whose trace lands cleanly in VictoriaTraces; stdout log lines from `example-typescript` never surface via the documented `service.name="..." | fields ...` query. Likely missing Collector log pipeline. (CobaltCoast, 2026-06-10.)
- [EXP-03] [docs-gap] Next.js "Ready in 3s" line is misleading: first GET / blocks ~15s for first Turbopack compile, so adopters reading the line in logs assume reachability before reality. (CobaltCoast, 2026-06-10.)
- [EXP-05] [docs-gap] AGENTS.md mentions the observability-queries skill by name but never inlines a single endpoint URI; agents that never invoke the skill cannot discover the backend surface. (CobaltCoast, 2026-06-10.)
- [EXP-05] [tooling-bug] VictoriaLogs returns empty body for malformed LogsQL queries; absence of a structured error makes it hard for an agent to self-correct. (CobaltCoast, 2026-06-10.)
- [EXP-05] [workaround-found] Shared working tree + shared git index makes `git commit` sweep up another agent's staged-but-uncommitted files. Use explicit `git add <path>` and pre-commit `git diff --staged --name-only` check; long-term, run agents in per-task worktrees. (CobaltCoast, 2026-06-10.)
- [EXP-08] [docs-gap] AGENTS.md lists 3 skills but `.claude/skills/` ships 6; `chrome-devtools-deep`, `orchestrating-a-vps-agent-swarm`, and `playwright-debug` are invisible to an agent reading AGENTS.md alone. Fix: enumerate all six in AGENTS.md or auto-generate from filesystem. (CobaltCoast, 2026-06-10.)
- [EXP-08] [docs-gap] No "run-the-app" / "boot-the-dev-loop" skill exists; closest is `observability-queries` (query-only) and inline app READMEs. Root cause of the EXP-02 discoverability problem. (CobaltCoast, 2026-06-10.)
- [EXP-08] [config] The upstream `harness-engineering` plugin AGENTS.md documents is NOT vendored on this VPS; agents that try to invoke `harness-review`, `telemetry-pipeline`, etc. get a dead handle until they run the documented `git clone`. AGENTS.md should turn the install into a `just` recipe. (CobaltCoast, 2026-06-10.)
- [EXP-07] [docs-gap] AGENTS.md documents only three project-local skills, but the repo ships six SKILL.md files under `.claude/skills/`; a fresh agent misses installed skill options unless it reads filesystem state. (CobaltCoast, 2026-06-10.)
- [EXP-07] [config] `~/.claude/plugins/harness-engineering/skills` and `~/.codex/harness-engineering/skills` are absent, so upstream principle skills are link-only until manually cloned on each host. (CobaltCoast, 2026-06-10.)
- [EXP-coord] [config] Sole-editor convention violated: my EXP-05 verdict at 1ef1a74 was overwritten in working tree by a Codex peer who later committed at 36e4cf9. My verdict survives in git history but the on-disk file no longer matches. Per-agent worktrees, or a name-prefixed file convention, would prevent this. (CobaltCoast, 2026-06-10.)

