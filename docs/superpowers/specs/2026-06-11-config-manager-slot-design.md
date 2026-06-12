# Config-Manager Slot Design

**Date:** 2026-06-11
**Status:** approved
**Author:** NeuralEmpowerment

## Problem

The harness has 11 slots. None covers centralized config/env-var management or runtime secret provisioning. The `secret-scanner` slot (Gitleaks) only prevents leaks at commit time. Individual slots declare their own env vars with no shared schema, no fast-fail validation, no `.env.example` codegen, and no secret sourcing strategy.

## Patterns synthesized

Two reference implementations informed this design:

- **Syntropic137** (`packages/syn-shared/src/syn_shared/settings/`): Pydantic `BaseSettings` subclass as single source of truth. Typed fields with descriptions. `generate_env_example.py` introspects `model_fields` → emits `.env.example` with comments and `[REQUIRED]` markers. `sync_env_file()` idempotently reconciles `.env` (preserves values, archives removed vars). Fast-fail via `get_settings()` at startup.
- **OpenClaw Hermes** (`scripts/config/env.ts`): Central TypeScript registry with `{envVar, required, description, opRef}` per entry. `decideSource()` priority: literal `.env` > `1Password op://` ref > missing. Three OP auth modes: service account token → desktop integration → shell session. Emits `.env.runtime` consumed via `op run --env-file=.env.runtime -- <cmd>` — secrets never touch disk as plaintext.

## Rust ecosystem gap

No production-stable Rust crate replicates pydantic-settings. `figment` + `envconfig` cover typed deserialization and fail-fast startup. `procenv` is the only crate with `.env.example` generation, but the author labels it a learning project. Field descriptions and codegen are gaps the harness binary fills by owning the schema in a declarative TOML file.

## Design

### Slot identity

| Field | Value |
|---|---|
| Slot name | `config-manager` |
| Required | yes |
| Interface type | CLI binary |
| Entrypoint | `harness/config-manager/` (Rust crate) |
| Just surface | `just config <subcommand>` |

### Single source of truth: `config.toml`

Lives at the repo root. The `[config]` table holds global settings; each `[[var]]` entry declares one environment variable.

```toml
[config]
version    = "1"
app_prefix = "MYAPP"      # drives token namespacing: MYAPP_OP_SERVICE_ACCOUNT_TOKEN

[[var]]
name        = "DATABASE_URL"
description = "PostgreSQL connection string for the primary database"
required    = true

[[var]]
name        = "ANTHROPIC_API_KEY"
description = "Anthropic API key for LLM features"
required    = true
op_ref      = "op://Personal/my-project/anthropic_api_key"

[[var]]
name        = "LOG_LEVEL"
description = "Log verbosity level: debug | info | warn | error"
required    = false
default     = "info"

[[var]]
name        = "PORT"
description = "HTTP server port"
required    = false
default     = "8080"
```

`op_ref` is optional per-var. Omitting it means that var is always sourced from `.env` / ambient env — no OP invocation.

### CLI interface

```
harness config check            # validate all required vars; report ALL missing at once (not fail-on-first)
harness config sync             # regenerate .env.example; sync .env (preserve values, archive removed)
harness config exec -- <cmd>    # resolve op:// refs, inject into subprocess env (CI / just run)
harness config source           # emit shell exports to stdout: eval $(harness config source)
harness config show             # pretty-print resolved config, masking secret values
```

`just` surface (in `justfile`):
```just
config CMD *ARGS:
    harness/config-manager/target/release/config-manager {{CMD}} {{ARGS}}
```

`just bootstrap` calls `just config check` — missing vars are caught immediately on clone.

### `.env.example` generation

`harness config sync` writes `.env.example` from `config.toml`:

```bash
# PostgreSQL connection string for the primary database
# [REQUIRED]
DATABASE_URL=

# Anthropic API key for LLM features
# [REQUIRED] | 1Password: op://Personal/my-project/anthropic_api_key
ANTHROPIC_API_KEY=

# Log verbosity level: debug | info | warn | error
LOG_LEVEL=info

# HTTP server port
PORT=8080
```

Developers never hand-edit `.env.example`. Running `just config sync` after any change to `config.toml` is the only maintenance operation.

### `.env` sync — idempotent, safe to run any time

1. Parse existing `.env`, preserving all current values exactly.
2. Walk `.env.example` entries — write the existing value if present, else the default.
3. Vars in `.env` not present in `config.toml` are appended under `# ARCHIVED VARIABLES` at the bottom. Never silently deleted.

### 1Password resolver

**Priority chain per var (if `op_ref` present):**
1. `<APP_PREFIX>_OP_SERVICE_ACCOUNT_TOKEN` in env → headless/CI service account, mapped to `OP_SERVICE_ACCOUNT_TOKEN` inside the `op` subprocess only
2. `op` CLI + 1Password.app desktop integration → Touch ID, interactive dev
3. `OP_MODE=off` → skip OP entirely for all vars

**Fallback:** if `op` is not installed, `op_ref` is absent, or `OP_MODE=off`, the var is sourced from `.env` / ambient env silently. No error.

**Token namespacing:** `<APP_PREFIX>_OP_SERVICE_ACCOUNT_TOKEN` is project-scoped. Multiple projects on the same machine have separate tokens. The binary maps the prefixed token to the canonical `OP_SERVICE_ACCOUNT_TOKEN` only inside the `op` subprocess — the developer's shell env is untouched.

**`exec` mode** (CI / `just run`):
- Resolves all `op_ref` values via `op` subprocess
- Injects resolved values as real env vars into the wrapped command
- Secrets never written to disk as plaintext

**`source` mode** (interactive dev):
- Emits `export KEY="value"` lines to stdout
- Developer runs `eval $(harness config source)`
- `.env.runtime` is written as a gitignored ephemeral file for tools that need a file path

### Removability

The 1Password layer is contained entirely in:
- `op_ref` fields in `config.toml` (just delete them)
- `harness/config-manager/src/resolver/op.rs` (delete the module)
- The resolver dispatch in `resolver/mod.rs` (remove the OP arm)

The core typed-config, codegen, and validation continues to work with OP removed.

### Rust implementation structure

```
harness/config-manager/
├── Cargo.toml
├── src/
│   ├── main.rs          # CLI entry (clap subcommands: check, sync, exec, source, show)
│   ├── schema.rs        # config.toml parsing — serde + toml
│   ├── env_file.rs      # .env read/write + sync logic + archive
│   ├── codegen.rs       # .env.example generation
│   ├── check.rs         # validation — aggregates ALL missing vars before failing
│   ├── resolver/
│   │   ├── mod.rs       # resolver trait + dispatch (op → env fallback)
│   │   ├── op.rs        # 1Password subprocess invocation (op run / op read)
│   │   └── env.rs       # ambient env + dotenvy .env fallback
│   └── exec.rs          # subprocess wrapper (config exec -- <cmd>)
```

**Key crates:** `serde` + `toml` (schema), `dotenvy` (`.env` loading), `clap` (CLI), `which` (detect `op` binary), `std::process::Command` (OP subprocess + exec wrapper). No OP SDK — everything goes through the `op` CLI binary.

### Testing

- **Unit:** schema parsing, codegen output shape, sync add/remove/archive logic, check error aggregation
- **Integration:** `config exec -- env` round-trip with fixture `config.toml` + mock `.env`
- **OP tests:** gated behind `#[cfg(feature = "op-integration")]` — skipped in CI unless `<APP_PREFIX>_OP_SERVICE_ACCOUNT_TOKEN` is present

### ADR

A slot ADR will be written at `docs/adrs/ADR-NNNN-config-manager.md` following the existing APSS ADR01 format, linking to this spec and the Syntropic137 / OpenClaw Hermes reference implementations.
