// env.ts
//
// Illustrative example: a typed configuration registry in TypeScript.
//
// This is ONE valid shape, not the canonical one. It matches a homelab/IaC
// project where the registry also drove an SSM-push step and 1Password
// resolution, so each entry carries ssmName, ssmType, pushToSsm, and opRef.
// A project without those concerns would carry less metadata; a different
// project might validate with zod/valibot, key by env-var name, or use a
// class-based shape. The durable property is the one below, not these field
// names.
//
// Durable property: env-var names live in a typed object, not as magic
// strings scattered across the codebase. Calling code uses readSecret(key),
// never process.env["..."]. Downstream tools (gen-env-example, sync-secrets,
// doctor, gen-ssm-params) all read from this object. Nothing else is
// authoritative on env-var names.
//
// See the SLP at ../../../SKILL.md (principles 1, 2, 8, 9) for the rationale.

export type SsmType = "SecureString" | "String";

export interface SecretDef {
  /** Parameter name in the remote secret store (e.g. SSM under /<project>/<env>/). */
  readonly ssmName: string;
  /** Name of the env var the application reads. */
  readonly envVar: string;
  /** Storage type in the remote store. */
  readonly ssmType: SsmType;
  /** If true, missing or unresolved value is a hard failure at startup. */
  readonly required: boolean;
  /** If true, sync-secrets pushes the resolved value to the remote store. */
  readonly pushToSsm: boolean;
  /** Used in .env.example comments and doctor output. */
  readonly description: string;
  /** Suggested 1Password reference (op://<vault>/<item>/<field>). */
  readonly opRef?: string;
}

const OP_VAULT = process.env.OP_VAULT ?? "Personal";
const OP_ITEM = `op://${OP_VAULT}/example-project`;

export const SECRETS = {
  // ─── Application ──────────────────────────────────────────────────────────

  app_environment: {
    ssmName: "app_environment",
    envVar: "APP_ENVIRONMENT",
    ssmType: "String",
    required: false,
    pushToSsm: true,
    description:
      "Current environment: development | staging | production | test. " +
      "Affects logging verbosity and feature defaults.",
  },

  // ─── Database (principle 5: no production-relevant default) ───────────────

  database_url: {
    ssmName: "database_url",
    envVar: "DATABASE_URL",
    ssmType: "SecureString",
    required: true,
    pushToSsm: true,
    description:
      "Postgres DSN. Format: postgresql://user:password@host:port/database. " +
      "Required in production. No safe default exists.",
    opRef: `${OP_ITEM}/database_url`,
  },

  // ─── Secrets (principle 4) ────────────────────────────────────────────────

  api_key: {
    ssmName: "api_key",
    envVar: "API_KEY",
    ssmType: "SecureString",
    required: false,
    pushToSsm: true,
    description:
      "Third-party API key. Loaded from secret store. Never committed to source.",
    opRef: `${OP_ITEM}/api_key`,
  },

  // ─── Feature flags (principle 9: default-on with X_DISABLED opt-out) ──────

  polling_disabled: {
    ssmName: "polling_disabled",
    envVar: "POLLING_DISABLED",
    ssmType: "String",
    required: false,
    pushToSsm: false,
    description:
      "Set 'true' to force-disable the background poller on this host. " +
      "Default-on; explicit opt-out.",
  },

  metrics_disabled: {
    ssmName: "metrics_disabled",
    envVar: "METRICS_DISABLED",
    ssmType: "String",
    required: false,
    pushToSsm: false,
    description:
      "Set 'true' to disable metrics emission. Default-on for stable observability.",
  },
} as const satisfies Record<string, SecretDef>;

export type SecretKey = keyof typeof SECRETS;

/** Read the current value of a registered env var. Always prefer this over process.env. */
export function readSecret(key: SecretKey): string | undefined {
  return process.env[SECRETS[key].envVar];
}

/** Stable [key, def] iteration order for downstream tooling. */
export function listSecrets(): ReadonlyArray<readonly [SecretKey, SecretDef]> {
  return Object.entries(SECRETS) as Array<[SecretKey, SecretDef]>;
}

/** Boolean read with disable-flag semantics: empty / "false" / "0" -> false. */
export function isDisabled(key: SecretKey): boolean {
  const raw = readSecret(key)?.toLowerCase().trim();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}
