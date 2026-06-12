---
name: "config-manager slot"
description: "Centralized env-var schema, .env.example codegen, and secret resolution"
status: accepted
---

# ADR-0012: config-manager slot

**Date:** 2026-06-11
**Category:** Slot
**Next review:** 2026-12-11

## Context

The harness had no slot for centralized env-var management or runtime secret provisioning. Individual slots declared their own env vars ad hoc with no schema, no fast-fail validation, and no `.env.example` codegen. The `secret-scanner` slot only prevents leaks at commit time.

## Decision

Add a `config-manager` slot implemented as a Rust binary at `harness/config-manager/`. Single source of truth is `config.toml` at the repo root. The binary provides five subcommands: `check`, `sync`, `exec`, `source`, `show`.

Key design decisions:
- **`config.toml`** declares each var with name, description, required flag, default, optional `op_ref`, optional `secret` flag
- **`check`** aggregates all missing required vars before failing (not fail-on-first), reads `.env` via dotenvy
- **`sync`** generates `.env.example` from schema and reconciles `.env` — preserves existing values, archives removed vars under `# ARCHIVED VARIABLES`
- **`exec`** resolves secrets and injects into subprocess env; secrets never written to disk as plaintext
- **1Password resolver** is opt-in per-var via `op_ref` field; token is project-namespaced (`<APP_PREFIX>_OP_SERVICE_ACCOUNT_TOKEN`) to prevent collision across projects on shared machines

## Alternatives considered

- **Per-language libraries** (pydantic-settings in Python, figment in Rust): couples config schema to each workspace's language. Rejected — polyglot repos need one schema, not N schemas.
- **Two separate slots** (config schema + secret resolver): adds slot count complexity without benefit. The 1Password layer is opt-in per-var and removable without touching the core.
- **Existing Rust crates** (`procenv`, `envconfig`): `procenv` has `.env.example` generation but author labels it a learning project; others lack field descriptions and codegen. The declarative `config.toml` approach avoids Rust proc-macro complexity entirely.

## Reference implementations

- **Syntropic137** (`packages/syn-shared/src/syn_shared/settings/`): Pydantic BaseSettings with `.env.example` codegen and idempotent sync.
- **OpenClaw Hermes** (`scripts/config/env.ts`): TypeScript central registry with 1Password priority chain and `op run` subprocess injection.

## Consequences

- `just bootstrap` now calls `just config check` — missing required vars surface immediately on clone
- Developers maintain `config.toml`; `.env.example` is generated, never hand-edited
- Removing 1Password support: delete `op_ref` fields from `config.toml` and `harness/config-manager/src/resolver/op.rs`
- Removing the slot entirely: delete `harness/config-manager/`, the `config` recipe, and `just config check` from bootstrap
