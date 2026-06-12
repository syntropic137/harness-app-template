# Mock Environment Guard — Design Spec

**Date:** 2026-06-11  
**Status:** Approved  

## Problem

Mocks instantiated outside a test environment give false confidence. A mock in production silently returns fabricated data with no indication anything is wrong. The footgun is invisible until something breaks in a way that's hard to trace.

## Goal

Make it structurally impossible to run a mock outside `APP_ENV=test`. The failure must be loud, immediate, and unambiguous — a panic (Rust) or thrown error (TypeScript) at construction time, not a silent wrong answer at runtime.

## Scope

- New shared package: `ws_packages/d_test-guard/`
- New agent policy doc: `docs/development/mocks.md`
- AGENTS.md additions: mock breadcrumb + package naming convention note

Mocks acceptable in fewer than 1% of cases (genuine network isolation, clock control, fault injection in unit tests). Everything else should use real data, real endpoints, or local service containers.

---

## Package: `ws_packages/d_test-guard/`

### Rust

```rust
// ws_packages/d_test-guard/src/lib.rs

pub fn assert_test_env() {
    if std::env::var("APP_ENV").as_deref() != Ok("test") {
        panic!(
            "Mock instantiated outside test environment (APP_ENV={:?})",
            std::env::var("APP_ENV").unwrap_or_else(|_| "<unset>".into())
        );
    }
}

#[macro_export]
macro_rules! assert_test_env {
    () => {
        d_test_guard::assert_test_env()
    };
}
```

**Usage:** Call `assert_test_env!()` as the first line of every mock's `new()` or `Default::default()`. Rust mocks additionally get `#[cfg(test)]` as a free compile-time layer — this prevents mock structs from compiling into non-test binaries at all. The guard itself is NOT gated behind `#[cfg(test)]` so it remains available in integration test binaries.

### TypeScript

```typescript
// ws_packages/d_test-guard/index.ts

export function assertTestEnv(): void {
  if (process.env.APP_ENV !== "test") {
    throw new Error(
      `Mock instantiated outside test environment (APP_ENV="${process.env.APP_ENV ?? "<unset>"}")`
    );
  }
}
```

**Usage:** Call `assertTestEnv()` as the first line of every mock class constructor. Jest sets `APP_ENV=test` in the test setup file (one line in `jest.setup.ts` or `vitest.setup.ts`).

### Environment variable

`APP_ENV=test` is the only accepted value for mock use. This variable is ecosystem-agnostic — it means the same thing in Rust, TypeScript, and Python — and is not coupled to any single runtime (unlike `NODE_ENV`).

---

## Agent Policy: `docs/development/mocks.md`

Covers:

- **Acceptable:** unit tests where the dependency genuinely cannot be reached (network-isolated CI, clock/time control, deliberate fault injection)
- **Not acceptable:** integration tests, any production code path, convenience ("it's faster")
- **Required:** every mock constructor calls `assert_test_env!()` (Rust) or `assertTestEnv()` (TypeScript) as its first line — no exceptions
- **Preferred alternatives:** real in-memory implementations, test databases (SQLite, Postgres in a container), local service containers via Docker Compose

---

## AGENTS.md additions

### `## Mocks` section
> Before writing any mock, read `docs/development/mocks.md`. Every mock must call `assert_test_env!()` (Rust) or `assertTestEnv()` (TypeScript) as its first line — this throws immediately if `APP_ENV != "test"`, preventing mocks from ever running in production.

### `## Package naming conventions` section
> Prefixes in `ws_packages/` are optional but encouraged when there is a meaningful grouping to signal. A prefix keeps related packages co-located in directory listings and adds key information at a glance. Use a prefix when it genuinely clarifies the package's role; omit it when the name is already self-evident. Examples: `d_` for dev/test tooling, `i_` for infrastructure utilities.

---

## What is not in scope

- A lint rule flagging mock imports outside test files (additive, can be layered later)
- Python support (no current need; the `APP_ENV` convention and pattern apply if Python mocks are added)
- Enforcement via CI (the runtime throw is the gate; CI runs tests with `APP_ENV=test` set, so the guard passes in tests and would catch any accidental non-test use)
