import { join } from 'node:path';
import type { GateConfig, LandConfig } from './config';
import { describeExit, type RunOptions, type RunResult, succeeded } from './exec';
import { acquireLock, type LockDeps, type LockHandle, LockTimeout } from './lock';
import { type Classification, gateApplies } from './scope';

/** Shared primitives of the land engine: the context, plumbing git, fetch, the landing worktree, the push env. */

export type LandMode = 'auto' | 'ff-only' | 'cherry-pick' | 'merge';
export const LAND_MODES: readonly LandMode[] = ['auto', 'ff-only', 'cherry-pick', 'merge'];

export interface LandOptions {
  ref: string;
  mode: LandMode;
  message: string | null;
  dryRun: boolean;
  bootstrap: boolean;
  /** Seconds to queue behind a live lock; null uses the config (default 0: refuse and name the holder). */
  waitSeconds: number | null;
  /** Verify only: gate the ref on fresh main in a verification worktree and record a pass; never push. */
  verify?: boolean;
  /** Land only from a current pass record; refuse instead of falling back to the full gated land. */
  requirePass?: boolean;
  /** Land from a pass recorded on another clone: fetch that remote's pass refs first. */
  passFrom?: string;
}

/** `unverified`: --require-pass and no current pass record for the ref. */
export const EXIT = { ok: 0, gate: 1, push: 2, unverified: 3, usage: 64, busy: 75 } as const;

export interface EngineDeps {
  cwd: string;
  env: Record<string, string | undefined>;
  /** Per-user landing home holding the lock, worktrees and logs. */
  home: string;
  run(command: string, args: string[], options?: RunOptions): Promise<RunResult>;
  lock: LockDeps;
  loadavg(): number;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(message: string): void;
  error(message: string): void;
  exists(path: string): boolean;
  mkdirp(path: string): void;
  writeFile(path: string, text: string): void;
  appendFile(path: string, text: string): void;
  rmrf(path: string): void;
  user(): string;
  host(): string;
}

/** Evidence is per exact SHA: a gate counts only if it passed on, or was provably inherited into, this commit. */
export interface Evidence {
  sha: string;
  passed: Map<string, string>;
}

export class Abort extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

/** What one run leaves behind for p50/p90 measurement: <state>/runs.jsonl, one line per run. */
export interface Receipt {
  release: () => void;
  stateDir: string | null;
  /** verify | land (fast, from a pass record) | full (gates and push in one run, or a dry run). */
  stage: 'verify' | 'land' | 'full';
  startedAt: number;
  /** Land from a pass: how the outcome was observed (the push's porcelain report, or a fetch). */
  confirm?: 'porcelain' | 'fetched';
  sha: string | null;
  waitedSeconds: number;
  /** sampleCommand output at lease time and at the end of the run (null when unset or before the lease). */
  sampleStart: string | null;
  sampleEnd: string | null;
  steps: { name: string; seconds: number; ok: boolean }[];
}

export interface Ctx {
  deps: EngineDeps;
  receipt: Receipt;
  options: LandOptions;
  config: LandConfig;
  sourceRoot: string;
  /**
   * Where `cwd: source` steps run and what `{source}` names. The invoking checkout for a full land;
   * for verify, a clean slot-owned checkout of B, so no local edit can change what a pass says ran.
   */
  sourceRun: string;
  /** The repo's landing state dir under the landing home (lease-guarded worktree, runs.jsonl). */
  repoState: string;
  worktree: string;
  /** Where this run's worktree guard and bootstrap marker live: repoState, or a verification slot. */
  stateDir: string;
  logDir: string;
}

const ENV_STRIP = ['CARGO_TARGET_DIR'];
/**
 * Every lefthook control variable: LEFTHOOK=0 skips all hooks, LEFTHOOK_CONFIG selects another
 * config, LEFTHOOK_BIN another runner, LEFTHOOK_EXCLUDE drops jobs. Only the engine may set one
 * (LEFTHOOK_EXCLUDE, from verified evidence, on the push).
 */
const LEFTHOOK_ENV_STRIP = /^LEFTHOOK/;
/** Ambient git variables that route git to another repository or inject config (core.hooksPath=/dev/null would disarm every guard). */
const GIT_ENV_STRIP =
  /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|EXEC_PATH|CEILING_DIRECTORIES|CONFIG.*|HOOK.*)$/;
const TAIL_LINES = 30;

export function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

export function tail(output: string): string {
  return output.split('\n').slice(-TAIL_LINES).join('\n');
}

export function isLefthookGate(gate: GateConfig): boolean {
  return gate.run === undefined;
}

/** Jobs the final push may skip: those green on this exact SHA, plus jobs the diff makes inapplicable. */
export function excludedJobs(
  config: LandConfig,
  evidence: Evidence,
  scopedOut: GateConfig[],
): string[] {
  const green = config.gates.filter((g) => isLefthookGate(g) && evidence.passed.has(g.name));
  const na = scopedOut.filter((g) => isLefthookGate(g) && !evidence.passed.has(g.name));
  return [...green, ...na].map((g) => g.name).sort();
}

export function planGates(
  config: LandConfig,
  c: Classification,
): { selected: GateConfig[]; scopedOut: GateConfig[] } {
  const selected = config.gates.filter((g) => gateApplies(g.when, c));
  return { selected, scopedOut: config.gates.filter((g) => !selected.includes(g)) };
}

/**
 * The push-time guards run inside the pre-push hook and many soft-skip (exit 0) when a tool is
 * missing. Before any push or pre-push dry run, every `pushRequires` program must be on PATH.
 */
export async function requirePushTools(ctx: Ctx, cwd = ctx.worktree): Promise<void> {
  const missing: string[] = [];
  for (const tool of ctx.config.pushRequires) {
    const found = await ctx.deps.run('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', tool], {
      cwd,
      env: baseEnv(ctx),
    });
    if (!succeeded(found)) missing.push(tool);
  }
  if (missing.length > 0) {
    throw new Abort(
      `push guard tool(s) not on PATH: ${missing.join(', ')} (pushRequires in land.config.json); refusing to push past a soft-skipped guard`,
      EXIT.push,
    );
  }
}

export function baseEnv(ctx: Ctx): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...ctx.deps.env,
    CI: '1',
    NO_COLOR: '1',
    CARGO_TERM_PROGRESS_WHEN: 'never',
    GIT_TERMINAL_PROMPT: '0',
    GIT_MERGE_AUTOEDIT: 'no',
    ...ctx.config.env,
  };
  // Sanitize AFTER merging, so neither the ambient environment nor config.env can reintroduce them.
  for (const key of Object.keys(env)) {
    if (GIT_ENV_STRIP.test(key) || LEFTHOOK_ENV_STRIP.test(key)) delete env[key];
  }
  for (const key of [...ENV_STRIP, ctx.config.markerEnv]) delete env[key];
  const { cargoTargetDir } = ctx.config;
  if (cargoTargetDir !== null) {
    env.CARGO_TARGET_DIR = cargoTargetDir.startsWith('~/')
      ? join(ctx.deps.env.HOME ?? '', cargoTargetDir.slice(2))
      : cargoTargetDir;
  }
  // Bind every hook's diff base to the exact base this landing validated against, so an
  // `affected` job cannot silently diff against another ref and still report green.
  env.GIT_CONFIG_COUNT = '2';
  env.GIT_CONFIG_KEY_0 = 'harness.hookBaseRemote';
  env.GIT_CONFIG_VALUE_0 = ctx.config.remote;
  env.GIT_CONFIG_KEY_1 = 'harness.hookBaseRef';
  env.GIT_CONFIG_VALUE_1 = ctx.config.targetBranch;
  return env;
}

/** Plumbing git: repo hooks are off so a checkout or reset never fires post-checkout tooling. Push and hook runs call deps.run directly. */
export async function git(ctx: Ctx, args: string[], cwd = ctx.worktree): Promise<RunResult> {
  return ctx.deps.run('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    env: baseEnv(ctx),
  });
}

export async function gitOut(ctx: Ctx, args: string[], cwd = ctx.worktree): Promise<string> {
  const result = await git(ctx, args, cwd);
  if (!succeeded(result)) {
    throw new Abort(
      `git ${args.join(' ')} failed (${describeExit(result)})\n${tail(result.output)}`,
      EXIT.gate,
    );
  }
  return result.output.trim();
}

export async function fetchRemote(ctx: Ctx): Promise<void> {
  const { remote, targetBranch } = ctx.config;
  const attempts = 3;
  let failure = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await git(ctx, ['fetch', '--prune', remote, targetBranch], ctx.sourceRoot);
    if (succeeded(result)) return;
    failure = `fetch ${remote} failed (${describeExit(result)})\n${tail(result.output)}`;
    if (attempt < attempts) await ctx.deps.sleep(2000 * attempt);
  }
  throw new Abort(failure, EXIT.push);
}

export const remoteTip = (ctx: Ctx): Promise<string> =>
  gitOut(
    ctx,
    ['rev-parse', '--verify', `refs/remotes/${ctx.config.remote}/${ctx.config.targetBranch}`],
    ctx.sourceRoot,
  );

/** True when `ancestor` is reachable from `descendant` (or equal to it). */
export async function isAncestor(ctx: Ctx, ancestor: string, descendant: string): Promise<boolean> {
  return succeeded(
    await git(ctx, ['merge-base', '--is-ancestor', ancestor, descendant], ctx.sourceRoot),
  );
}

/** Bring the persistent worktree at `dir` (created when absent or broken) to exactly `commit`, detached and clean. */
export async function ensureCheckout(ctx: Ctx, dir: string, commit: string): Promise<void> {
  const healthy = ctx.deps.exists(join(dir, '.git'))
    ? succeeded(await git(ctx, ['rev-parse', 'HEAD'], dir))
    : false;
  if (!healthy) {
    ctx.deps.rmrf(dir);
    await git(ctx, ['worktree', 'prune'], ctx.sourceRoot);
    ctx.deps.mkdirp(ctx.stateDir);
    await gitOut(ctx, ['worktree', 'add', '--detach', dir, commit], ctx.sourceRoot);
  }
  await gitOut(ctx, ['checkout', '--detach', '--force', commit], dir);
  await gitOut(ctx, ['reset', '--hard', commit], dir);
  // -fd, never -x: ignored caches (node_modules, target/) are the point of a persistent worktree.
  await gitOut(ctx, ['clean', '-fd'], dir);
}

export async function ensureWorktree(ctx: Ctx, base: string): Promise<void> {
  await ensureCheckout(ctx, ctx.worktree, base);
}

export function pushEnv(
  ctx: Ctx,
  sha: string,
  exclude: string[],
): Record<string, string | undefined> {
  const env = baseEnv(ctx);
  env[ctx.config.markerEnv] = sha;
  if (exclude.length > 0) env.LEFTHOOK_EXCLUDE = exclude.join(',');
  return env;
}

/**
 * Exclusive use of one persistent worktree (kept for its node_modules and target/ caches), held in
 * `<lockDir>/worktree.lock`. Same holder and staleness rules as the lease; never waits. `what` ends
 * the refusal message.
 */
export async function guardWorktree(
  ctx: Ctx,
  lockDir: string,
  worktree: string,
  what: string,
  suffix = '',
): Promise<LockHandle> {
  const guard: LockDeps = { ...ctx.deps.lock, lockPath: join(lockDir, 'worktree.lock') };
  ctx.deps.mkdirp(lockDir);
  try {
    return await acquireLock(
      guard,
      { pid: process.pid, repo: ctx.sourceRoot, ref: ctx.options.ref, user: ctx.deps.user() },
      0,
    );
  } catch (error) {
    if (!(error instanceof LockTimeout)) throw error;
    const holder = error.message
      .replace('landing lock is held by ', '')
      .replace('; not waiting', '');
    throw new LockTimeout(`the ${what} worktree ${worktree} is in use: ${holder}${suffix}`);
  }
}
