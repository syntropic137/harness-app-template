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

Jest/vitest sets `APP_ENV=test` via `env` in `vitest.config.ts` so the guard
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
