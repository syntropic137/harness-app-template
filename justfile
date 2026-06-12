# Agentic Harness template canonical task surface.
#
# Recipes stay thin by design: implementation lives in typed scripts under
# scripts/*.ts so the behavior is testable and shared across entrypoints.
#
# Discovery: `just` lists every recipe with a one-line description, grouped
# by phase (setup, loop, gates, stack, coverage, release, polyglot, meta).
# An adopter typically walks: setup -> loop -> gates -> release.

# List every recipe with its group and one-line description (default).
default:
    @just --list

# --- setup -----------------------------------------------------------------

# One-shot template init: rename seeds, write provenance, drop scaffolding doc.
[group('setup')]
init project-name:
    bun run scripts/init.ts {{project-name}}

# Install all language toolchains and lockfiles. Run after `just init`.
[group('setup')]
bootstrap *args:
    bun run scripts/bootstrap.ts {{args}}
    just config check

# Diagnose missing tools and stale provenance (read-only preflight).
[group('setup')]
doctor *args:
    bun run scripts/doctor.ts {{args}}

# Link agent vendor manifests (`link`) or sync the generated AGENTS.md skill list (`skills`, `--write` to regenerate).
[group('setup')]
agents action="link" *args:
    @if [ "{{action}}" = "link" ]; then bun run scripts/agents-link.ts {{args}}; elif [ "{{action}}" = "skills" ]; then bun run scripts/agents-skills.ts {{args}}; else echo "unknown agents action: {{action}}" >&2; exit 64; fi

# Pull latest harness changes from the upstream template.
[group('setup')]
update *args:
    bun run scripts/update.ts {{args}}

# --- loop (inner dev cycle) ------------------------------------------------

# Build every workspace member (TS, Rust, Python, Go).
[group('loop')]
build *args:
    bun run scripts/build.ts {{args}}

# Typecheck across all languages.
[group('loop')]
typecheck *args:
    bun run scripts/typecheck.ts {{args}}

# Run the full test suite.
[group('loop')]
test *args:
    bun run scripts/test.ts {{args}}

# Lint + typecheck + test in one pass (fast pre-commit feedback).
[group('loop')]
qa *args:
    bun run scripts/qa.ts {{args}}

# Run all linters (read-only).
[group('loop')]
lint *args:
    bun run scripts/lint.ts {{args}}

# Run linters in fix-mode (mutates files).
[group('loop')]
lint-fix *args:
    bun run scripts/lint.ts --fix {{args}}

# --- gates (pre-commit / pre-PR) -------------------------------------------

# Profiling slot front door (bead create-harness-app-z41). ADVISORY by
# default: regressions vs harness/profiling/baseline.json are reported but
# never fail the run until harness/profiling/budgets.toml opts a signal
# into hard gating. Subcommands: startup (hyperfine bench), api (latency
# p50/p95/p99 + traceparent OTEL correlation + --cpu-prof-dir flamegraph
# inputs), ui (Playwright + CDP performance trace per the
# chrome-devtools-deep skill, Core Web Vitals, bundle size), summary,
# gate (signals JSON on stdin).

# Profiling slot: backend/frontend/startup profiles, advisory perf gate (see harness/profiling/README.md).
[group('gates')]
profile *args:
    bun run scripts/profiling.ts {{args}}

# Agent-facing architectural-health report. Read-only view over the
# same baseline + readings pipeline `just sensors gate` uses; prints
# current value, ratchet floor, headroom, and PASS / AT-RISK / FAIL for
# every fitness dimension (MT01 / MD01 / ST01 / SC01 / LG01 / PF01 plus
# advisory AC01 / AV01). Never rewrites the floor and never fails the
# gate; this is the FEEDBACK surface coding agents consult between
# commits. Pass `--quick` for a floors-only view that skips the full
# ~108 s sensors pipeline (used by the pre-commit one-liner).

# Architectural-fitness report (read-only feedback surface; `--quick` for fast view).
[group('gates')]
fitness *args:
    harness/sensors/bin/sensors fitness {{args}}

# Architectural-fitness sensors slot (gate, scan, dimensions; mutates baseline.json on `--update-baseline`).
[group('gates')]
sensors *args:
    bun run scripts/sensors.ts {{args}}

# Doc-validator slot: enforce ADRs, principles, and cross-references.
[group('gates')]
doc-validator *args:
    harness/doc-validator/bin/doc-validator {{args}}

# config-manager slot — typed env-var schema, .env.example codegen, secret resolution
[group('gates')]
config *args:
    harness/config-manager/bin/config-manager {{args}}

# Build the config-manager binary
[group('gates')]
build-config-manager:
    cargo build --release --manifest-path harness/config-manager/Cargo.toml

# Polyglot dependency / supply-chain audit (ADR-0023-dependency-audit.md).
# Runs `pnpm audit --audit-level=high --prod`, `cargo audit` against every
# Rust workspace, and `pip-audit` against every uv-managed Python project.
# Fails CLOSED on missing tooling (no audit = no signal). Tier: CI gate,
# not pre-push; the network round-trip to advisory DBs dominates wall
# clock. Pass `--only js|rust|python` to scope to a single lane.

# Polyglot supply-chain audit (pnpm audit + cargo audit + pip-audit).
[group('gates')]
dep-audit *args:
    bun run scripts/dep-audit.ts {{args}}

# End-to-end fork-readiness check. Snapshots HEAD into an isolated temp
# dir, runs the documented consumer onboarding (`just init <name>` ->
# `just bootstrap`), then executes the full gate suite (qa, sensors gate,
# optional doc-validator with apss, fitness summary) against the
# post-init tree. Catches "works in template repo but breaks on fork"
# regressions that the in-repo CI can never see. Honors env knobs
# FORK_CHECK_NAME, FORK_CHECK_KEEP, FORK_CHECK_SOURCE (head|worktree),
# FORK_CHECK_SKIP_DOC, FORK_CHECK_FITNESS (quick|full).

# End-to-end fork-readiness check (snapshots HEAD, runs init + bootstrap + gates).
[group('gates')]
fork-check *args:
    bun run scripts/fork-check.ts {{args}}

# --- stack (observability) -------------------------------------------------

# Boot the isolated observability stack (alias for `just stack boot`).
[group('stack')]
boot *args:
    @bun run scripts/boot.ts {{args}}

# Stop the observability stack containers.
[group('stack')]
stop:
    bun run scripts/stack.ts stop

# Stop and remove the observability stack (containers + volumes).
[group('stack')]
destroy:
    bun run scripts/stack.ts destroy

# Print stack health and per-service endpoints.
[group('stack')]
inspect:
    @bun run scripts/stack.ts inspect

# Print eval-safe per-worktree ports.
[group('stack')]
ports:
    @bun run scripts/stack.ts ports

# Explain a stack doctor check by ID.
[group('stack')]
doctor-explain check_id:
    @bun run scripts/stack.ts doctor --explain {{check_id}}

# Emit stack doctor probe output as JSON.
[group('stack')]
doctor-json *probe:
    @bun run scripts/stack.ts doctor --json {{probe}}

# Live polyglot telemetry roundtrip smoke against the local stack.
[group('stack')]
observability-smoke:
    harness/observability/smoke.sh

# Stack-manager slot entrypoint (boot, stop, doctor, ports, inspect).
[group('stack')]
stack *args:
    @bun run scripts/stack.ts {{args}}

# Evidence-capture utilities (screenshot, record, keyframes).
[group('stack')]
inspector *args:
    bun run scripts/inspector.ts {{args}}

# --- coverage --------------------------------------------------------------

# Run tests with coverage thresholds enforced.
[group('coverage')]
test-coverage *args:
    bun run scripts/test-coverage.ts {{args}}

# HARNESS-ENGINEERING PROTECTED CONFIG / DO NOT ADJUST.
# Per-language coverage gates (ADR-0013-coverage-enforcement.md). The
# recipes stay thin by design: lane definitions, thresholds, the main.rs
# opt-outs, and the CARGO_TARGET_DIR worktree isolation all live in
# scripts/lib/coverage.ts (dispatched by scripts/coverage.ts, both tested
# at 100 percent by scripts/tests/coverage.test.ts). Threshold changes are
# ADR-0013 edits, not recipe edits.
#
# cov-rust runs the three Rust lanes (example-rust 100/100/100,
# doc-validator and versioning 100 lines/functions over their library
# targets). cov-py defers to the 100 percent pytest-cov threshold pinned
# in ws_apps/example-python/pyproject.toml. cov-sensors gates the sensors
# slot's node:test suite at its measured floor.

# Rust coverage gates across every Rust crate (100% on protected baselines).
[group('coverage')]
cov-rust:
    bun run scripts/coverage.ts rust

# Coverage gate for ws_apps/example-rust (100% lines / functions / regions).
[group('coverage')]
cov-example-rust:
    bun run scripts/coverage.ts example-rust

# Coverage gate for harness/doc-validator library (100% lines / functions).
[group('coverage')]
cov-doc-validator:
    bun run scripts/coverage.ts doc-validator

# Coverage gate for harness/versioning library (100% lines / functions).
[group('coverage')]
cov-versioning:
    bun run scripts/coverage.ts versioning

# Python coverage gates (pytest under uv, 100% threshold in pyproject.toml).
[group('coverage')]
cov-py:
    bun run scripts/coverage.ts py

# Sensors slot node:test coverage gate at its measured floor (ADR-0013).
[group('coverage')]
cov-sensors:
    bun run scripts/coverage.ts sensors

# Coverage gate for config-manager slot (80% lines / functions).
[group('coverage')]
cov-config-manager:
    cargo llvm-cov --manifest-path harness/config-manager/Cargo.toml \
        --package harness-config-manager \
        --ignore-filename-regex 'main\.rs' \
        --fail-under-lines 80 \
        --fail-under-functions 80

# --- release ---------------------------------------------------------------

# Versioning slot entrypoint (release-check, plan, dry-run, apply).
[group('release')]
versioning *args:
    bun run scripts/versioning.ts {{args}}

# Verify the commit range is releasable per Conventional Commits.
[group('release')]
release-check from="" to="HEAD":
    @if [ -n '{{from}}' ]; then bun run scripts/versioning.ts ci-check --from '{{from}}' --to '{{to}}' .; else bun run scripts/versioning.ts ci-check --to '{{to}}' .; fi

# Validate that a PR title is a Conventional Commit subject. Wired into the
# GitHub Actions versioning workflow on pull_request events so a
# non-conventional PR title is rejected before squash-merge can land a
# non-conventional commit on main.

# Validate a PR title as a Conventional Commit subject.
[group('release')]
release-check-pr-title title:
    bun run scripts/versioning.ts check-pr-title {{quote(title)}}

# Print the next release plan (level + changelog) for a commit range.
[group('release')]
release-plan from="" to="HEAD":
    @if [ -n '{{from}}' ]; then bun run scripts/versioning.ts plan --from '{{from}}' --to '{{to}}' .; else bun run scripts/versioning.ts plan --to '{{to}}' .; fi

# Render the next release notes without mutating anything.
[group('release')]
release-dry-run level="auto" from="" to="HEAD":
    @if [ -n '{{from}}' ]; then bun run scripts/versioning.ts release --level '{{level}}' --from '{{from}}' --to '{{to}}' .; else bun run scripts/versioning.ts release --level '{{level}}' --to '{{to}}' .; fi

# Tag and push the next release (mutating; requires clean working tree).
[group('release')]
release-apply level="auto" from="" to="HEAD":
    @if [ -n '{{from}}' ]; then bun run scripts/versioning.ts release --execute --level '{{level}}' --from '{{from}}' --to '{{to}}' .; else bun run scripts/versioning.ts release --execute --level '{{level}}' --to '{{to}}' .; fi

# Idempotently apply branch protection to `main` on the GitHub remote so
# that auto-merge waits for every CI check before merging. Required-check
# list is the constant `REQUIRED_PR_CONTEXTS` in scripts/protect-main.ts;
# update there (and re-run this recipe) when a check is added or renamed.
# See ADR-0022-merge-gating.md for why this exists. Requires `gh` to be
# authenticated against the owning org. Re-running is safe; the API call
# is a full-document PUT, so drift is overwritten on every invocation.

# Idempotently apply branch protection to `main` on the GitHub remote.
[group('release')]
protect-main *args:
    bun run scripts/protect-main.ts {{args}}

# --- polyglot wrappers -----------------------------------------------------

# Workspace-aware cargo wrapper.
[group('polyglot')]
cargo *args:
    bun run scripts/cargo.ts {{args}}

# Workspace-aware uv wrapper.
[group('polyglot')]
uv *args:
    bun run scripts/uv.ts {{args}}

# --- meta (architecture, vendor, scaffolding) ------------------------------

# APSS code-topology producer. Emits `.topology/metrics/*.json` (the data
# the architectural fitness gate consumes via
# `harness/sensors/apss_topology.mjs`). Re-run on demand; `bin/sensors gate`
# calls the same producer automatically every cycle when
# APSS_SENSORS_PRODUCE is unset/1 (the default).

# APSS code-topology producer (writes .topology/metrics/*.json).
[group('meta')]
topology-analyze *args:
    .apss/bin/apss run code-topology analyze . {{args}}

# Regenerate the architectural diagrams from the current `.topology/`
# snapshot. Emits the 3D coupling graph, CodeCity, cluster map, VSA
# matrix, and the all-in-one dashboard HTML. Run `just topology-analyze`
# first if `.topology/` is missing or stale.
# Output path (default): `.topology/visualizations/`.

# Regenerate architectural diagrams from the .topology/ snapshot.
[group('meta')]
topology-viz *args:
    .apss/bin/apss run code-topology viz .topology --type all {{args}}

# Orchestrate a multi-agent harness review of the current tree.
[group('meta')]
review *args:
    bun run scripts/harness-review.ts {{args}}

# Smoke-check the harness-engineering plugin skill inventory.
[group('meta')]
harness-engineering-skills *args:
    bun run scripts/harness-engineering-skills.ts {{args}}

# Re-vendor the software-leverage-points (SLP) skills at the given upstream ref
# (default: main). Updates .claude/skills/slp-source.json with the new pinned
# SHA and date, then prints changed files. See README "Software leverage
# points" for usage.

# Re-vendor the SLP skills at the pinned upstream ref.
[group('meta')]
update-slp *args:
    bun run scripts/update-slp.ts {{args}}

# Compose the project APSS CLI (`.apss/bin/apss`). Thin wrapper around
# `apss install` that unsets any inherited CARGO_TARGET_DIR before invoking
# cargo.
#
# Upstream bug: `apss install` hard-codes the post-build binary lookup at
# `<repo>/.apss/build/target/release/apss`. When the environment exports
# CARGO_TARGET_DIR (the swarm VPS sets `/data/tmp/cargo-target`), cargo
# obeys that env var and writes the binary to the shared dir, but `apss
# install` still looks under `.apss/build/target/` and reports
# "Install failed; no runnable .apss/bin/apss was installed." Tracking
# upstream; until that lands, run `just apss-install` (or
# `env -u CARGO_TARGET_DIR apss install`) on shared-target hosts.

# Compose the project APSS CLI (.apss/bin/apss).
[group('meta')]
apss-install:
    env -u CARGO_TARGET_DIR apss install
