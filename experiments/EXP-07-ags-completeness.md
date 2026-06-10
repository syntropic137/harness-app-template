# EXP-07 AGENTS.md completeness
# CLAIM: 2026-06-10T03:40:00Z by Codex

## Hypothesis (frozen)
A fresh agent can answer almost all adopter questions from AGENTS.md and the 3 project-local skills.

## Prediction
Most gaps are minor; questions about source-only details will be at most 1-2 and mostly around frontend start scripts and browser feedback tooling.

## Probe plan
1. Parse AGENTS.md and all `.claude/skills/*/SKILL.md` for commands for bootstrap/stack/app feedback.
2. Cross-check whether each roadmap question from EXP-07 can be answered without reading source files.
3. Record concrete gaps and any guesses required.

## Probe outputs (recorded 2026-06-10)
- `find .claude/skills -maxdepth 2 -name SKILL.md | sort` -> 6 files:
  - `before-after-evidence`
  - `chrome-devtools-deep`
  - `observability-queries`
  - `orchestrating-a-vps-agent-swarm`
  - `playwright-debug`
  - `running-experiments`
- AGENTS.md advertises only 3 project-local skills (`running-experiments`, `observability-queries`, `before-after-evidence`).
- `README.md` advertises 5 project-local skills and includes `playwright-debug` and `chrome-devtools-deep`.
- `rg` across `.claude/skills/*/SKILL.md` found no explicit "boot the app / start the dev loop" skill and no obvious single dispatch named to "run the whole app".
- `ls ~/.claude/plugins/harness-engineering/skills` -> `No such file or directory`.
- `ls ~/.codex/harness-engineering/skills` -> `No such file or directory`.
- `rg` in `AGENTS.md` for start/ports shows only command skeletons (`just bootstrap`, `just stack boot`, `just stack ports`, `just inspector --help`) and no direct port map for web/UI entry.

## Observed questions requiring source probing (fresh-agent perspective)
- Count of actual skills in `.claude/skills/` vs advertised skill list.
- Discovery of all available tooling beyond AGENTS' 3-item list.
- Whether the upstream `harness-engineering` plugin is actually installed locally.
- Whether there is a dedicated "boot/run app stack" skill; none found in AGENTS/skills corpus.
- App/stack startup command detail is still fragmented across AGENTS, README and skill files, not centralized in one "start-here" checklist.

## Verdict
- Composite prediction: FALSIFIED.
- AGENTS.md alone does not let a fresh agent answer all practical onboarding questions. The largest gap is discoverability mismatch: 6 installed `.claude/skills` SKILL.md files exist while AGENTS.md documents only 3, and a missing local check around plugin installation status can silently derail advanced operations.
- Friction score: moderate.

## Reusable empirical claims
- At probe time, `.claude/skills/` held six SKILL.md files; AGENTS lists three for direct invocation.
- `~/.claude/plugins/harness-engineering/skills` and `~/.codex/harness-engineering/skills` were absent on this host.
- No SKILL.md explicitly covered "boot the app loop" as a first-class command.
