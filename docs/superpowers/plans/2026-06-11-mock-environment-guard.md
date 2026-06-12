# Mock Environment Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `ws_packages/d_test-guard/` — a Rust crate + TypeScript module that panic/throw at mock construction time when `APP_ENV != "test"`, plus agent policy docs and AGENTS.md breadcrumbs.

**Architecture:** A minimal shared package (Rust crate + TS module, no external deps) exports one guard function each. Every mock calls the guard as its first line. Rust mocks additionally use `#[cfg(test)]` for compile-time exclusion. Documentation lives in `docs/development/mocks.md`; AGENTS.md gets two new sections.

**Tech Stack:** Rust 2024 edition, TypeScript (ESM, vitest), pnpm workspaces, Cargo workspace

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `ws_packages/d_test-guard/Cargo.toml` | Rust crate manifest |
| Create | `ws_packages/d_test-guard/src/lib.rs` | `assert_test_env()` fn + macro |
| Create | `ws_packages/d_test-guard/src/lib_test.rs` | Rust unit tests |
| Create | `ws_packages/d_test-guard/package.json` | TS package manifest |
| Create | `ws_packages/d_test-guard/index.ts` | `assertTestEnv()` TS function |
| Create | `ws_packages/d_test-guard/index.test.ts` | TS unit tests (vitest) |
| Create | `ws_packages/d_test-guard/tsconfig.json` | TS config extending base |
| Create | `ws_packages/d_test-guard/vitest.config.ts` | vitest config |
| Create | `docs/development/mocks.md` | Agent + human policy doc |
| Modify | `Cargo.toml` | Add `ws_packages/d_test-guard` to workspace members |
| Modify | `AGENTS.md` | Add `## Mocks` and `## Package naming conventions` sections |

---

## Task 1: Rust crate scaffold

**Files:**
- Create: `ws_packages/d_test-guard/Cargo.toml`

- [ ] **Step 1: Create the crate manifest**

```toml
# ws_packages/d_test-guard/Cargo.toml
[package]
name = "d_test-guard"
version = "0.1.0"
edition = "2024"
description = "Runtime guard: panics if a mock is instantiated outside APP_ENV=test."

[lints.rust]
unsafe_code = "forbid"
unused = { level = "deny", priority = -1 }

[lints.clippy]
all = { level = "deny", priority = -1 }

[package.metadata.harness-engineering]
unit_coverage_lines_min = 100
unit_coverage_functions_min = 100
unit_coverage_regions_min = 100
strict_clippy = true
no_unsafe = true
```

- [ ] **Step 2: Add the crate to the Cargo workspace**

In `Cargo.toml`, add `"ws_packages/d_test-guard"` to the `members` array:

```toml
[workspace]
resolver = "3"
members = [
  "ws_apps/example-rust",
  "ws_packages/d_test-guard",
]
```

Also add the new crate surface to `[workspace.metadata.coverage]`:

```toml
[workspace.metadata.coverage]
tool = "cargo-llvm-cov"
rust_surfaces = [
  "ws_apps/example-rust",
  "harness/doc-validator",
  "harness/versioning",
  "ws_packages/d_test-guard",
]
```

- [ ] **Step 3: Verify the workspace resolves**

```bash
cargo metadata --no-deps --format-version 1 | grep d_test-guard
```

Expected: a line containing `"d_test-guard"`.

---

## Task 2: Rust implementation (TDD)

**Files:**
- Create: `ws_packages/d_test-guard/src/lib.rs`

- [ ] **Step 1: Write the failing test first**

Create `ws_packages/d_test-guard/src/lib.rs` with only the test module:

```rust
// ws_packages/d_test-guard/src/lib.rs

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_when_app_env_is_test() {
        // SAFETY: test-only env mutation, single-threaded test runner
        unsafe { std::env::set_var("APP_ENV", "test") };
        assert_test_env(); // must not panic
    }

    #[test]
    #[should_panic(expected = "Mock instantiated outside test environment")]
    fn panics_when_app_env_is_production() {
        unsafe { std::env::set_var("APP_ENV", "production") };
        assert_test_env();
    }

    #[test]
    #[should_panic(expected = "Mock instantiated outside test environment")]
    fn panics_when_app_env_is_unset() {
        unsafe { std::env::remove_var("APP_ENV") };
        assert_test_env();
    }
}
```

- [ ] **Step 2: Run tests — expect compile failure**

```bash
cargo test -p d_test-guard 2>&1 | head -20
```

Expected: error `cannot find function 'assert_test_env'`.

- [ ] **Step 3: Add the implementation above the test module**

Replace the contents of `ws_packages/d_test-guard/src/lib.rs` with:

```rust
// ws_packages/d_test-guard/src/lib.rs

/// Panics immediately if `APP_ENV` is not `"test"`.
/// Call this as the first line of every mock constructor.
pub fn assert_test_env() {
    if std::env::var("APP_ENV").as_deref() != Ok("test") {
        panic!(
            "Mock instantiated outside test environment (APP_ENV={:?}). \
             Mocks may only run when APP_ENV=test.",
            std::env::var("APP_ENV").unwrap_or_else(|_| "<unset>".into())
        );
    }
}

/// Convenience macro — call `assert_test_env!()` in mock constructors.
#[macro_export]
macro_rules! assert_test_env {
    () => {
        $crate::assert_test_env()
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_when_app_env_is_test() {
        unsafe { std::env::set_var("APP_ENV", "test") };
        assert_test_env();
    }

    #[test]
    #[should_panic(expected = "Mock instantiated outside test environment")]
    fn panics_when_app_env_is_production() {
        unsafe { std::env::set_var("APP_ENV", "production") };
        assert_test_env();
    }

    #[test]
    #[should_panic(expected = "Mock instantiated outside test environment")]
    fn panics_when_app_env_is_unset() {
        unsafe { std::env::remove_var("APP_ENV") };
        assert_test_env();
    }
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
cargo test -p d_test-guard
```

Expected:
```
test tests::passes_when_app_env_is_test ... ok
test tests::panics_when_app_env_is_production ... ok
test tests::panics_when_app_env_is_unset ... ok
test result: ok. 3 passed; 0 failed
```

- [ ] **Step 5: Run clippy**

```bash
cargo clippy -p d_test-guard -- -D warnings
```

Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
git add ws_packages/d_test-guard/Cargo.toml ws_packages/d_test-guard/src/lib.rs Cargo.toml
git commit -m "feat(d_test-guard): add Rust assert_test_env guard + macro"
```

---

## Task 3: TypeScript package scaffold

**Files:**
- Create: `ws_packages/d_test-guard/package.json`
- Create: `ws_packages/d_test-guard/tsconfig.json`
- Create: `ws_packages/d_test-guard/vitest.config.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@harness/d_test-guard",
  "version": "0.1.0",
  "description": "Runtime guard: throws if a mock is instantiated outside APP_ENV=test.",
  "type": "module",
  "private": true,
  "main": "./index.ts",
  "exports": {
    ".": "./index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "biome check index.ts index.test.ts"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["index.ts", "index.test.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['index.test.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      reporter: ['text'],
      include: ['index.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
});
```

- [ ] **Step 4: Install deps**

```bash
pnpm install
```

Expected: no errors, lockfile updated.

---

## Task 4: TypeScript implementation (TDD)

**Files:**
- Create: `ws_packages/d_test-guard/index.ts`
- Create: `ws_packages/d_test-guard/index.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `ws_packages/d_test-guard/index.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertTestEnv } from './index.ts';

describe('assertTestEnv', () => {
  const originalAppEnv = process.env['APP_ENV'];

  afterEach(() => {
    if (originalAppEnv === undefined) {
      delete process.env['APP_ENV'];
    } else {
      process.env['APP_ENV'] = originalAppEnv;
    }
  });

  it('does not throw when APP_ENV is "test"', () => {
    process.env['APP_ENV'] = 'test';
    expect(() => assertTestEnv()).not.toThrow();
  });

  it('throws when APP_ENV is "production"', () => {
    process.env['APP_ENV'] = 'production';
    expect(() => assertTestEnv()).toThrow(
      'Mock instantiated outside test environment'
    );
  });

  it('throws when APP_ENV is unset', () => {
    delete process.env['APP_ENV'];
    expect(() => assertTestEnv()).toThrow(
      'Mock instantiated outside test environment'
    );
  });

  it('error message includes the actual APP_ENV value', () => {
    process.env['APP_ENV'] = 'staging';
    expect(() => assertTestEnv()).toThrow('APP_ENV="staging"');
  });

  it('error message notes unset APP_ENV', () => {
    delete process.env['APP_ENV'];
    expect(() => assertTestEnv()).toThrow('APP_ENV="<unset>"');
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pnpm --filter @harness/d_test-guard test
```

Expected: error `Cannot find module './index.ts'`.

- [ ] **Step 3: Create the implementation**

Create `ws_packages/d_test-guard/index.ts`:

```typescript
/**
 * Throws immediately if APP_ENV is not "test".
 * Call this as the first line of every mock class constructor.
 */
export function assertTestEnv(): void {
  const env = process.env['APP_ENV'];
  if (env !== 'test') {
    throw new Error(
      `Mock instantiated outside test environment (APP_ENV="${env ?? '<unset>'}"). ` +
        `Mocks may only run when APP_ENV=test.`
    );
  }
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
pnpm --filter @harness/d_test-guard test
```

Expected:
```
✓ index.test.ts (5)
  ✓ assertTestEnv > does not throw when APP_ENV is "test"
  ✓ assertTestEnv > throws when APP_ENV is "production"
  ✓ assertTestEnv > throws when APP_ENV is unset
  ✓ assertTestEnv > error message includes the actual APP_ENV value
  ✓ assertTestEnv > error message notes unset APP_ENV
Test Files  1 passed (1)
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @harness/d_test-guard typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add ws_packages/d_test-guard/package.json ws_packages/d_test-guard/tsconfig.json ws_packages/d_test-guard/vitest.config.ts ws_packages/d_test-guard/index.ts ws_packages/d_test-guard/index.test.ts pnpm-lock.yaml
git commit -m "feat(d_test-guard): add TypeScript assertTestEnv guard"
```

---

## Task 5: Policy doc

**Files:**
- Create: `docs/development/mocks.md`
- Modify: `docs/development/README.md`

- [ ] **Step 1: Create the mock policy doc**

```markdown
# Mock Policy

Mocks belong in fewer than 1% of cases. The default is always real data,
real endpoints, and real service containers. This doc defines when mocks
are acceptable and how to use them safely.

## When mocks are acceptable

- **Network-isolated CI** — the dependency genuinely cannot be reached in
  the test environment and standing up a container is not feasible.
- **Clock / time control** — tests that assert on timestamps or durations.
- **Deliberate fault injection** — testing error paths that are
  structurally impossible to trigger against a real dependency.

## When mocks are NOT acceptable

- Integration tests — use a real database, real service, or Docker Compose.
- Any production code path — always, without exception.
- Convenience — "it's faster to mock" is not a justification.

## Required: the environment guard

Every mock must call the guard as its **first line**. If `APP_ENV` is not
`"test"`, it throws / panics immediately.

**Rust:**
```rust
use d_test_guard::assert_test_env;

pub struct MyServiceMock { /* ... */ }

impl MyServiceMock {
    pub fn new() -> Self {
        assert_test_env!(); // panics if APP_ENV != "test"
        Self { /* ... */ }
    }
}
```

Rust mocks additionally use `#[cfg(test)]` so they cannot compile into
non-test binaries:

```rust
#[cfg(test)]
pub struct MyServiceMock { /* ... */ }
```

**TypeScript:**
```typescript
import { assertTestEnv } from '@harness/d_test-guard';

export class MyServiceMock implements MyService {
  constructor() {
    assertTestEnv(); // throws if APP_ENV !== "test"
  }
}
```

Jest/vitest sets `APP_ENV=test` in the test setup file so the guard
passes automatically during test runs.

## Preferred alternatives to mocks

| Instead of mocking… | Use… |
|---------------------|------|
| A database | SQLite in-memory or Postgres in a Docker container |
| An HTTP service | A local server started in `beforeAll` / test fixture |
| The filesystem | A temp directory (`tempfile` crate / `tmp` npm package) |
| Time | A clock abstraction injected as a dependency |

## Setting APP_ENV in tests

**Rust:** `APP_ENV=test cargo test` — or set it in CI env.

**TypeScript (vitest):** Add to `vitest.config.ts`:
```typescript
export default defineConfig({
  test: {
    env: { APP_ENV: 'test' },
    // ...
  },
});
```
```

- [ ] **Step 2: Add entry to docs/development/README.md**

The current table in `docs/development/README.md`:

```markdown
| Guide | Purpose |
|-------|---------|
| [beads-viewer.md](./beads-viewer.md) | Graph-aware triage with `bv` — all `--robot-*` flags, filtering, and the `br` issue lifecycle |
```

Add a row:

```markdown
| Guide | Purpose |
|-------|---------|
| [beads-viewer.md](./beads-viewer.md) | Graph-aware triage with `bv` — all `--robot-*` flags, filtering, and the `br` issue lifecycle |
| [mocks.md](./mocks.md) | Mock policy — when mocks are acceptable, the required `APP_ENV` guard, and preferred alternatives |
```

- [ ] **Step 3: Commit**

```bash
git add docs/development/mocks.md docs/development/README.md
git commit -m "docs(development): add mock policy doc"
```

---

## Task 6: AGENTS.md breadcrumbs

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add the two sections before the closing separator**

Find the line `---` near the bottom of `AGENTS.md` (before the template draft note) and insert two new sections above it:

```markdown
## Package naming conventions

Prefixes in `ws_packages/` are optional but encouraged when there is a
meaningful grouping to signal. A prefix keeps related packages co-located
in directory listings and adds key information at a glance. Use a prefix
when it genuinely clarifies the package's role; omit it when the name is
already self-evident. Examples: `d_` for dev/test tooling, `i_` for
infrastructure utilities.

## Mocks

Before writing any mock, read [`docs/development/mocks.md`](./docs/development/mocks.md).
Every mock must call `assert_test_env!()` (Rust) or `assertTestEnv()` (TypeScript)
as its first line — this throws immediately if `APP_ENV != "test"`, preventing
mocks from ever running outside a test environment.
```

- [ ] **Step 2: Verify AGENTS.md renders cleanly**

```bash
grep -n "Package naming\|## Mocks\|assert_test_env" AGENTS.md
```

Expected: three matching lines showing the new sections.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): add mock guard and package naming convention breadcrumbs"
```

---

## Task 7: Wire APP_ENV=test into vitest configs

The guard requires `APP_ENV=test` at runtime. Wire it into the existing example-typescript vitest config so running tests there "just works", and document the pattern for new apps.

**Files:**
- Modify: `ws_apps/example-typescript/vitest.config.ts`

- [ ] **Step 1: Add env to the existing vitest config**

In `ws_apps/example-typescript/vitest.config.ts`, add `env` inside the `test` object:

```typescript
export default defineConfig({
  test: {
    env: { APP_ENV: 'test' },
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      all: true,
      reporter: ['text'],
      include: ['src/**/*.ts'],
      thresholds: PER_APP_UNIT_COVERAGE_THRESHOLDS,
    },
  },
});
```

- [ ] **Step 2: Run existing tests to confirm no regression**

```bash
pnpm --filter @example/typescript test
```

Expected: all tests pass (same result as before).

- [ ] **Step 3: Commit**

```bash
git add ws_apps/example-typescript/vitest.config.ts
git commit -m "chore(example-typescript): set APP_ENV=test in vitest config"
```

---

## Task 8: Final verification

- [ ] **Step 1: Full Rust test suite**

```bash
cargo test
```

Expected: all tests pass, no warnings.

- [ ] **Step 2: Full TS test suite**

```bash
pnpm test
```

Expected: all tests pass across all packages.

- [ ] **Step 3: Clippy clean**

```bash
cargo clippy -- -D warnings
```

Expected: no warnings.

- [ ] **Step 4: Confirm guard is documented in key places**

```bash
grep -r "assert_test_env\|assertTestEnv\|APP_ENV" AGENTS.md docs/development/mocks.md
```

Expected: multiple matches in both files.
