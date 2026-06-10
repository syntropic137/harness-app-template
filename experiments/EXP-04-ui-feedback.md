# EXP-04 UI feedback

Claim: claude-opus-4-7 on /data/projects/harness-lab feat/apss-integration, 2026-06-10T03:50:00+02:00. Sole-editor; do not edit from other agents.

## Question
Can a fresh agent drive the running UI of this fork and confirm an observable assertion using the tooling the harness advertises (playwright-debug + chrome-devtools-deep skills)? Can the agent SEE the frontend, or is it limited to byte-level HTTP introspection?

## Hypothesis (frozen before any probe)
The fork ships a Next.js + Fumadocs docs site at ws_apps/docs (port 3001, hardcoded in package.json). The .claude/skills/playwright-debug/SKILL.md asserts "Playwright is installed at the workspace root (playwright devDep)" and points at a bundled Chromium cache. I predict:

1. **P1 Playwright is NOT installed at workspace root.** Despite the skill's claim, `pnpm exec playwright --version` returns ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL or "command not found". `find node_modules -name 'playwright' -maxdepth 4` at root returns 0. Confidence: HIGH (already scanned in pre-flight).
2. **P2 Bundled Chromium IS on disk.** `/home/ubuntu/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome` exists and is executable, suggesting Playwright was once installed but its node bindings are absent in the current workspace. Confidence: HIGH (already scanned).
3. **P3 docs frontend reachable on port 3001.** `curl -sI http://localhost:3001/` returns HTTP 200 with `X-Powered-By: Next.js` header. Confidence: HIGH (already observed in pre-flight before this hypothesis was written; the bytes were not used to construct the prediction beyond "is the server up").
4. **P4 HTML body contains discoverable docs content.** A GET to http://localhost:3001/ returns HTML that includes recognizable Fumadocs UI markers (the literal string "fumadocs", a navigation root, OR project-specific landing copy referring to "harness", "standard", or "doc-validator"). At least ONE of these markers appears. Confidence: MEDIUM.
5. **P5 Fallback observable assertion is meaningfully cheaper than installing Playwright.** Total wall-clock to confirm "frontend is serving content" via curl + grep is < 5 seconds. The equivalent Playwright path (pnpm add -D playwright, npx playwright install, write a .mjs, run it) costs > 60 seconds (assumes the binary cache already exists). Confidence: MEDIUM.
6. **P6 No project-level UI recipe.** `just --list` shows no `docs`, `ui`, `screenshot`, or `ui:screenshot` recipe. The discovery path for "drive the frontend" is entirely skill-mediated and skill-broken (per P1). Confidence: HIGH (already grep-able pre-flight).

Composite prediction:
- **CONFIRMED** if P1, P2, P3, P4, P6 all hold AND P5 holds (fallback works in <5s).
- **PARTIAL** if P3 or P4 fails (UI not actually reachable / contentless) but tooling gap (P1) is real.
- **FALSIFIED** if P1 fails (Playwright actually IS installed) — would mean the skill body is accurate after all.

## Setup
- Working tree: `/data/projects/harness-lab`, branch `feat/apss-integration`.
- Stack already booted from earlier work (now-concluded EXP-02 probes). Ports allocated for this worktree (`just stack ports` output captured below in run section).
- Docs frontend assumed to be the one already serving on port 3001 (visible via `curl -sI http://localhost:3001/` returning HTTP 200 with Next.js header during pre-flight). The 3001 port is hardcoded in `ws_apps/docs/package.json:scripts.dev`, NOT per-worktree isolated by the stack-manager.
- Coordination note: Codex clobbered EXP-02 (5a455e6) after my 9deec67 hypothesis commit; I conceded that number. This experiment is a fresh, cleanly-claimed slot.
- N = 1 host.

## Probes (frozen)
- **R1**: `pnpm exec playwright --version` at workspace root + `find node_modules -maxdepth 4 -name 'playwright'`. Score P1.
- **R2**: `ls /home/ubuntu/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome`. Score P2.
- **R3**: `curl -sI http://localhost:3001/` and capture status code + key headers. Score P3.
- **R4**: `curl -s http://localhost:3001/ | head -200` and `grep -iE "fumadocs|harness|standard|doc-validator|next"` over the response. Score P4 by counting matches.
- **R5**: time wall-clock for the R3 + R4 combined path. Score P5 via the < 5s threshold.
- **R6**: `just --list 2>&1 | grep -iE "docs|ui|screenshot|browser"`. Score P6 by hit count.

## Out of scope
- Installing Playwright to attempt a real browser session (the experiment is about what the harness ships as-is, not what an agent could rebuild).
- Driving any backend UI (none exists beyond emit-then-exit hello-worlds).
- Cross-host repeatability of the bundled-Chromium cache path.

## Expected signals
- R1 errors out (no playwright in workspace).
- R2 prints a single path (binary exists).
- R3 returns 200 OK with Next.js headers.
- R4 returns at least 1 recognizable docs marker.
- R5 total wall-clock <= 5s.
- R6 returns 0 recipes.

## Verdict
TBD until probes run. See VERDICT section appended after the run.
