# `harness/stack`

Working stack-manager slot implementation ported from the lab.

The active implementation is Node/TypeScript and provides:

- per-worktree isolation from git root + branch
- deterministic port allocation
- `.harness/<iso>.env` writing
- generated compose overlays that include `harness/observability/compose.harness.yml`
- CLI commands: `boot`, `stop`, `destroy`, `inspect`, `ports`, and `doctor`

Run from the repository root:

```sh
just stack inspect
just stack ports
just stack boot
just stack stop
just stack destroy
just stack doctor
```

The Rust stub that originally occupied this slot is preserved under
`harness/stack/rust-stub/` as the future ADR-0001 target. The TypeScript
implementation is the working interim stack-manager so the template has an
operational slot before the Rust `bollard` + `portpicker` binary lands.

## Configuration

If a root `harness.config.ts` exists, the stack manager loads it with
`defineHarnessConfig`. If it does not exist, the manager uses an empty default
config and boots only the harness observability compose file.

Consumer services can be added with:

```ts
import { defineHarnessConfig } from './harness/stack/src/index.js';

export default defineHarnessConfig({
  services: {
    web: { build: './ws_apps/example-typescript', port: 'WEB_PORT', healthcheck: '/' },
  },
  telemetry: { services: ['web'] },
});
```

## Tests

```sh
corepack pnpm --filter @harness/stack test
corepack pnpm --filter @harness/stack typecheck
```
