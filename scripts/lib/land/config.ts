import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG_FILE = 'land.config.json';

/**
 * A gate is a lefthook pre-push job (`job`, defaulting to `name`) or, when `run`
 * is set, a shell command. Omitting `when` makes the gate unconditional.
 */
export interface GateConfig {
  name: string;
  run?: string;
  when?: string[];
  /** Programs that must be on PATH. Many hooks soft-skip when a tool is missing; landing must not. */
  requires?: string[];
}

export interface CheckConfig {
  name: string;
  run: string;
  /** Where the command runs. `source` is the invoking checkout, never the applied ref. */
  cwd?: 'worktree' | 'source';
}

export interface LandConfig {
  remote: string;
  targetBranch: string;
  /** Wait while the 1-minute load average exceeds this. */
  loadMax: number;
  /** Shell command that exits 0 when the machine is quiet. Catches I/O-bound starvation that load average misses (for example a disk-bound box). */
  quietCommand: string | null;
  loadPollSeconds: number;
  loadWaitMaxSeconds: number;
  lockWaitMaxSeconds: number;
  /** Env var carrying the exact validated SHA to the pre-push main guard. */
  markerEnv: string;
  lefthook: string;
  /** How lefthook selects jobs: --job/--command repeat per name (lefthook 2.x); --jobs/--commands take a comma list (1.x). */
  lefthookSelector: '--job' | '--command' | '--jobs' | '--commands';
  /** Re-apply attempts when the target branch moves during validation. */
  maxAttempts: number;
  /** Reuse a gate's green result across a re-apply when the SHA delta provably misses its scopes. */
  inheritUnaffectedEvidence: boolean;
  scopes: Record<string, string[]>;
  full: string[];
  /** Globs a direct push to the target branch may change without the land gate. */
  metadataSafe: string[];
  /** Tracked paths gates may legitimately rewrite (for example a findings log). Any other change after gating aborts. */
  ignoreDirty: string[];
  bootstrap: { run: string; when?: string[] } | null;
  preflight: CheckConfig[];
  /** Checks that run once the plan is printed, before bootstrap and any gate, so a doomed landing fails before it spends minutes. */
  earlyChecks: CheckConfig[];
  gates: GateConfig[];
  checks: CheckConfig[];
  env: Record<string, string>;
}

export const DEFAULT_CONFIG: LandConfig = {
  remote: 'origin',
  targetBranch: 'main',
  loadMax: 40,
  quietCommand: null,
  loadPollSeconds: 15,
  loadWaitMaxSeconds: 1800,
  lockWaitMaxSeconds: 0,
  markerEnv: 'HARNESS_LAND_GATE',
  lefthook: 'lefthook',
  lefthookSelector: '--job',
  maxAttempts: 3,
  inheritUnaffectedEvidence: false,
  scopes: {},
  full: [],
  metadataSafe: [],
  ignoreDirty: [],
  bootstrap: null,
  preflight: [],
  earlyChecks: [],
  gates: [],
  checks: [],
  env: {},
};

/** Guards that must run on every push; listing one as a gate would let the land flow exclude it. */
export const PROTECTED_JOBS: readonly string[] = [
  'guard-main-push',
  'push-scope-guard.sh',
  'push-scope-guard',
];

const NAME_RE = /^[A-Za-z0-9._-]+$/;

function fail(message: string): never {
  throw new Error(`${CONFIG_FILE}: ${message}`);
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    return fail(`${label} must be an array of strings`);
  }
  return value as string[];
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fail(`${label} must be a non-negative number`);
  }
  return value;
}

function requireName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !NAME_RE.test(value)) {
    return fail(`${label} must match ${NAME_RE}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseGate(raw: unknown, label: string): GateConfig {
  if (!isRecord(raw)) return fail(`${label} must be an object`);
  const gate: GateConfig = { name: requireName(raw.name, `${label}.name`) };
  if (raw.run !== undefined) {
    if (typeof raw.run !== 'string') return fail(`${label}.run must be a string`);
    gate.run = raw.run;
  }
  if (raw.when !== undefined) gate.when = requireStringArray(raw.when, `${label}.when`);
  if (raw.requires !== undefined)
    gate.requires = requireStringArray(raw.requires, `${label}.requires`);
  if (PROTECTED_JOBS.includes(gate.name)) {
    return fail(`${label}: ${gate.name} is a guard and may never be skipped at push time`);
  }
  return gate;
}

function parseCheck(raw: unknown, label: string): CheckConfig {
  if (!isRecord(raw) || typeof raw.run !== 'string') return fail(`${label} needs a run string`);
  const cwd = raw.cwd ?? 'worktree';
  if (cwd !== 'worktree' && cwd !== 'source') return fail(`${label}.cwd must be worktree|source`);
  return { name: requireName(raw.name, `${label}.name`), run: raw.run, cwd };
}

function parseList<T>(raw: unknown, label: string, parse: (v: unknown, l: string) => T): T[] {
  if (!Array.isArray(raw)) return fail(`${label} must be an array`);
  return raw.map((item, i) => parse(item, `${label}[${i}]`));
}

function parseScopes(raw: unknown): Record<string, string[]> {
  if (!isRecord(raw)) return fail('scopes must be an object');
  return Object.fromEntries(
    Object.entries(raw).map(([name, globs]) => [
      requireName(name, 'scope name'),
      requireStringArray(globs, `scopes.${name}`),
    ]),
  );
}

function parseBootstrap(raw: unknown): LandConfig['bootstrap'] {
  if (!isRecord(raw) || typeof raw.run !== 'string') return fail('bootstrap needs a run string');
  const when = raw.when === undefined ? undefined : requireStringArray(raw.when, 'bootstrap.when');
  return when === undefined ? { run: raw.run } : { run: raw.run, when };
}

function parseEnv(raw: unknown): Record<string, string> {
  if (!isRecord(raw) || Object.values(raw).some((v) => typeof v !== 'string')) {
    return fail('env must be an object of strings');
  }
  return raw as Record<string, string>;
}

type Parser = (config: LandConfig, raw: unknown) => void;

const NUMBER_KEYS = [
  'loadMax',
  'loadPollSeconds',
  'loadWaitMaxSeconds',
  'lockWaitMaxSeconds',
  'maxAttempts',
] as const;
const STRING_KEYS = ['remote', 'targetBranch', 'markerEnv', 'lefthook'] as const;

const PARSERS: Record<string, Parser> = {
  scopes: (c, v) => {
    c.scopes = parseScopes(v);
  },
  full: (c, v) => {
    c.full = requireStringArray(v, 'full');
  },
  ignoreDirty: (c, v) => {
    c.ignoreDirty = requireStringArray(v, 'ignoreDirty');
  },
  metadataSafe: (c, v) => {
    c.metadataSafe = requireStringArray(v, 'metadataSafe');
  },
  bootstrap: (c, v) => {
    c.bootstrap = parseBootstrap(v);
  },
  preflight: (c, v) => {
    c.preflight = parseList(v, 'preflight', parseCheck);
  },
  earlyChecks: (c, v) => {
    c.earlyChecks = parseList(v, 'earlyChecks', parseCheck);
  },
  gates: (c, v) => {
    c.gates = parseList(v, 'gates', parseGate);
  },
  checks: (c, v) => {
    c.checks = parseList(v, 'checks', parseCheck);
  },
  env: (c, v) => {
    c.env = parseEnv(v);
  },
  inheritUnaffectedEvidence: (c, v) => {
    if (typeof v !== 'boolean') fail('inheritUnaffectedEvidence must be a boolean');
    c.inheritUnaffectedEvidence = v as boolean;
  },
};
for (const key of NUMBER_KEYS) {
  PARSERS[key] = (c, v) => {
    c[key] = requireNumber(v, key);
  };
}
for (const key of STRING_KEYS) {
  PARSERS[key] = (c, v) => {
    c[key] = requireName(v, key);
  };
}
const SELECTORS = ['--job', '--command', '--jobs', '--commands'] as const;
PARSERS.lefthookSelector = (c, v) => {
  const found = SELECTORS.find((selector) => selector === v);
  if (found === undefined) fail(`lefthookSelector must be one of ${SELECTORS.join(', ')}`);
  c.lefthookSelector = found as (typeof SELECTORS)[number];
};
PARSERS.quietCommand = (c, v) => {
  if (typeof v !== 'string' || v === '') fail('quietCommand must be a non-empty string');
  c.quietCommand = v as string;
};
PARSERS.lefthook = (c, v) => {
  if (typeof v !== 'string' || v === '') fail('lefthook must be a non-empty string');
  c.lefthook = v as string;
};

export function parseConfig(raw: unknown): LandConfig {
  if (!isRecord(raw)) return fail('must be a JSON object');
  const config: LandConfig = structuredClone(DEFAULT_CONFIG);
  for (const [key, value] of Object.entries(raw)) {
    const parser = PARSERS[key];
    if (key === '$schema' || key === '$comment') continue;
    if (parser === undefined) return fail(`unknown key ${key}`);
    parser(config, value);
  }
  return config;
}

/** Absent file means defaults; a malformed file is loud, never silently ignored. */
export function loadConfig(root: string): LandConfig {
  const path = join(root, CONFIG_FILE);
  if (!existsSync(path)) return structuredClone(DEFAULT_CONFIG);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `${CONFIG_FILE}: not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  return parseConfig(raw);
}
