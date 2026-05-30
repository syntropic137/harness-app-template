# infra/doctor

Per-language environment probes consumed by `pnpm harness doctor`.

## Usage

```sh
pnpm harness doctor                   # all probes; exits 1 if any fail
pnpm harness doctor cpp-unreal        # one probe
pnpm harness doctor --json            # machine-readable
pnpm harness doctor --explain <id>    # remediation only, no execution
```

## Shipping probes

Each `*.yaml` file in this directory is one probe. Files starting with `_` are skipped (reserved for future schema docs).

Schema (validated by zod via `harness/stack/src/doctor-schema.ts`):

```yaml
name: my-probe
description: one-line summary of what this checks
checks:
  - id: short-id
    description: human-readable check description
    command: ["binary", "arg1", "arg2"]   # array, not shell string
    expect_exit: 0                         # optional, default 0
    expect_stdout_contains: "substring"    # optional
    expect_stdout_match: "^regex$"         # optional
    platform: mac | linux | win | any     # optional, default any
    remediation: |
      Multi-line text shown when this check fails.
      Used both for human eyes and agent context.
```

A check passes if exit code matches AND (if set) stdout substring matches AND (if set) stdout regex matches.

## Current probes

- `cpp-unreal.yaml` — Unreal Engine 5.7 + C++ (Xcode, git-lfs, UE install, cmake, opentelemetry-cpp libs)
- `docker.yaml` — Docker engine + compose plugin
- `python.yaml` — Python 3.12 + uv + ruff
- `rust.yaml` — rustc + cargo + rustfmt + clippy
- `typescript.yaml` — node 20+ + pnpm + optional bun
