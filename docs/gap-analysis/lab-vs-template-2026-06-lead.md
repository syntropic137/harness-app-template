# Lab vs Template Gap Analysis (Lead)

Date: 2026-06-02
Author role: LEAD reviewer
Scope: Compare `harness-app-template` v0.4.0 (Standard 0.2) against the source `agentic-harness-lab` across all 11 harness slots, with deep dives on the four slots that have no dedicated `harness/` directory in the template: telemetry-sdk, agent-plugins, task-runner, secret-scanner.

Prior context (do not re-do): five gap docs already exist under `docs/gap-analysis/00..05`. Those cover harness-engineering principles, ADR migration, the Rust-port slots (stack, sensors, doc-validator, versioning), and APSS conformance. Epic `create-harness-app-n48` plus its sub-beads (`n48.1` through `n48.20`) closed against that scope on 2026-06-01.

This document focuses on what those prior docs did NOT cover: the four library-style or config-style slots that ship as references rather than as `harness/<slot>/` plugins.

## TL;DR

- Of 11 slots, 3 have NO meaningful gap (`stack-manager`, `doc-validator`, `versioning` are at parity; `hooks` and `sensors` are within minor delta covered by prior n48 work).
- The biggest unported items live in `telemetry-sdk` and `agent-plugins`.
- `telemetry-sdk`: lab ships a real shared npm package `@harness/telemetry` exporting Node, Web, and resource builders with traces, metrics, and logs wired. Template has only per-example inline stubs (TS, Python, Rust), no shared library, no metrics, no logs.
- `agent-plugins`: lab ships two extra skills (`orchestrating-a-vps-agent-swarm`, `unreal-engine-5.7-api`) and an Agent Mail MCP wiring; template has none of those. Lab has no template-hygiene hook; template has it. Both lack any cross-vendor sync tool for `.codex`/`.gemini`.
- `task-runner`: justfile shape differs by design (template is thin dispatchers to `scripts/*.ts`; lab is integrated `pnpm harness` commands). The honest gap is recipes for stack lifecycle (`stop`, `destroy`, `inspect`, `ports`) and coverage-per-language (`cov-rust`, `cov-py`, etc.) that exist in lab and are absent in template.
- `secret-scanner`: at parity. Both wire `gitleaks` via `lefthook`, both document but do not ship `.gitleaks.toml` or `.gitleaksignore`, both defer CI integration. No real port work needed.

## Overall slot map (all 11 slots)

| # | Slot | Lab state | Template state | Severity | Already tracked? |
|---|---|---|---|---|---|
| 1 | stack-manager | TS/JS, ~1,706 LOC, full impl | TS/JS, ~1,762 LOC, ported | NONE | `n48.19` closed |
| 2 | inspector | Lab: `inspector` + `inspector-ue` (Unreal variant), small | Stub scripts only | MAJOR | (open) |
| 3 | hooks | 3 hooks (`check-staged-size`, `template-hygiene-gate`, `track-perf`) | 2 hooks (missing `template-hygiene-gate`) | MINOR | (open) |
| 4 | telemetry-sdk | Shared `@harness/telemetry` package (Node + Web + resource) plus 5 polyglot inline inits (TS, Web, Rust, Python, C++) | No shared package; inline stubs in 3 example apps (TS, Python, Rust) | MAJOR | (open) |
| 5 | observability-stack | `infra/` with full otel + docker compose tiers | `infra/` plus `harness/observability/` split | MINOR | (open) |
| 6 | sensors | Rust + lab APSS canonical | TS adapters (dependency-cruiser + ts-morph) and Rust aggregator; APSS adapters wired through 2zz | NONE | `n48.3`, `n48.5`, `n48.7`, `2zz.*` closed |
| 7 | agent-plugins | 7 skills, agent-mail MCP wiring, no in-tree hooks | 5 skills, in-tree UBS PostToolUse hook, no agent-mail wiring | MAJOR | partly via `n48.10`; vendor-sync + agent-mail untouched |
| 8 | task-runner | `justfile` 295 LOC, 31 recipes, integrated with `pnpm harness` | `justfile` 70 LOC, 22 recipes, dispatches to `scripts/*.ts` | MINOR | (open) |
| 9 | secret-scanner | Lefthook wires gitleaks; no `.gitleaks.toml` shipped | Same | NONE | (none needed) |
| 10 | doc-validator | Rust crate, 702 LOC | Rust crate, 897 LOC plus npm bridge | NONE | `n48.6` open, but parity exists |
| 11 | versioning | Rust crate, 338 LOC | Rust crate, 883 LOC plus npm bridge | NONE | `n48.20` closed |

Severity scale: NONE = at parity or template strictly ahead. MINOR = small feature delta, low operator risk. MAJOR = a category of behavior present in lab is absent in template.

## Deep dive 1: telemetry-sdk

### Lab implementation

Real shared library at `packages/telemetry/`:

- `package.json`: published as `@harness/telemetry`, exports `./node`, `./web`, `./resource`, and the barrel.
- `src/node.ts`: `NodeSDK` boot with OTLP exporters for traces, metrics, AND logs; auto-instrumentation; explicit disabling of `instrumentation-net` and `instrumentation-dns` for `tsx watch` compatibility.
- `src/web.ts`: browser SDK boot with web auto-instrumentation.
- `src/resource.ts`: centralised resource attribute builder (service name, version, env).
- `src/index.ts`: barrel.
- Dependency pins: `@opentelemetry/sdk-node@0.53.0`, `@opentelemetry/sdk-trace-base ~1.26.0`, `@opentelemetry/sdk-metrics ~1.26.0`, `@opentelemetry/sdk-logs@0.53.0`, semantic conventions ~1.27.0.

Per-app consumption:

- `apps/api/src/index.ts`: `initTelemetry({service: 'api'})` from `@harness/telemetry/node`.
- `apps/web/src/main.tsx`: `initTelemetry({service: 'web'})` from `@harness/telemetry/web`.
- `apps/api-rust/src/main.rs`: inline OTel boot via `opentelemetry 0.31.0` + `opentelemetry-otlp` + `tracing-opentelemetry`.
- `apps/api-py/src/main.py`: inline OTel boot via `opentelemetry-sdk 1.x` + OTLP HTTP exporter.
- `apps/api-cpp/src/main.cpp`: inline OTel boot via `opentelemetry-cpp 1.26.0` + OTLP HTTP exporter.
- Decision doc: `docs/standard/decisions/telemetry-sdk.md`.

### Template state

Per-example inline stubs only; `ws_packages/` contains a `.gitkeep` and nothing else:

- `ws_apps/example-typescript/src/telemetry.ts`: standalone SDK builder (lazy provider construction; traces only, no metrics, no logs).
- `ws_apps/example-python/src/example_python/telemetry.py`: standalone init.
- `ws_apps/example-rust/src/telemetry.rs`: standalone `build_provider()` + `init()` split.
- No web/browser example.
- No C++ example.
- No shared resource builder; each example duplicates the attribute assembly.
- `docs/adrs/ADR-0004-telemetry-sdk.md` is content-equivalent to the lab decision.

### Port requirement

PORT REQUIRED. The honest delta is a missing shared library and the missing metrics + logs wiring.

Concrete actions:

1. Lift `lab/packages/telemetry/` to `template/ws_packages/telemetry/` (rename package to `@template/telemetry` or keep `@harness/telemetry`). Drop in with zero path changes; deps are identical OTel families.
2. Refactor each example to `import { initTelemetry } from '@harness/telemetry/<surface>'` instead of duplicating SDK boot. Keep the inline pattern available as a comment block for teaching value if desired.
3. Decide whether to add the web/browser and C++ inline examples (low value for a polyglot template if you accept TS+Py+Rust as the demonstration set; high value if you want signal parity with the lab).
4. Wire traces + metrics + logs everywhere `OTEL_*` env vars resolve. Today only traces are wired.

Lift difficulty: LOW for the shared package; LOW for refactoring examples; MEDIUM if you also want the C++ example because vcpkg pinning at 1.26.0 is sensitive.

Bead candidate (one bead): "Port `packages/telemetry` shared library and metrics+logs wiring from lab".

## Deep dive 2: agent-plugins

### Lab implementation

`.claude/` directory contents:

- 7 skills: `before-after-evidence`, `chrome-devtools-deep`, `observability-queries`, `orchestrating-a-vps-agent-swarm`, `playwright-debug`, `running-experiments`, `unreal-engine-5.7-api`.
- `orchestrating-a-vps-agent-swarm` is a domain skill the operator clearly cares about (the surrounding VPS workflow in this very session relies on the practice it describes). Currently NOT in template.
- `unreal-engine-5.7-api` is domain-niche (Unreal Engine) and includes 9 reference docs. Lower portability value for a generic template.
- `running-experiments` ships 4 reference docs (audit-checklist, canonical-scripts, preflight, scorecard-template); these exist in both.
- `settings.local.json` wires `mcp-agent-mail` MCP server via HTTP (`http://127.0.0.1:8765/mcp/`, Bearer token). This is how the lab coordinates swarms; the template has NO equivalent wiring.
- No in-tree Claude Code hooks (no `.claude/hooks/`).
- No `commands/` or `subagents/` directories.
- No vendor mirrors (`.codex`, `.gemini`) directly, though the operator workflow uses both.

### Template state

`.claude/` directory contents:

- 5 skills: `before-after-evidence`, `chrome-devtools-deep`, `observability-queries`, `playwright-debug`, `running-experiments`.
- `settings.json` wires a PostToolUse hook to `.claude/hooks/ubs-diff.sh` (Ultimate Bug Scanner diff on every file write). This is a TEMPLATE INNOVATION not present in lab; the lab has nothing equivalent.
- No `mcp-agent-mail` wiring. Operators forking the template lose coordination machinery the lab used.
- No vendor sync recipe; the `just agents link` recipe pattern from CLAUDE.md description does not yet exist in `justfile`.
- ADR-0007-agent-plugins.md exists.

### Port requirement

PORT REQUIRED, partial. Three honest sub-gaps:

1. PORT `orchestrating-a-vps-agent-swarm` skill from lab. High value; the VPS workflow this template targets uses it.
2. DECIDE on `unreal-engine-5.7-api`. Recommendation: keep it in lab, do NOT port to a generic template; let consumer forks add it if needed. Domain-niche skills should live downstream.
3. PORT agent-mail MCP wiring as an OPT-IN. Either ship a `.claude/settings.local.example.json` snippet documenting the URL pattern, or add a `just agents link-mail` recipe that writes the local file. Do not commit the Bearer token.
4. BACKPORT the in-tree `ubs-diff.sh` PostToolUse hook into the lab. Lab loses out on this.
5. ADD a `just agents link` recipe that symlinks `.codex`, `.gemini`, and `AGENTS.md` to the canonical `.claude/` and `CLAUDE.md`. CLAUDE.md describes the rule but the recipe is not in the template's justfile.

Note: bead `create-harness-app-n48.10` already opens skills-audit work but does not cover agent-mail or vendor-mirror sync.

Bead candidates: one bead for the skill port, one bead for the agent-mail wiring snippet, one bead for the vendor-mirror sync recipe.

## Deep dive 3: task-runner

### Lab implementation

`justfile`: 295 lines, 31 recipes, integrated with `pnpm harness`. Recipe families:

- Stack lifecycle: `boot`, `stop`, `destroy`, `inspect`, `ports`.
- Doctor: `doctor`, `doctor-explain`, `doctor-json`.
- Unreal install chain: `install-cpp-unreal`, `install-cpp-unreal-dry`, `epic-status`, `epic-disable`, `epic-enable`, `ue-link-plugin`.
- Dev / QA: `test`, `test-coverage`, `typecheck`, `lint`, `lint-fix`, `qa`.
- Sentrux submodule: `bootstrap-sentrux`, `bump-sentrux`, `verify-sentrux-patched`.
- Coverage gates per language: `cov-rust`, `cov-doc-validator`, `cov-versioning`, `cov-sensors`, `cov-py`.
- Other: `bootstrap-harness`, `scaffold`, `recipes`.

No `import` or `include` directives.

### Template state

`justfile`: 70 lines, 22 recipes, all thin dispatchers to `scripts/*.ts`. Recipe set:

- `bootstrap`, `build`, `test`, `lint`, `doctor`, `harness-engineering-skills`, `review`, `boot`, `init`, `update`, `stack`, `inspector`, `sensors`, `doc-validator`, `versioning`, `release-check`, `release-plan`, `release-dry-run`, `release-apply`, `cargo`, `uv`.

Template recipes that lab does NOT have: `harness-engineering-skills`, `review`, `init`, `update`, `release-*` (4), `cargo`, `uv`, `harness-engineering-skills`, slot-pass-through wrappers (`stack`, `inspector`, `sensors`, `doc-validator`, `versioning`).

### Port requirement

PORT REQUIRED, selective. Most lab recipes are lab-environment-specific (Unreal, sentrux submodule) and SHOULD NOT be ported. The honest gaps are:

1. Stack lifecycle pass-throughs: `stop`, `destroy`, `inspect`, `ports`. Template only has `boot` and `stack`. The lab's `stop`, `destroy`, `inspect`, `ports` are useful for operator-driven container debugging and should be exposed.
2. `doctor-explain` and `doctor-json` are useful variants for human-readable + machine-readable doctor output. Template has only `doctor`.
3. `test-coverage`, `typecheck`, `lint-fix`, `qa`: these are quality-of-life. Template has `test`, `lint` but not `test-coverage`, `lint-fix`, or a `qa` umbrella. Worth porting.
4. Per-language coverage gates: lab has `cov-rust`, `cov-py`, `cov-doc-validator`, `cov-versioning`, `cov-sensors`. ADR-0013 in template covers the coverage-enforcement policy, but the recipe-level enforcement layer is absent. Worth porting once doctor + sensors are stable.

Skip: `install-cpp-unreal*`, `epic-*`, `ue-link-plugin`, `bootstrap-sentrux`, `bump-sentrux`, `verify-sentrux-patched`. Lab-environment-specific.

Bead candidates: one bead for stack lifecycle recipe pass-throughs, one bead for QA recipe family, one bead for per-language coverage gates.

## Deep dive 4: secret-scanner

### Lab implementation

- `lefthook.yml` block runs `gitleaks protect --staged --no-banner --redact` graceful-degrade if `gitleaks` is on PATH.
- Decision doc at `templates/polyglot-monorepo/files/docs/decisions/secret-scanner.md` (gitleaks 8.x, MIT, 700+ patterns).
- `security.md` Control section 5 documents pre-commit (staged), CI full-tree, and history scan policy.
- No `.gitleaks.toml`. No `.gitleaksignore`. No wrapper script. No CI step wired.

### Template state

- `lefthook.yml` block runs `gitleaks protect --staged --redact --no-banner` graceful-degrade via `sh -eu -c`.
- ADR-0009-secret-scanner.md mirrors lab decision content.
- `security.md` Control section 5 mirrors lab policy text.
- No `.gitleaks.toml`. No `.gitleaksignore`. No wrapper. No CI step wired.

### Port requirement

NO PORT REQUIRED. The two repos are at semantic parity. Both intentionally defer custom-allowlist and CI integration to downstream consumers.

If anything, a SOFT improvement is to ship a `.gitleaksignore.example` to make the allowlist convention discoverable without committing live noise. This is a polish task, not a port. No bead needed.

## Slots covered by prior n48 work (cross-reference)

For completeness, the other 7 slots:

- `stack-manager`: ported via `n48.19`. Parity.
- `inspector`: still stubbed in template (only vitest config). The lab inspector is itself thin and includes the Unreal variant. Recommend deferring; not a real gap if the use case is non-Unreal.
- `hooks`: lab has a `template-hygiene-gate` JS hook the template lacks. Small porting task, defer until template-hygiene policy is firmed up.
- `observability-stack`: split across `infra/` and `harness/observability/` in template. Functionally complete; minor consolidation opportunity, not a port gap.
- `sensors`: ported, plus 2zz APSS-adapter wave is closed.
- `doc-validator`: parity. `n48.6` is still open for full ADR enforcement, but the binary itself is at parity.
- `versioning`: ported via `n48.20`. Parity.

## Open questions for reviewers

1. Should `@harness/telemetry` keep the namespace `@harness/` or be re-namespaced to `@template/` to avoid confusion with the upstream lab package on a future npm publish?
2. Is the agent-mail MCP wiring an opt-in (env var + example file) or opt-out (committed snippet plus disable knob)? Bearer token must NOT be checked in either way.
3. Should we backport the template's `.claude/hooks/ubs-diff.sh` PostToolUse hook to the lab, or is the lab deliberately UBS-free?
4. Do we want per-language coverage recipes (`cov-rust`, `cov-py`, etc.) in the template now, or do we wait until ADR-0013 has matured into a per-language enforcement model?

## Recommended next actions

This round is analysis only. No implementation work begins until the orchestrator synthesizes all five gap reports and the human operator chooses what to wire. The list below is a SUGGESTED ordering for the orchestrator and decision-maker to weigh, not an action plan.

1. Treat `create-harness-app-port-telemetry-shared-lib-zot` and `create-harness-app-port-vps-swarm-skill-ff1` (both P1) as the highest leverage if the operator wants to close the largest behavior gap with the lab.
2. Agent-mail wiring (`agent-mail-wiring-example-fzr`) and the vendor-mirror sync recipe (`vendor-mirror-link-recipe-w66`) are coordination plumbing the template already advertises in `CLAUDE.md`; consider grouping with the P1 swarm-skill bead.
3. Task-runner items (`port-stack-lifecycle-recipes-tds`, `port-qa-recipe-family-my3`, `per-language-coverage-recipes-efv`) are independent and can be sequenced last.
4. P3 / P4 polish items (`gitleaksignore-example-0ry`, `inspector-real-impl-4o0`, `port-template-hygiene-hook-rh2`, `consolidate-observability-roots-w0b`, `coord-backport-ubs-diff-to-lab-g0y`) can ride as opportunistic grooming.

## Status

LEAD analysis complete. Waiting on the orchestrator. Will not start any bead until the human operator decides scope.

## Beads filed against this analysis

Twelve beads filed on 2026-06-02, cross-linked to this doc.

### From the four-slot deep dives

| ID | Priority | Slot | Title |
|---|---|---|---|
| `create-harness-app-port-telemetry-shared-lib-zot` | P1 | telemetry-sdk | Port `packages/telemetry` shared library + metrics/logs wiring from lab |
| `create-harness-app-port-vps-swarm-skill-ff1` | P1 | agent-plugins | Port `orchestrating-a-vps-agent-swarm` skill from lab `.claude/skills/` |
| `create-harness-app-agent-mail-wiring-example-fzr` | P2 | agent-plugins | Add agent-mail MCP wiring as opt-in example (no committed token) |
| `create-harness-app-vendor-mirror-link-recipe-w66` | P2 | agent-plugins / task-runner | Implement `just agents link` recipe for `.codex` / `.gemini` / `AGENTS.md` vendor symlinks |
| `create-harness-app-port-stack-lifecycle-recipes-tds` | P2 | task-runner | Add `just stop/destroy/inspect/ports` pass-through recipes from lab |
| `create-harness-app-port-qa-recipe-family-my3` | P3 | task-runner | Add `test-coverage` / `lint-fix` / `typecheck` / `qa` umbrella recipes |
| `create-harness-app-per-language-coverage-recipes-efv` | P3 | task-runner | Port `cov-rust` / `cov-py` / `cov-doc-validator` / `cov-versioning` / `cov-sensors` recipes |
| `create-harness-app-gitleaksignore-example-0ry` | P4 | secret-scanner | Ship `.gitleaksignore.example` so allowlist convention is discoverable |
| `create-harness-app-coord-backport-ubs-diff-to-lab-g0y` | P4 | agent-plugins (lab-side coord) | Coordinate with lab: backport template's `ubs-diff` PostToolUse hook |

### From the overall slot map (MINOR / MAJOR rows not yet tracked)

| ID | Priority | Slot | Title |
|---|---|---|---|
| `create-harness-app-inspector-real-impl-4o0` | P3 | inspector | Inspector slot: replace stub with a real evidence-capture implementation |
| `create-harness-app-port-template-hygiene-hook-rh2` | P3 | hooks | Port `template-hygiene-gate` hook from lab `harness/hooks/` |
| `create-harness-app-consolidate-observability-roots-w0b` | P3 | observability-stack | Consolidate observability-stack config: `infra/` vs `harness/observability/` |

### Coverage audit (every gap I called maps to a bead)

| Gap surfaced in this doc | Severity | Bead ID | Notes |
|---|---|---|---|
| telemetry-sdk: missing shared `@harness/telemetry` package, metrics, logs | MAJOR | `port-telemetry-shared-lib-zot` | Single bead covers shared lib + metrics + logs |
| telemetry-sdk: missing web and C++ inline examples | MINOR | (folded into above) | Scope decision lives in the same bead |
| agent-plugins: missing `orchestrating-a-vps-agent-swarm` skill | MAJOR | `port-vps-swarm-skill-ff1` | |
| agent-plugins: missing `unreal-engine-5.7-api` skill | N/A | (deliberate non-port) | Domain-niche; do not port |
| agent-plugins: missing agent-mail MCP wiring | MAJOR | `agent-mail-wiring-example-fzr` | |
| agent-plugins: missing `just agents link` recipe | MAJOR | `vendor-mirror-link-recipe-w66` | |
| agent-plugins: ubs-diff hook absent in lab | (lab-side) | `coord-backport-ubs-diff-to-lab-g0y` | Cannot be implemented here |
| task-runner: missing `stop/destroy/inspect/ports` recipes | MINOR | `port-stack-lifecycle-recipes-tds` | |
| task-runner: missing `test-coverage`/`lint-fix`/`typecheck`/`qa` | MINOR | `port-qa-recipe-family-my3` | |
| task-runner: missing per-language coverage recipes | MINOR | `per-language-coverage-recipes-efv` | |
| task-runner: missing `doctor-explain` and `doctor-json` variants | MINOR | (folded into stack-lifecycle bead) | Same scripts/doctor.ts surface |
| task-runner: Unreal install + sentrux recipes | N/A | (deliberate non-port) | Environment-specific |
| secret-scanner: no committed `.gitleaks.toml` / `.gitleaksignore` | NONE | `gitleaksignore-example-0ry` | Polish, not a port; both repos absent |
| inspector slot stub | MAJOR | `inspector-real-impl-4o0` | |
| hooks: missing `template-hygiene-gate` | MINOR | `port-template-hygiene-hook-rh2` | |
| observability-stack: split between `infra/` and `harness/observability/` | MINOR | `consolidate-observability-roots-w0b` | |
| stack-manager / sensors / doc-validator / versioning | NONE | (prior n48 work) | Already at parity |
