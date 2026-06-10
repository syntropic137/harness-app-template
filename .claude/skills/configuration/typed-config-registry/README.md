# Typed Config Registry

Deep-dive companion to the `configuration` SLP, principle 1 (one typed registry as the single source of truth) and principle 2 (generate the schema; sync the local file idempotently).

This document shows two registry shapes that satisfy the principle: Python with Pydantic Settings, and TypeScript with a typed object literal. Both ship the same property: every downstream tool (`.env.example` generator, secret sync, doctor checks, infra param emission) reads from the registry, never from a hand-maintained list.

## Why a registry, not just a typed object

Reaching for "a typed config object" usually means "a class that loads env vars and exposes them as fields." That covers reading. It does not cover the full set of jobs a configuration surface has to do:

- Emit a `.env.example` for new contributors.
- Emit a `JSON Schema` or terraform tfvars for downstream tooling.
- Tell `doctor` which fields are required and where to look for them (1Password, AWS SSM, Vault).
- Sync values from a secret store to the deploy target.
- Detect drift between code and example.

A registry is a typed object with **enough metadata per field** that the same object answers all of those questions. The registry's metadata is the authoritative description of every variable; everything else reads from it.

## Python: Pydantic Settings

Reference files (illustrative; copy and rename to fit your project layout):

- [examples/python/config.py](examples/python/config.py): the typed registry as a `BaseSettings` subclass. Every field has a description, type, default, and constraint metadata; secrets use `SecretStr`; feature flags follow the disable-flag shape.
- [examples/python/generate_env_example.py](examples/python/generate_env_example.py): introspects the class to emit `.env.example` and to overlay an existing `.env` idempotently. Read-then-write only; values are never printed.
- [examples/python/.env.example](examples/python/.env.example): what the generator emits. Comments come from each `Field(description=...)`.

Sketch of the registry shape:

```python
# config.py
from enum import StrEnum
from typing import Annotated
from pydantic import Field, PostgresDsn, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppEnvironment(StrEnum):
    DEVELOPMENT = "development"
    PRODUCTION = "production"
    TEST = "test"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_environment: AppEnvironment = Field(
        default=AppEnvironment.DEVELOPMENT,
        description="Current environment. Affects logging verbosity and feature flags.",
    )

    database_url: Annotated[
        PostgresDsn | None,
        Field(
            default=None,
            description=(
                "Postgres DSN. Format: postgresql://user:password@host:port/database. "
                "Required in production; defaults to the docker-compose URL in development."
            ),
        ),
    ] = None

    request_timeout_seconds: int = Field(
        default=30,
        ge=1,
        le=300,
        description="HTTP client request timeout. Increase for slow downstreams.",
    )

    api_key: SecretStr | None = Field(
        default=None,
        description="Third-party API key. Loaded from secret store; never committed.",
    )

    # Disable-flag pattern (principle 9). Default-on; explicit opt-out.
    polling_disabled: bool = Field(
        default=False,
        description="Set true to disable the GitHub events poller in this deployment.",
    )
```

The example generator introspects fields and emits `.env.example` from them. Sketch:

```python
# scripts/generate_env_example.py
def render_field(name: str, info) -> str:
    description = info.description or ""
    default = "" if info.default in (None,) else str(info.default)
    return f"# {description}\n{name.upper()}={default}\n"
```

The same script can also overlay a `.env`: for each field, add `KEY=` if missing, leave existing values untouched. That makes "regenerate" idempotent rather than destructive.

### Idempotent overlay

The contract for syncing the local `.env`:

1. Read the existing `.env` into a dict.
2. For each registry field, if the key is absent, append `KEY=<default-or-blank>` with a comment from the description.
3. Preserve existing values unchanged.
4. Print removed-but-still-present keys as a warning rather than deleting them.

This is the difference between "regenerate is safe to run any time" and "regenerate destroys my work." The first encourages contributors to use the tool; the second teaches them to avoid it.

### Secure handling of values

The overlay tool's job is to manage **shape**, not to surface **values**. Existing values are read into memory only long enough to write them back to the file. The tool never prints, logs, or echoes them: stdout/stderr output is restricted to counts (added, preserved) and key names (which are not secret; the registry already enumerates them publicly in `.env.example`).

This matters because contributors run the tool casually, often piping its output into terminals that may be screen-shared, copied into chat, or captured by CI logs. A "regenerate" tool that prints the value of `API_KEY` to confirm it was preserved has just leaked the secret into the developer's shell history. Treat the `.env` as a write-mostly-read-never artifact from the tool's perspective: enumerate the keys it touched, never the values it touched.

Apply the same discipline to any extension: doctor checks may report "API_KEY: present" or "API_KEY: missing", never the value itself; secret-sync may report "pushed 12 entries to SSM", never which secret resolved to what. Reference implementations: [examples/python/generate_env_example.py](examples/python/generate_env_example.py) and [examples/typescript/gen-env-example.ts](examples/typescript/gen-env-example.ts) both follow this contract.

## TypeScript: typed registry object

The durable property is simple: **env-var names live in a typed object, not as magic strings scattered across the codebase**. The exact shape of that object is a project-level choice. The example below is one shape that worked well on a homelab/IaC project where the registry also drove an SSM-push step and 1Password resolution; a project without those concerns would carry less metadata. Other valid shapes include a flat `as const` of names with a separate type-validated parser (zod, valibot), a record keyed by env-var name with type-only metadata, or a class-based config object similar to the Python example. Pick the one whose metadata fits the downstream tools you actually run.

Reference files (illustrative; the SSM/op-ref fields are not load-bearing):

- [examples/typescript/env.ts](examples/typescript/env.ts): typed registry via `as const satisfies Record<string, SecretDef>`. Each entry carries env-var name, secret-store name, type, required-ness, push-to-remote flag, description, and an optional `op://` reference. A `readSecret(key)` helper exists so callers reference typed keys, never literal env-var names.
- [examples/typescript/gen-env-example.ts](examples/typescript/gen-env-example.ts): walks the registry to emit `.env.example` and to overlay an existing `.env` idempotently. Same secure-handling guarantee as the Python version: counts and key names only, never values.
- [examples/typescript/.env.example](examples/typescript/.env.example): what the generator emits.

Sketch of the registry shape:

```typescript
// env.ts
export type SsmType = "SecureString" | "String";

export interface SecretDef {
  /** SSM parameter name (appended to /<project>/<env>/). */
  readonly ssmName: string;
  /** Name of the env var the project reads. */
  readonly envVar: string;
  readonly ssmType: SsmType;
  /** If true, missing or unresolved value is a hard failure. */
  readonly required: boolean;
  /** If true, sync-secrets pushes the value to AWS SSM. */
  readonly pushToSsm: boolean;
  /** Used in .env.example comments and doctor output. */
  readonly description: string;
  /** Suggested 1Password reference. */
  readonly opRef?: string;
}

const OP_VAULT = process.env.OP_VAULT ?? "Personal";
const OP_ITEM = `op://${OP_VAULT}/my-project`;

export const SECRETS = {
  database_url: {
    ssmName: "database_url",
    envVar: "DATABASE_URL",
    ssmType: "SecureString",
    required: true,
    pushToSsm: true,
    description: "Postgres DSN for the application database.",
    opRef: `${OP_ITEM}/database_url`,
  },
  api_key: {
    ssmName: "api_key",
    envVar: "API_KEY",
    ssmType: "SecureString",
    required: false,
    pushToSsm: true,
    description: "Third-party API key. Required in production.",
    opRef: `${OP_ITEM}/api_key`,
  },
  whisper_disabled: {
    ssmName: "whisper_disabled",
    envVar: "WHISPER_DISABLED",
    ssmType: "String",
    required: false,
    pushToSsm: false,
    description: "Set to 'true' to force-disable the whisper feature on this host.",
  },
} as const satisfies Record<string, SecretDef>;

export type SecretKey = keyof typeof SECRETS;

export function readSecret(key: SecretKey): string | undefined {
  return process.env[SECRETS[key].envVar];
}

export function listSecrets(): ReadonlyArray<readonly [SecretKey, SecretDef]> {
  return Object.entries(SECRETS) as Array<[SecretKey, SecretDef]>;
}
```

Downstream tools each read from `SECRETS`:

- `gen-env-example.ts` walks `listSecrets()` and emits `.env.example`.
- `sync-secrets.ts` walks the same list and pushes `pushToSsm: true` entries to AWS SSM after resolving `opRef` values.
- `doctor.ts` walks the list and reports which entries are missing from the env or the secret store.
- `gen-ssm-params.ts` emits a Terraform tfvars sidecar so infra and application code agree on parameter names.

If anyone is tempted to hardcode `process.env.DATABASE_URL` outside this registry, the principle is violated. The `readSecret(key)` helper exists so callers reference the typed key, not the literal string.

## Feature flags in the registry

Disable-flag entries (principle 9) belong in the same registry. They are configuration; they need the same `.env.example` documentation, the same doctor coverage, and the same no-magic-string treatment. A separate "feature flags" file is a parallel registry that re-introduces every problem the typed registry was meant to solve.

The registry can also carry `disableEnvVar` metadata on a per-feature record (paired with `requiredEnvVars`) so a "feature inventory" tool can report each feature's status as one of: enabled, disabled-missing-config, disabled-override.

## Principles this realizes

- **Principle 1 (typed registry):** the registry holds every variable name once; downstream tools read from it; magic strings in calling code disappear.
- **Principle 2 (generate the schema, sync idempotently):** `.env.example` is emitted from the registry, not hand-edited; `.env` overlay adds missing keys without clobbering existing values.
- **Principle 8 (smart defaults absorb complexity):** registry fields ship sensible development defaults so the project runs on a fresh clone with minimal explicit configuration.
- **Principle 9 (feature flags as configuration):** disable-flags live in the registry alongside everything else, and the default-on shape keeps the running system aligned with how it is designed to behave.
