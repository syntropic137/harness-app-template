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
  /** Where a command gate runs: the landing worktree (default) or the invoking checkout, which the applied ref cannot alter. */
  cwd?: 'worktree' | 'source';
  /** Gates that share a lane run one after another, never concurrently (for example two suites that starve each other). Omitted: a command gate gets its own lane; a lefthook gate joins the one lefthook batch. A laned lefthook gate runs alone in its lane (bead kzyyk). */
  lane?: string;
  /** As CheckConfig.retryOnOutput, for a command gate. */
  retryOnOutput?: string;
  when?: string[];
  /** Programs that must be on PATH. Many hooks soft-skip when a tool is missing; landing must not. */
  requires?: string[];
  /**
   * A cheap structural gate (seconds): the early gates run, and must pass, before any other gate
   * starts, so a run fails in seconds on them instead of after the heavy lanes (bead luyfr.2).
   */
  early?: boolean;
}

export interface CheckConfig {
  name: string;
  run: string;
  /** Where the command runs. `source` is the invoking checkout, never the applied ref. */
  cwd?: 'worktree' | 'source';
  /** Regex; when the command fails and its output matches, it is run once more (for example a known flaky infrastructure timeout). */
  retryOnOutput?: string;
}

/** A prepare step: a check that runs only when its scopes apply (omit `when` to always run). */
export interface PrepareConfig extends CheckConfig {
  when?: string[];
}

export interface LandConfig {
  remote: string;
  targetBranch: string;
  /** Wait while the 1-minute load average exceeds this. */
  loadMax: number;
  /** Shell command that exits 0 when the machine is quiet. Catches I/O-bound starvation that load average misses (for example a disk-bound box). */
  quietCommand: string | null;
  /** Shell command whose one-line output is recorded in the run receipt when the lease is taken and when the run ends (for example an I/O pressure reading). Recorded only; it never gates. */
  sampleCommand: string | null;
  loadPollSeconds: number;
  loadWaitMaxSeconds: number;
  /**
   * Admission (bead luyfr.3): verify starts its heavy lanes only once the machine has at least this
   * much idle CPU (percent; 0 turns it off), polling every loadPollSeconds for at most
   * admitWaitMaxSeconds, then starting anyway and saying so.
   */
  admitIdleMin: number;
  admitWaitMaxSeconds: number;
  /** When the machine is still busy after loadWaitMaxSeconds: refuse (`fail`, default) or log how long it waited and go on (`proceed`). */
  onLoadTimeout: 'fail' | 'proceed';
  lockWaitMaxSeconds: number;
  /** Env var carrying the exact validated SHA to the pre-push main guard. */
  markerEnv: string;
  lefthook: string;
  /** How lefthook selects jobs: --job/--command repeat per name (lefthook 2.x); --jobs/--commands take a comma list (1.x). */
  lefthookSelector: '--job' | '--command' | '--jobs' | '--commands';
  /** Re-apply attempts when the target branch moves during validation. */
  maxAttempts: number;
  /** Gate lanes (the lefthook batch is one lane, each command gate or named lane another) run at once. 1 is sequential. */
  parallelGates: number;
  /** Verification worktrees `just verify` may use at once on this machine (each is a full checkout with its own caches). */
  verifySlots: number;
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
  /**
   * Steps run in the worktree once the ref is applied, before any check or gate, on every land and
   * verify (a persistent worktree is reused, so what a previous run left in its ignored build dirs
   * stays): for example cleaning stale coverage objects. `when` scopes them like a gate.
   */
  prepare: PrepareConfig[];
  gates: GateConfig[];
  checks: CheckConfig[];
  env: Record<string, string>;
  /** Cargo target directory for every gate (a leading ~/ expands to HOME). Null means the landing worktree's own target/. The caller's CARGO_TARGET_DIR is never inherited. */
  cargoTargetDir: string | null;
  /** Programs the push-time guards need (on PATH before any push or pre-push dry run); a guard that soft-skips on a missing tool must not pass silently. */
  pushRequires: string[];
}

export const DEFAULT_CONFIG: LandConfig = {
  remote: 'origin',
  targetBranch: 'main',
  loadMax: 40,
  quietCommand: null,
  sampleCommand: null,
  loadPollSeconds: 15,
  loadWaitMaxSeconds: 1800,
  admitIdleMin: 40,
  admitWaitMaxSeconds: 1800,
  onLoadTimeout: 'fail',
  lockWaitMaxSeconds: 0,
  markerEnv: 'HARNESS_LAND_GATE',
  lefthook: 'lefthook',
  lefthookSelector: '--job',
  maxAttempts: 3,
  parallelGates: 1,
  verifySlots: 3,
  inheritUnaffectedEvidence: false,
  scopes: {},
  full: [],
  metadataSafe: [],
  ignoreDirty: [],
  bootstrap: null,
  preflight: [],
  earlyChecks: [],
  prepare: [],
  gates: [],
  checks: [],
  env: {},
  cargoTargetDir: null,
  pushRequires: [],
};

/** Guards that must run on every push; listing one as a gate would let the land flow exclude it. */
export const PROTECTED_JOBS: readonly string[] = [
  'guard-main-push',
  'push-scope-guard.sh',
  'push-scope-guard',
  // Validates every commit ahead of the base at push time; the job that caught a foreign
  // non-conventional commit. A verified pass must never exclude it.
  'versioning-release-check',
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

function requireRegex(value: unknown, label: string): string {
  if (typeof value !== 'string') return fail(`${label} must be a string`);
  try {
    new RegExp(value);
  } catch {
    return fail(`${label} must be a valid regular expression`);
  }
  return value;
}

function requireCwd(value: unknown, label: string): 'worktree' | 'source' {
  if (value !== 'worktree' && value !== 'source')
    return fail(`${label}.cwd must be worktree|source`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') return fail(`${label} must be a string`);
  return value;
}

/** Optional gate fields: parsed by key, so adding one costs a table row, not a branch. */
const GATE_OPTIONS: Record<string, (gate: GateConfig, value: unknown, label: string) => void> = {
  run: (gate, value, label) => {
    gate.run = requireString(value, `${label}.run`);
  },
  retryOnOutput: (gate, value, label) => {
    gate.retryOnOutput = requireRegex(value, `${label}.retryOnOutput`);
  },
  cwd: (gate, value, label) => {
    gate.cwd = requireCwd(value, label);
  },
  lane: (gate, value, label) => {
    gate.lane = requireName(value, `${label}.lane`);
  },
  when: (gate, value, label) => {
    gate.when = requireStringArray(value, `${label}.when`);
  },
  requires: (gate, value, label) => {
    gate.requires = requireStringArray(value, `${label}.requires`);
  },
  early: (gate, value, label) => {
    if (typeof value !== 'boolean') fail(`${label}.early must be true or false`);
    gate.early = value as boolean;
  },
};

function parseGate(raw: unknown, label: string): GateConfig {
  if (!isRecord(raw)) return fail(`${label} must be an object`);
  const gate: GateConfig = { name: requireName(raw.name, `${label}.name`) };
  for (const [key, apply] of Object.entries(GATE_OPTIONS)) {
    if (raw[key] !== undefined) apply(gate, raw[key], label);
  }
  if (PROTECTED_JOBS.includes(gate.name)) {
    return fail(`${label}: ${gate.name} is a guard and may never be skipped at push time`);
  }
  return gate;
}

function parseCheck(raw: unknown, label: string): CheckConfig {
  if (!isRecord(raw) || typeof raw.run !== 'string') return fail(`${label} needs a run string`);
  const cwd = raw.cwd ?? 'worktree';
  if (cwd !== 'worktree' && cwd !== 'source') return fail(`${label}.cwd must be worktree|source`);
  const check: CheckConfig = { name: requireName(raw.name, `${label}.name`), run: raw.run, cwd };
  if (raw.retryOnOutput !== undefined)
    check.retryOnOutput = requireRegex(raw.retryOnOutput, `${label}.retryOnOutput`);
  return check;
}

function parsePrepare(raw: unknown, label: string): PrepareConfig {
  const step: PrepareConfig = parseCheck(raw, label);
  const when = (raw as Record<string, unknown>).when;
  if (when !== undefined) step.when = requireStringArray(when, `${label}.when`);
  return step;
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
  'admitIdleMin',
  'admitWaitMaxSeconds',
  'lockWaitMaxSeconds',
  'maxAttempts',
  'parallelGates',
  'verifySlots',
] as const;
const STRING_KEYS = ['remote', 'targetBranch', 'markerEnv', 'lefthook'] as const;

const PARSERS: Record<string, Parser> = {
  scopes: (c, v) => {
    c.scopes = parseScopes(v);
  },
  full: (c, v) => {
    c.full = requireStringArray(v, 'full');
  },
  pushRequires: (c, v) => {
    c.pushRequires = requireStringArray(v, 'pushRequires');
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
  prepare: (c, v) => {
    c.prepare = parseList(v, 'prepare', parsePrepare);
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
PARSERS.cargoTargetDir = (c, v) => {
  if (typeof v !== 'string' || v === '') fail('cargoTargetDir must be a non-empty string');
  c.cargoTargetDir = v as string;
};
PARSERS.onLoadTimeout = (c, v) => {
  if (v !== 'fail' && v !== 'proceed') fail('onLoadTimeout must be fail or proceed');
  c.onLoadTimeout = v as 'fail' | 'proceed';
};
PARSERS.sampleCommand = (c, v) => {
  if (typeof v !== 'string' || v === '') fail('sampleCommand must be a non-empty string');
  c.sampleCommand = v as string;
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
