# Agentic Harness template task runner.
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

lint *args:
    bun run scripts/lint.ts {{args}}

doctor *args:
    bun run scripts/doctor.ts {{args}}

harness-engineering-skills *args:
    bun run scripts/harness-engineering-skills.ts {{args}}

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

cargo *args:
    bun run scripts/cargo.ts {{args}}

uv *args:
    bun run scripts/uv.ts {{args}}
