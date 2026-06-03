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

test *args:
    bun run scripts/test.ts {{args}}

test-coverage *args:
    bun run scripts/test-coverage.ts {{args}}

lint *args:
    bun run scripts/lint.ts {{args}}

doctor *args:
    bun run scripts/doctor.ts {{args}}

harness-engineering-skills *args:
    bun run scripts/harness-engineering-skills.ts {{args}}

review *args:
    bun run scripts/harness-review.ts {{args}}

boot *args:
    bun run scripts/boot.ts {{args}}

init project-name:
    bun run scripts/init.ts {{project-name}}

update *args:
    bun run scripts/update.ts {{args}}

stack *args:
    bun run scripts/stack.ts {{args}}

inspector *args:
    bun run scripts/inspector.ts {{args}}

sensors *args:
    bun run scripts/sensors.ts {{args}}

doc-validator *args:
    harness/doc-validator/bin/doc-validator {{args}}

versioning *args:
    bun run scripts/versioning.ts {{args}}

release-check from="" to="HEAD":
    @if [ -n '{{from}}' ]; then bun run scripts/versioning.ts ci-check --from '{{from}}' --to '{{to}}' .; else bun run scripts/versioning.ts ci-check --to '{{to}}' .; fi

release-plan from="" to="HEAD":
    @if [ -n '{{from}}' ]; then bun run scripts/versioning.ts plan --from '{{from}}' --to '{{to}}' .; else bun run scripts/versioning.ts plan --to '{{to}}' .; fi

release-dry-run level="auto" from="" to="HEAD":
    @if [ -n '{{from}}' ]; then bun run scripts/versioning.ts release --level '{{level}}' --from '{{from}}' --to '{{to}}' .; else bun run scripts/versioning.ts release --level '{{level}}' --to '{{to}}' .; fi

release-apply level="auto" from="" to="HEAD":
    @if [ -n '{{from}}' ]; then bun run scripts/versioning.ts release --execute --level '{{level}}' --from '{{from}}' --to '{{to}}' .; else bun run scripts/versioning.ts release --execute --level '{{level}}' --to '{{to}}' .; fi

cargo *args:
    bun run scripts/cargo.ts {{args}}

uv *args:
    bun run scripts/uv.ts {{args}}

# HARNESS-ENGINEERING PROTECTED CONFIG / DO NOT ADJUST.
# Rust coverage gates. The root Cargo workspace intentionally contains only
# ws_apps/example-rust; harness/doc-validator and harness/versioning are
# self-contained slot workspaces (each carries its own [workspace] block by
# design, so the root never pulls slot stubs in transitively) and are
# covered by explicit --manifest-path invocations.
# Thresholds are pinned to current measured baselines: example-rust stays
# 100/100/100, doc-validator is 82 lines / 94 functions, and versioning is
# 87 lines / 86 functions. main.rs files are excluded per the ADR-0013
# opt-out table because they are CLI shells with no business logic.
# Refactor production or add tests before raising these thresholds.
cov-rust: cov-example-rust cov-doc-validator cov-versioning

cov-example-rust:
    cargo llvm-cov --manifest-path ws_apps/example-rust/Cargo.toml --package example-rust --fail-under-lines 100 --fail-under-functions 100 --fail-under-regions 100

cov-doc-validator:
    cargo build --manifest-path harness/doc-validator/Cargo.toml --bin harness-doc-validator
    cargo llvm-cov --manifest-path harness/doc-validator/Cargo.toml --package harness-doc-validator --ignore-filename-regex 'main\.rs' --fail-under-lines 82 --fail-under-functions 94

cov-versioning:
    cargo llvm-cov --manifest-path harness/versioning/Cargo.toml --package harness-versioning --ignore-filename-regex 'main\.rs' --fail-under-lines 87 --fail-under-functions 86
