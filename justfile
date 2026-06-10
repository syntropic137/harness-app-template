# Agentic Harness template canonical task surface.
#
# Recipes stay thin by design: implementation lives in typed scripts under
# scripts/*.ts so the behavior is testable and shared across entrypoints.

default:
    @just --list

bootstrap *args:
    bun run scripts/bootstrap.ts {{args}}

build *args:
    bun run scripts/build.ts {{args}}

typecheck *args:
    bun run scripts/typecheck.ts {{args}}

test *args:
    bun run scripts/test.ts {{args}}

test-coverage *args:
    bun run scripts/test-coverage.ts {{args}}

qa *args:
    bun run scripts/qa.ts {{args}}

lint *args:
    bun run scripts/lint.ts {{args}}

lint-fix *args:
    bun run scripts/lint.ts --fix {{args}}

doctor *args:
    bun run scripts/doctor.ts {{args}}

# End-to-end fork-readiness check. Snapshots HEAD into an isolated temp
# dir, runs the documented consumer onboarding (`just init <name>` →
# `just bootstrap`), then executes the full gate suite (qa, sensors gate,
# optional doc-validator with apss, fitness summary) against the
# post-init tree. Catches "works in template repo but breaks on fork"
# regressions that the in-repo CI can never see. Honors env knobs
# FORK_CHECK_NAME, FORK_CHECK_KEEP, FORK_CHECK_SOURCE (head|worktree),
# FORK_CHECK_SKIP_DOC, FORK_CHECK_FITNESS (quick|full).
fork-check *args:
    bun run scripts/fork-check.ts {{args}}

harness-engineering-skills *args:
    bun run scripts/harness-engineering-skills.ts {{args}}

review *args:
    bun run scripts/harness-review.ts {{args}}

agents action="link" *args:
    @if [ "{{action}}" = "link" ]; then bun run scripts/agents-link.ts {{args}}; else echo "unknown agents action: {{action}}" >&2; exit 64; fi

boot *args:
    @bun run scripts/boot.ts {{args}}

stop:
    bun run scripts/stack.ts stop

destroy:
    bun run scripts/stack.ts destroy

inspect:
    @bun run scripts/stack.ts inspect

ports:
    @bun run scripts/stack.ts ports

doctor-explain check_id:
    @bun run scripts/stack.ts doctor --explain {{check_id}}

doctor-json *probe:
    @bun run scripts/stack.ts doctor --json {{probe}}

# Run the live polyglot telemetry roundtrip smoke against the local observability stack.
observability-smoke:
    harness/observability/smoke.sh

init project-name:
    bun run scripts/init.ts {{project-name}}

update *args:
    bun run scripts/update.ts {{args}}

stack *args:
    @bun run scripts/stack.ts {{args}}

inspector *args:
    bun run scripts/inspector.ts {{args}}

sensors *args:
    bun run scripts/sensors.ts {{args}}

# Agent-facing architectural-health report. Read-only view over the
# same baseline + readings pipeline `just sensors gate` uses; prints
# current value, ratchet floor, headroom, and PASS / AT-RISK / FAIL for
# every fitness dimension (MT01 / MD01 / ST01 / SC01 / LG01 / PF01 plus
# advisory AC01 / AV01). Never rewrites the floor and never fails the
# gate - this is the FEEDBACK surface coding agents consult between
# commits. Pass `--quick` for a floors-only view that skips the full
# ~108 s sensors pipeline (used by the pre-commit one-liner).
fitness *args:
    harness/sensors/bin/sensors fitness {{args}}

# APSS code-topology producer. Emits `.topology/metrics/*.json` (the data
# the architectural fitness gate consumes via
# `harness/sensors/apss_topology.mjs`). Re-run on demand; `bin/sensors gate`
# calls the same producer automatically every cycle when
# APSS_SENSORS_PRODUCE is unset/1 (the default).
topology-analyze *args:
    .apss/bin/apss run code-topology analyze . {{args}}

# Regenerate the architectural diagrams from the current `.topology/`
# snapshot. Emits the 3D coupling graph, CodeCity, cluster map, VSA
# matrix, and the all-in-one dashboard HTML. Run `just topology-analyze`
# first if `.topology/` is missing or stale.
# Output path (default): `.topology/visualizations/`
topology-viz *args:
    .apss/bin/apss run code-topology viz .topology --type all {{args}}

doc-validator *args:
    harness/doc-validator/bin/doc-validator {{args}}

versioning *args:
    bun run scripts/versioning.ts {{args}}

release-check from="" to="HEAD":
    @if [ -n '{{from}}' ]; then bun run scripts/versioning.ts ci-check --from '{{from}}' --to '{{to}}' .; else bun run scripts/versioning.ts ci-check --to '{{to}}' .; fi

# Validate that a PR title is a Conventional Commit subject. Wired into the
# GitHub Actions versioning workflow on pull_request events so a
# non-conventional PR title is rejected before squash-merge can land a
# non-conventional commit on main.
release-check-pr-title title:
    bun run scripts/versioning.ts check-pr-title {{quote(title)}}

release-plan from="" to="HEAD":
    @if [ -n '{{from}}' ]; then bun run scripts/versioning.ts plan --from '{{from}}' --to '{{to}}' .; else bun run scripts/versioning.ts plan --to '{{to}}' .; fi

release-dry-run level="auto" from="" to="HEAD":
    @if [ -n '{{from}}' ]; then bun run scripts/versioning.ts release --level '{{level}}' --from '{{from}}' --to '{{to}}' .; else bun run scripts/versioning.ts release --level '{{level}}' --to '{{to}}' .; fi

release-apply level="auto" from="" to="HEAD":
    @if [ -n '{{from}}' ]; then bun run scripts/versioning.ts release --execute --level '{{level}}' --from '{{from}}' --to '{{to}}' .; else bun run scripts/versioning.ts release --execute --level '{{level}}' --to '{{to}}' .; fi

# Idempotently apply branch protection to `main` on the GitHub remote so
# that auto-merge waits for every CI check before merging. Required-check
# list is the constant `REQUIRED_PR_CONTEXTS` in scripts/protect-main.ts;
# update there (and re-run this recipe) when a check is added or renamed.
# See ADR-0022-merge-gating.md for why this exists. Requires `gh` to be
# authenticated against the owning org. Re-running is safe — the API call
# is a full-document PUT, so drift is overwritten on every invocation.
protect-main *args:
    bun run scripts/protect-main.ts {{args}}

cargo *args:
    bun run scripts/cargo.ts {{args}}

# Polyglot dependency / supply-chain audit (ADR-0023-dependency-audit.md).
# Runs `pnpm audit --audit-level=high --prod`, `cargo audit` against every
# Rust workspace, and `pip-audit` against every uv-managed Python project.
# Fails CLOSED on missing tooling (no audit = no signal). Tier: CI gate,
# not pre-push — the network round-trip to advisory DBs dominates wall
# clock. Pass `--only js|rust|python` to scope to a single lane.
dep-audit *args:
    bun run scripts/dep-audit.ts {{args}}

uv *args:
    bun run scripts/uv.ts {{args}}

# HARNESS-ENGINEERING PROTECTED CONFIG / DO NOT ADJUST.
# Rust coverage gates. The root Cargo workspace intentionally contains only
# ws_apps/example-rust; harness/doc-validator and harness/versioning are
# self-contained slot workspaces (each carries its own [workspace] block by
# design, so the root never pulls slot stubs in transitively) and are
# covered by explicit --manifest-path invocations.
# Thresholds are pinned to protected baselines: example-rust stays
# 100/100/100, and doc-validator and versioning enforce 100 percent lines
# and functions over their library business logic. main.rs files are built
# separately and excluded per the ADR-0013 opt-out table because they are CLI
# shells with no business logic.
#
# Worktree isolation: every `cargo llvm-cov` line pins CARGO_TARGET_DIR to a
# worktree-local path. Hosts (e.g. the swarm VPS) commonly export a shared
# CARGO_TARGET_DIR to amortise the cargo build cache across projects; without
# this override two worktrees running `just cov-rust` concurrently would write
# *.profraw into the same llvm-cov-target/ directory and corrupt each other's
# coverage reports (cargo-llvm-cov collects every profraw in that dir at
# report time, so a foreign run's PID-suffixed file looks like one of ours).
# Pinning to `{{justfile_directory()}}/target/coverage-isolated` keeps each
# worktree's build artefacts and profraw inside the worktree.
coverage_target_dir := justfile_directory() / "target" / "coverage-isolated"

cov-rust: cov-example-rust cov-doc-validator cov-versioning

cov-py:
    cd ws_apps/example-python && sh scripts/with-uv.sh uv run pytest

cov-example-rust:
    CARGO_TARGET_DIR='{{coverage_target_dir}}' cargo llvm-cov --manifest-path ws_apps/example-rust/Cargo.toml --package example-rust --fail-under-lines 100 --fail-under-functions 100 --fail-under-regions 100

cov-doc-validator:
    CARGO_TARGET_DIR='{{coverage_target_dir}}' cargo build --manifest-path harness/doc-validator/Cargo.toml --bin harness-doc-validator
    CARGO_TARGET_DIR='{{coverage_target_dir}}' cargo llvm-cov --manifest-path harness/doc-validator/Cargo.toml --package harness-doc-validator --lib --ignore-filename-regex 'main\.rs' --fail-under-lines 100 --fail-under-functions 100

cov-versioning:
    CARGO_TARGET_DIR='{{coverage_target_dir}}' cargo build --manifest-path harness/versioning/Cargo.toml --bin harness-versioning
    CARGO_TARGET_DIR='{{coverage_target_dir}}' cargo llvm-cov --manifest-path harness/versioning/Cargo.toml --package harness-versioning --lib --ignore-filename-regex 'main\.rs' --fail-under-lines 100 --fail-under-functions 100

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
apss-install:
    env -u CARGO_TARGET_DIR apss install
