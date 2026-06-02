# harness-app-template fork-readiness: design

- Date: 2026-06-02
- Status: design (approved by operator, pending writing-plans)
- Author: orchestrator (Mac launchpad), from VPS swarm findings

## Context

Two experiments on 2026-06-02 produced the findings this program addresses:

1. A dogfood build: a fresh-from-GitHub clone of the template, where one agent
   built a `GET /quote` HTTP service and journaled every friction point. Source:
   [dogfood friction journal](../../gap-analysis/dogfood-quote-api-friction-2026-06.md)
   (11 findings, 3 high severity).
2. A lab-vs-template gap analysis across all 11 harness slots. Source:
   [lead gap map](../../gap-analysis/lab-vs-template-2026-06-lead.md) and the
   per-area gap docs alongside it.

The Claude happy-path works and full-pipeline traces and metrics round-tripped.
But a fresh fork is red out of the box, and non-Claude vendors (Codex, Gemini)
land with no agent context. Both experiments converge on the same weak spot:
multi-vendor onboarding plus shared telemetry.

## Goal

Make a freshly forked harness-app-template genuinely usable from minute zero:
the inner loop is green on a clean clone, and any vendor lands with full context
and working observability.

## Program decomposition

Four workstreams, each its own spec, plan, and implementation cycle. This
document details WS1 to implementation depth; WS2 to WS4 are captured at summary
depth here so the findings are not lost, and each gets its own spec later.

| WS | Title | Priority | Core sources |
|----|-------|----------|--------------|
| WS1 | Fresh green forks | P0 | dogfood F-001, F-004, F-005, F-006, F-007, F-008, F-009, F-011 |
| WS2 | Telemetry-SDK shared library | P1 | gap `telemetry-sdk` (MAJOR); dogfood F-010 |
| WS3 | Agent-plugins / multi-vendor context | P1 | gap `agent-plugins` (MAJOR); dogfood F-001 |
| WS4 | Parity cleanup | P2 | gap `inspector` (MAJOR), `task-runner`, `hooks` |

Cross-cutting decisions (apply to all workstreams):

- `AGENTS.md` is the single canonical agent-context file. `CLAUDE.md`,
  `GEMINI.md`, `.codex/*`, `.gemini/*` are committed symlinks pointing at it.
  Bootstrap verifies and repairs the symlinks; it does not create them from
  scratch.
- The fork-readiness bar is the full local loop: `just bootstrap && just test &&
  just lint` plus the sensors gate, all green on a fresh clone.

---

## WS1: Fresh green forks (detailed)

### Acceptance

A fresh `git clone` of the template, on the VPS agent environment, passes:

```
just bootstrap   # exit 0, or fails with an actionable missing-tool message
just test        # exit 0, all workspace members
just lint          # exit 0 (typecheck)
sensors gate     # green
```

Regression test: re-run the dogfood (fresh clone, build a small app) and the
friction journal should come back effectively empty for the WS1-scoped items.

### Units

Each unit is independently implementable and verifiable.

#### Unit A: Bootstrap runs clean (F-004, F-005)

- F-005: `just bootstrap` dies in `esbuild@0.21.5`'s postinstall on a
  binary/cache version mismatch and needs a manual `cp` workaround. Fix the root
  cause: pin esbuild to a coherent version across the workspace, or clear and
  rebuild the esbuild platform binary in bootstrap, so `pnpm install` completes
  unattended.
- F-004: when a required tool is missing, bootstrap prints `pnpm install failed
  with undefined`. Replace with a preflight that names the missing tool and how
  to install it: `missing required tool: pnpm (install via corepack enable / npm
  i -g pnpm)`.
- Acceptance: `just bootstrap` exits 0 on a fresh clone with required tools
  present, or exits non-zero with an actionable message naming the missing tool.

#### Unit B: AGENTS.md canonical plus committed symlinks (F-001, F-006)

- Flip canonical from `CLAUDE.md` to `AGENTS.md`: move the content so `AGENTS.md`
  is the real file.
- Commit symlinks `CLAUDE.md`, `GEMINI.md`, `.codex/*`, `.gemini/*` pointing at
  `AGENTS.md`, so they exist the instant the repo is cloned.
- Bootstrap verifies and repairs these symlinks idempotently (F-006: stop
  claiming bootstrap creates them when it does not; make the claim true via
  verify-and-repair, and document accurately).
- Update README and any doc that describes the vendor-context scheme.
- Acceptance: a fresh clone has `AGENTS.md` as a real file plus working symlinks;
  a Codex or Gemini agent reads full context with zero setup.

#### Unit C: `just test` green on a clean clone (F-008)

- `@harness/inspector` declares `vitest run` but ships no `tests/` directory, so
  `just test` exits non-zero on a clean clone. Add a minimal smoke test for the
  inspector slot (it is a real slot; a smoke test is the honest fix).
- Audit every workspace member for the same declares-test-ships-none trap and
  fix each (smoke test, or a vitest passWithNoTests config where a stub is
  intentional and documented).
- Acceptance: `just test` exits 0 on a fresh clone.

#### Unit D: qa and sensors gate green (F-007, F-009)

- F-007: the per-app 100 percent coverage policy currently lives in a comment in
  `example-typescript/vitest.config.ts`. Make the policy explicit: documented in
  the template docs and applied consistently so new `ws_apps` members inherit it
  on purpose, not by silent default.
- F-009: adding a non-trivial app trips the sensors gate on the MD01 instability
  counter, and the expected `--update-baseline` fix is buried under the ASCII
  banner and unrelated info findings. Surface the gate verdict line clearly, and
  document the new-module baseline-update flow so adding an app does not
  mystery-fail.
- Acceptance: `just lint` and the sensors gate are green on a fresh clone, with the
  documented new-module flow.

#### Unit E: polish (F-011, F-002, F-003)

- F-011: `just stack --help` prints help then exits 1. Make help exit 0.
- F-002: signpost `just` as the canonical per-member task surface in the README
  (versus `pnpm`/`turbo`), so a newcomer does not guess.
- F-003: clarify that `ws_apps/docs` is a workspace member, not a docs folder
  (rename or signpost).

### Boundaries (explicitly not WS1)

- F-010 (collector has no filelog receiver and the Node SDK does not export logs,
  so stdout JSON never reaches VictoriaLogs): belongs to WS2 (telemetry-sdk).
- Agent Mail MCP wiring and the `orchestrating-a-vps-agent-swarm` skill: WS3.
- A full inspector implementation: WS4. WS1 only adds the inspector smoke test
  needed to make `just test` green.

### Testing and verification

- The acceptance test is a fresh re-clone plus the full local loop.
- Where a fix is mechanical and regressible, add a check (a doctor-style probe or
  a unit test). The dogfood is the integration harness: re-run it after WS1 and
  confirm the WS1 findings are gone.

---

## WS2: Telemetry-SDK shared library (summary)

Port the lab's real shared package `@harness/telemetry` (Node, Web, and resource
builders; traces, metrics, AND logs). The template today has only per-example
inline stubs (traces only), and `ws_packages/` is empty. This also fixes dogfood
F-010 (logs never reach VictoriaLogs). Full spec later.

## WS3: Agent-plugins / multi-vendor context (summary)

Port the lab's Agent Mail MCP wiring and the `orchestrating-a-vps-agent-swarm`
skill, plus close the skill-count gap (lab has more skills than the template).
With WS1's committed vendor symlinks, this is the other half of making
non-Claude agents productive on a fork. Full spec later.

## WS4: Parity cleanup (summary)

Inspector is a stub today (lab has a real implementation); task-runner is missing
the lab's stack-lifecycle recipes (`stop`, `destroy`, `inspect`, `ports`) and
per-language coverage recipes; the `template-hygiene-gate` hook is absent. Full
spec later.

## Decisions log

- 2026-06-02: structure is one umbrella doc plus WS1 detailed first (operator).
- 2026-06-02: green-fork bar is the full local loop, not a CI-enforced re-clone
  job for WS1 (operator). A CI green-fork gate is a candidate follow-up.
- 2026-06-02: `AGENTS.md` canonical, vendor files are committed symlinks off it
  (operator).
