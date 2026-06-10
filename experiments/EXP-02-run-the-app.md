# EXP-02 run-the-app

Claim: claude-opus-4-7, 2026-06-10, branch feat/apss-integration. Sole-editor; do not edit from other agents.

## Question
Using ONLY AGENTS.md and the .claude/skills/ surface (no source diving, no upstream lab repo), can a fresh agent start "the app" frontend + backend on this fork, reach it, and observe it succeed? Where are the gaps? Time the discovery + boot.

## Hypothesis (frozen before any probe)
This is the second adopter promise after EXP-01 boot: the agent must be able to get a running app from documentation alone. I predict:

1. **P1 AGENTS.md never names "the app".** The phrase "the app", "the example app", "ws_apps/example-typescript", or any concrete pointer to a runnable unit does NOT appear in AGENTS.md. AGENTS.md mentions `ws_apps/` exists as the workspace layout but offers no "start here" runnable. Confidence: HIGH (already scanned).
2. **P2 No "frontend" exists in this fork.** Searching `ws_apps/` for any web UI shows only the three example apps (typescript, python, rust), all of which are headless emit-a-span hello-worlds. The roadmap's "frontend + backend" presupposes a frontend that this bare template does NOT ship. Confidence: HIGH.
3. **P3 Backend app discoverable in <= 3 steps of in-tree reads.** The agent can reach a runnable command set by: (a) reading AGENTS.md, (b) listing ws_apps/, (c) reading the example app's README.md. Step count <= 3. Confidence: HIGH.
4. **P4 Backend boot succeeds.** Following the example-typescript README literally: `just stack boot` then `eval "$(just stack ports)"` then `pnpm --filter @example/typescript start` produces a process that exits 0 (or runs to completion if it is a one-shot emitter) AND emits at least one observable trace/log signal. Confidence: MEDIUM. Risk: stack boot has runtime deps (docker / podman) that may or may not be present on this host; ports may collide; pnpm workspace filter may require a fresh `pnpm install`.
5. **P5 Time-to-running <= 600s wall-clock from "start reading AGENTS.md" to "process running and emitting" assuming docker is up. Confidence: MEDIUM.
6. **P6 The skill `observability-queries` covers the "reach it" half.** The agent can confirm the app emitted signal via the canonical LogsQL query documented in the observability-queries skill. Confidence: HIGH (skill exists).

Composite prediction:
- **CONFIRMED** if P1, P2 hold (gap surfaced honestly), AND P3, P4, P6 hold (path is reachable).
- **PARTIAL** if P4 fails because of stack-boot env (docker missing) but P3 + P6 hold (path is discoverable but blocked by infra).
- **FALSIFIED** if P3 fails (path is NOT discoverable from AGENTS.md + skills).

## Setup
- Working tree: `/data/projects/harness-lab`, branch `feat/apss-integration`.
- Tools available: just, pnpm, bun, docker, podman (check).
- Coordination: EXP-01 staged but not committed by another agent (CobaltCoast); I do NOT touch their files.
- N = 1 host.

## Probes (frozen)
- **R1**: `grep -iE "the app|example-typescript|ws_apps/example" AGENTS.md` and score P1.
- **R2**: `find ws_apps -maxdepth 4 -iname '*frontend*' -o -iname 'index.html' -o -iname 'vite.config*' -o -iname 'next.config*'` to score P2.
- **R3**: time the discovery path explicitly: read AGENTS.md > read ws_apps/ listing > read ws_apps/example-typescript/README.md. Capture wall-clock and step count.
- **R4**: `command -v docker podman pnpm just` then execute the example-typescript boot recipe and capture exit code + stdout/stderr + wall-clock.
- **R5**: After R4, query the observability stack per the observability-queries skill (LogsQL filter on `service.name="example-typescript"`) and confirm at least one event arrived.
- **R6**: Score using the literal step count from R3 (steps to reach the runnable command) AND wall-clock from R4 + R5.

## Out of scope
- The Rust + Python example apps.
- Any frontend (because none ships in this fork, per P2 prediction).
- Performance under load.
- Cross-host repeatability.

## Expected signals
- R1 returns 0 lines (or only mentions ws_apps/ in passing, never "the app").
- R2 returns 0 frontend artifacts.
- R4 prints process output AND stack boot output without docker errors; pnpm run exits with 0 or runs the emitter to completion.
- R5 returns >= 1 row in the LogsQL projection.

## Verdict
TBD until probes run. See VERDICT section appended below after the run.
