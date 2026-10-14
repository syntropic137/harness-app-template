import { createHash } from 'node:crypto';
import { type GateConfig, type LandConfig, PROTECTED_JOBS } from './config';
import { excludedJobs, LAND_MODES, type LandMode, planGates } from './core';
import { classify } from './scope';

/**
 * Pass records (ADR-0034 slice 2, simplified): `just verify <ref>` gates the ref on fresh main tip B
 * and records what it proved; `just land <ref>` consumes the record when B is still main's tip.
 * Pure functions only; the git and file I/O live in the engine.
 */

/** Bump when the record's shape or meaning changes; a record of another format is ignored. */
export const PASS_FORMAT = 3;

const LEFTHOOK_NAMES = ['lefthook', '.lefthook', 'lefthook-local', '.lefthook-local'];
const LEFTHOOK_EXTS = ['yml', 'yaml', 'json', 'jsonc', 'toml'];

/**
 * Every file lefthook reads its configuration from: the main and local configs in each format, at
 * the root and under .config/ (lefthook merges a local file over the main one, so a candidate that
 * adds `lefthook-local.yml` could replace a gate's command), plus the `.lefthook` and
 * `.lefthook-local` script directories its jobs run.
 */
export const LEFTHOOK_CONFIG_FILES: readonly string[] = LEFTHOOK_NAMES.flatMap((name) =>
  LEFTHOOK_EXTS.flatMap((ext) => [`${name}.${ext}`, `.config/${name}.${ext}`]),
);
export const LEFTHOOK_CONFIG_PATHS: readonly string[] = [
  ...LEFTHOOK_CONFIG_FILES,
  '.lefthook',
  '.lefthook-local',
];

/** Paths whose git tree ids decide which gates run and how: a change to any of them invalidates a pass. */
export const CONFIG_KEY_PATHS: readonly string[] = [
  'land.config.json',
  ...LEFTHOOK_CONFIG_PATHS,
  'scripts/lib/land',
  'scripts/land.ts',
];

/**
 * Local overrides lefthook merges over the committed config. Usually gitignored, so neither the key
 * nor `git clean -fd` sees one: a worktree that runs hooks must not contain any.
 */
export const LEFTHOOK_LOCAL_PATHS: readonly string[] = LEFTHOOK_CONFIG_PATHS.filter((p) =>
  p.includes('lefthook-local'),
);

/** The parts of lefthook's merged view a pass binds: the config itself and its script dirs. */
export interface EffectiveHooks {
  /** The merged config, canonically serialised. */
  config: string;
  /** `source_dir` and `source_dir_local`: script bodies the dump names but does not include. */
  sourceDir: string;
  sourceDirLocal: string;
}

/** A script dir as lefthook reads it, relative to the repo root, or null when it leaves the tree. */
export function repoRelativeDir(dir: string): string | null {
  const trimmed = dir.replace(/\/+$/, '');
  const segments = trimmed.split('/');
  if (trimmed === '' || trimmed.startsWith('/') || segments.includes('..')) return null;
  return trimmed;
}

function scriptDir(value: unknown, fallback: string): string | null {
  return repoRelativeDir(typeof value === 'string' && value !== '' ? value : fallback);
}

/**
 * The effective hook configuration, from `lefthook dump --format json` (lefthook's own merge of
 * the main config, `extends` files and local overrides, in any format), or why a pass cannot bind
 * it. `remotes` are refused outright: their content is fetched, so the same dump can stand for
 * different rules on another day or machine. Script dirs must stay inside the repository, so their
 * tree ids can be bound too.
 */
export function effectiveHooks(dump: string): EffectiveHooks | { problem: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(dump);
  } catch {
    return { problem: 'lefthook dump did not print JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { problem: 'lefthook dump did not print a config object' };
  }
  const record = parsed as Record<string, unknown>;
  const remotes = record.remotes;
  if (Array.isArray(remotes) && remotes.length > 0) {
    return { problem: 'the lefthook config uses remotes, whose fetched rules a pass cannot bind' };
  }
  const sourceDir = scriptDir(record.source_dir, '.lefthook');
  const sourceDirLocal = scriptDir(record.source_dir_local, '.lefthook-local');
  if (sourceDir === null || sourceDirLocal === null) {
    return {
      problem: 'a lefthook source_dir lies outside the repository, so a pass cannot bind it',
    };
  }
  return { config: JSON.stringify(parsed), sourceDir, sourceDirLocal };
}

/** The pass's hooks_key: the merged config plus the git tree ids of its script dirs. */
export function hooksKey(
  hooks: EffectiveHooks,
  sourceTree: string,
  sourceLocalTree: string,
): string {
  return createHash('sha1')
    .update([hooks.config, sourceTree, sourceLocalTree].join('\n'))
    .digest('hex');
}

export interface PassGate {
  name: string;
  seconds: number;
  retried: boolean;
}

export interface PassRecord {
  format: number;
  /** The commit the ref named when verify ran. */
  ref_sha: string;
  /** The verified commit: the ref applied onto B. This exact commit is what land pushes. */
  C: string;
  /** origin/<target> tip the verification was built and gated on. */
  B: string;
  /** How the ref was applied onto B (--mode) and the merge message (--message), which made C. */
  mode: LandMode;
  message: string | null;
  /** Key of B's land config and engine files (CONFIG_KEY_PATHS). */
  config_key: string;
  /** Gate and check steps with their wall clock; `retried` when a retryOnOutput re-run happened. */
  gates: PassGate[];
  /** Gates with evidence on C, plus every early check and check (all ran and passed). */
  passed: string[];
  started: string;
  seconds: number;
  host: string;
  /**
   * Key of the land config and engine that actually ran the verification: the invoking checkout's
   * working tree. Verify refuses unless it equals B's, so a valid pass has engine_version equal to
   * config_key, and land requires both to equal main's.
   */
  engine_version: string;
  /** Key of the effective lefthook config (`lefthook dump`) at C, verified equal at B. */
  hooks_key: string;
}

/**
 * Where pass records live. Locally: `refs/land/verified/<ref_sha>` keeps C reachable and maps the
 * ref to C, and the record is a git note on C under `refs/notes/land-pass`, so both travel with git.
 * A pass verified on another machine is fetched (`--pass-from <remote>`) into
 * `refs/land/pass-from/<remote>/verified/` and `refs/notes/land-pass-from/<remote>` (git notes only
 * reads refs under refs/notes/), never over the local refs.
 */
export interface PassSource {
  /** Prefix of the ref_sha -> C refs. */
  verified: string;
  /** Notes ref holding the records. */
  notes: string;
}

export const LOCAL_PASSES: PassSource = {
  verified: 'refs/land/verified/',
  notes: 'refs/notes/land-pass',
};

export function remotePasses(remote: string): PassSource {
  return {
    verified: `refs/land/pass-from/${remote}/verified/`,
    notes: `refs/notes/land-pass-from/${remote}`,
  };
}

/** Refspecs that copy a remote's pass records into `remotePasses(remote)`. */
export function passFetchRefspecs(remote: string): string[] {
  const into = remotePasses(remote);
  return [`+${LOCAL_PASSES.verified}*:${into.verified}*`, `+${LOCAL_PASSES.notes}:${into.notes}`];
}

/** One stable key from `git ls-tree <commit> -- CONFIG_KEY_PATHS` output (mode, type, id, path per line). */
export function configKeyFromLsTree(output: string): string {
  const lines = output
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .sort();
  return createHash('sha1').update(lines.join('\n')).digest('hex');
}

/** Per-gate seconds from receipt steps, folding `<name>-retry` into `<name>` as a retry. */
export function summariseGates(steps: { name: string; seconds: number }[]): PassGate[] {
  const byName = new Map<string, PassGate>();
  for (const step of steps) {
    const retried = step.name.endsWith('-retry');
    const name = retried ? step.name.slice(0, -'-retry'.length) : step.name;
    const gate = byName.get(name) ?? { name, seconds: 0, retried: false };
    gate.seconds += step.seconds;
    gate.retried ||= retried;
    byName.set(name, gate);
  }
  return [...byName.values()];
}

const SHA = /^[0-9a-f]{40,64}$/;

const isSha = (v: unknown): boolean => typeof v === 'string' && SHA.test(v);
const isNonEmptyString = (v: unknown): boolean => typeof v === 'string' && v !== '';
const isSeconds = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isStringArray = (v: unknown): boolean =>
  Array.isArray(v) && v.every((s) => typeof s === 'string' && s !== '');
const isGate = (v: unknown): boolean => {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  return isNonEmptyString(g.name) && isSeconds(g.seconds) && typeof g.retried === 'boolean';
};

/** Every field and its check: a record missing or mistyping any of them is not a pass. */
const FIELDS: Record<keyof PassRecord, (v: unknown) => boolean> = {
  format: (v) => v === PASS_FORMAT,
  ref_sha: isSha,
  C: isSha,
  B: isSha,
  config_key: isNonEmptyString,
  gates: (v) => Array.isArray(v) && v.every(isGate),
  passed: isStringArray,
  started: isNonEmptyString,
  seconds: isSeconds,
  host: isNonEmptyString,
  engine_version: isNonEmptyString,
  hooks_key: isNonEmptyString,
  mode: (v) => LAND_MODES.includes(v as LandMode),
  message: (v) => v === null || typeof v === 'string',
};

/** A record read from a note, or null when absent, unparseable, of another format or malformed. */
export function parsePass(text: string | null): PassRecord | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const valid = Object.entries(FIELDS).every(([key, ok]) => ok(record[key]));
  return valid ? (record as unknown as PassRecord) : null;
}

/** Names a pass must carry evidence for: the gates main's config makes applicable to B..C, and every early check and check. */
export function requiredEvidence(config: LandConfig, selected: GateConfig[]): string[] {
  const checks = [...config.earlyChecks, ...config.checks].map((c) => c.name);
  return [...new Set([...selected.map((g) => g.name), ...checks])].sort();
}

export type PassVerdict =
  | { kind: 'current'; pass: PassRecord; exclude: string[]; config: LandConfig }
  | { kind: 'landed'; pass: PassRecord }
  | { kind: 'stale'; reason: string };

export interface PassFacts {
  refSha: string;
  pass: PassRecord | null;
  /** origin/<target> tip right after a fetch. */
  main: string;
  /** config_key of main's tip. */
  mainConfigKey: string;
  /** config_key of C: differs from main's when the ref itself changes the land config or engine. */
  cConfigKey: string | null;
  /** main's land.config.json, parsed; a string says why it could not be. */
  mainConfig: LandConfig | string;
  /** Files changed in main..C (B..C for a current pass), or null when unreadable. */
  changed: string[] | null;
  /** C exists in the object store. */
  cExists: boolean;
  /** C is reachable from main (already landed). */
  cOnMain: boolean;
  /** How this land asks to apply the ref: it must be how verify applied it, or C is not what was asked for. */
  requested: { mode: LandMode; message: string | null };
}

const short = (s: string): string => s.slice(0, 12);

function identityProblem(f: PassFacts, pass: PassRecord): string | null {
  if (pass.ref_sha !== f.refSha)
    return `pass record is for ${short(pass.ref_sha)}, not ${short(f.refSha)}`;
  if (!f.cExists) return `verified commit ${short(pass.C)} is missing from this repo`;
  return null;
}

/** `--mode m` plus ` and --message` when there is one: how a ref is applied onto main. */
const describeApply = (mode: LandMode, message: string | null): string =>
  `--mode ${mode}${message === null ? '' : ` and --message "${message}"`}`;

function bindingProblem(f: PassFacts, pass: PassRecord): string | null {
  if (pass.mode !== f.requested.mode || pass.message !== f.requested.message)
    return `the pass was verified with ${describeApply(pass.mode, pass.message)}; this land asks for ${describeApply(f.requested.mode, f.requested.message)}`;
  if (pass.B !== f.main)
    return `main moved since verify (verified on ${short(pass.B)}, main is ${short(f.main)})`;
  if (pass.config_key !== f.mainConfigKey) return 'land config changed since verify';
  if (pass.engine_version !== f.mainConfigKey)
    return "the land engine and config that ran the verification are not main's";
  if (f.cConfigKey !== f.mainConfigKey)
    return 'the ref changes the land config or engine; land it with the full land';
  return null;
}

/** Whether a pass lets land push C now (and which lefthook jobs the push may skip), says C already landed, or why it is stale. */
export function judgePass(f: PassFacts): PassVerdict {
  const { pass } = f;
  if (pass === null) return { kind: 'stale', reason: `no pass record for ${short(f.refSha)}` };
  const identity = identityProblem(f, pass);
  if (identity !== null) return { kind: 'stale', reason: identity };
  if (f.cOnMain) return { kind: 'landed', pass };
  const binding = bindingProblem(f, pass);
  if (binding !== null) return { kind: 'stale', reason: binding };
  if (typeof f.mainConfig === 'string')
    return { kind: 'stale', reason: `main's land config is unreadable: ${f.mainConfig}` };
  const config = f.mainConfig;
  const { selected, scopedOut } = planGates(config, classify(f.changed, config));
  const passed = new Set(pass.passed);
  const missing = requiredEvidence(config, selected).filter((name) => !passed.has(name));
  if (missing.length > 0)
    return { kind: 'stale', reason: `the pass has no evidence for: ${missing.join(', ')}` };
  // Exclusions come from main's config and the validated evidence, never from the record.
  const evidence = new Map(selected.filter((g) => passed.has(g.name)).map((g) => [g.name, pass.C]));
  const exclude = excludedJobs(config, { sha: pass.C, passed: evidence }, scopedOut).filter(
    (job) => !PROTECTED_JOBS.includes(job),
  );
  return { kind: 'current', pass, exclude, config };
}
