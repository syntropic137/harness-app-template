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

