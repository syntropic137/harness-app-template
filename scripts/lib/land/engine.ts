import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { CheckConfig, GateConfig, LandConfig } from './config';
import { describeExit, type RunOptions, type RunResult, succeeded } from './exec';
import { acquireLock, type LockDeps, LockTimeout } from './lock';
import { type Classification, classify, gateApplies, matchesAny } from './scope';

export type LandMode = 'auto' | 'ff-only' | 'cherry-pick' | 'merge';

export interface LandOptions {
  ref: string;
  mode: LandMode;
  message: string | null;
  dryRun: boolean;
  bootstrap: boolean;
}

export const EXIT = { ok: 0, gate: 1, push: 2, usage: 64, busy: 75 } as const;

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
  rmrf(path: string): void;
  user(): string;
}

/** Evidence is per exact SHA: a gate counts only if it passed on, or was provably inherited into, this commit. */
export interface Evidence {
  sha: string;
  passed: Map<string, string>;
}

class Abort extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

const ENV_STRIP = ['LEFTHOOK', 'LEFTHOOK_EXCLUDE', 'CARGO_TARGET_DIR'];
/** Ambient git variables that route git to another repository or inject config (core.hooksPath=/dev/null would disarm every guard). */
const GIT_ENV_STRIP =
  /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|EXEC_PATH|CEILING_DIRECTORIES|CONFIG.*|HOOK.*)$/;
const PASSED_JOB = /^\s*(?:✔️|✔|✓)\s+(\S+)/u;
const TAIL_LINES = 30;

export function passedJobs(output: string): Set<string> {
  const jobs = new Set<string>();
  for (const line of output.split('\n')) {
    const match = PASSED_JOB.exec(line);
    if (match?.[1] !== undefined) jobs.add(match[1]);
  }
  return jobs;
}

export function isLefthookGate(gate: GateConfig): boolean {
  return gate.run === undefined;
}

export function planGates(
  config: LandConfig,
  c: Classification,
): { selected: GateConfig[]; scopedOut: GateConfig[] } {
  const selected = config.gates.filter((g) => gateApplies(g.when, c));
  return { selected, scopedOut: config.gates.filter((g) => !selected.includes(g)) };
}

/** Gates whose evidence from `prev` survives into `next`: only when the exact delta between the two SHAs misses their scopes. */
export function inheritEvidence(
  prev: Evidence,
  next: string,
  deltaFiles: string[] | null,
  config: LandConfig,
): Evidence {
  const evidence: Evidence = { sha: next, passed: new Map() };
  if (!config.inheritUnaffectedEvidence || deltaFiles === null) return evidence;
  const keepAll = deltaFiles.length === 0;
  const c = classify(deltaFiles, config);
  for (const gate of config.gates) {
    const unaffected = keepAll || !gateApplies(gate.when, c);
    const from = prev.passed.get(gate.name);
    if (unaffected && from !== undefined) {
      evidence.passed.set(
        gate.name,
        from.startsWith('inherited') ? from : `inherited from ${prev.sha}`,
      );
    }
  }
  return evidence;
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

export function repoId(commonDir: string, toplevel: string): string {
  return `${basename(toplevel)}-${createHash('sha1').update(commonDir).digest('hex').slice(0, 10)}`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

function tail(output: string): string {
  return output.split('\n').slice(-TAIL_LINES).join('\n');
}

interface Ctx {
  deps: EngineDeps;
  options: LandOptions;
  config: LandConfig;
  sourceRoot: string;
  worktree: string;
  stateDir: string;
  logDir: string;
}

function baseEnv(ctx: Ctx): Record<string, string | undefined> {
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
    if (GIT_ENV_STRIP.test(key)) delete env[key];
  }
  for (const key of [...ENV_STRIP, ctx.config.markerEnv]) delete env[key];
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
async function git(ctx: Ctx, args: string[], cwd = ctx.worktree): Promise<RunResult> {
  return ctx.deps.run('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    env: baseEnv(ctx),
  });
}

async function gitOut(ctx: Ctx, args: string[], cwd = ctx.worktree): Promise<string> {
  const result = await git(ctx, args, cwd);
  if (!succeeded(result)) {
    throw new Abort(
      `git ${args.join(' ')} failed (${describeExit(result)})\n${tail(result.output)}`,
      EXIT.gate,
    );
  }
  return result.output.trim();
}

async function runLogged(
  ctx: Ctx,
  name: string,
  command: string,
  args: string[],
  cwd: string,
  env = baseEnv(ctx),
): Promise<RunResult> {
  const start = ctx.deps.now();
  const lines: string[] = [];
  const result = await ctx.deps.run(command, args, {
    cwd,
    env,
    onLine: (line) => {
      lines.push(line);
      ctx.deps.log(`  [${name}] ${line}`);
    },
  });
  ctx.deps.mkdirp(ctx.logDir);
  ctx.deps.writeFile(join(ctx.logDir, `${name}.log`), `${lines.join('\n')}\n`);
  const seconds = Math.round((ctx.deps.now() - start) / 1000);
  ctx.deps.log(
    `${succeeded(result) ? 'PASS' : 'FAIL'} ${name} (${seconds}s${succeeded(result) ? '' : `, ${describeExit(result)}`})`,
  );
  return result;
}

interface Vars {
  base: string;
  head: string;
  worktree: string;
  source: string;
}

function expand(command: string, vars: Vars): string {
  return command.replace(
    /\{(base|head|worktree|source)\}/g,
    (_m, key: string) => vars[key as keyof Vars],
  );
}

async function waitForLoad(ctx: Ctx): Promise<void> {
  const { loadMax, loadPollSeconds, loadWaitMaxSeconds } = ctx.config;
  const deadline = ctx.deps.now() + loadWaitMaxSeconds * 1000;
  while (ctx.deps.loadavg() > loadMax) {
    if (ctx.deps.now() >= deadline) {
      throw new Abort(
        `load stayed above ${loadMax} for ${loadWaitMaxSeconds}s; not starting gates`,
        EXIT.busy,
      );
    }
    ctx.deps.log(
      `load ${ctx.deps.loadavg().toFixed(1)} is above ${loadMax}; waiting ${loadPollSeconds}s`,
    );
    await ctx.deps.sleep(loadPollSeconds * 1000);
  }
}

async function fetchRemote(ctx: Ctx): Promise<void> {
  const { remote, targetBranch } = ctx.config;
  for (let attempt = 1; ; attempt += 1) {
    const result = await git(ctx, ['fetch', '--prune', remote, targetBranch], ctx.sourceRoot);
    if (succeeded(result)) return;
    if (attempt >= 3) {
      throw new Abort(
        `fetch ${remote} failed (${describeExit(result)})\n${tail(result.output)}`,
        EXIT.push,
      );
    }
    await ctx.deps.sleep(2000 * attempt);
  }
}

const remoteTip = (ctx: Ctx): Promise<string> =>
  gitOut(
    ctx,
    ['rev-parse', '--verify', `refs/remotes/${ctx.config.remote}/${ctx.config.targetBranch}`],
    ctx.sourceRoot,
  );

async function ensureWorktree(ctx: Ctx, base: string): Promise<void> {
  const healthy = ctx.deps.exists(join(ctx.worktree, '.git'))
    ? succeeded(await git(ctx, ['rev-parse', 'HEAD']))
    : false;
  if (!healthy) {
    ctx.deps.rmrf(ctx.worktree);
    await git(ctx, ['worktree', 'prune'], ctx.sourceRoot);
    ctx.deps.mkdirp(ctx.stateDir);
    await gitOut(ctx, ['worktree', 'add', '--detach', ctx.worktree, base], ctx.sourceRoot);
  }
  await gitOut(ctx, ['checkout', '--detach', '--force', base]);
  await gitOut(ctx, ['reset', '--hard', base]);
  // -fd, never -x: ignored caches (node_modules, target/) are the point of a persistent worktree.
  await gitOut(ctx, ['clean', '-fd']);
}

async function applyTarget(ctx: Ctx, base: string, target: string): Promise<void> {
  const { mode, message } = ctx.options;
  const ff = succeeded(await git(ctx, ['merge-base', '--is-ancestor', base, target]));
  if (mode === 'merge') {
    const args =
      message === null
        ? ['merge', '--no-ff', '--no-edit', target]
        : ['merge', '--no-ff', '-m', message, target];
    await gitOut(ctx, args);
  } else if (mode === 'ff-only' || (mode === 'auto' && ff)) {
    await gitOut(ctx, ['merge', '--ff-only', target]);
  } else {
    const commits = (await gitOut(ctx, ['rev-list', '--reverse', `${base}..${target}`]))
      .split('\n')
      .filter(Boolean);
    if (commits.length === 0)
      throw new Abort(
        `ref ${ctx.options.ref} has no commits absent from ${base.slice(0, 12)}`,
        EXIT.gate,
      );
    ctx.deps.log(`cherry-picking ${commits.length} commit(s) onto ${base.slice(0, 12)}`);
    for (const commit of commits) {
      const result = await git(ctx, ['cherry-pick', commit]);
      if (!succeeded(result)) {
        await git(ctx, ['cherry-pick', '--abort']);
        throw new Abort(
          `cherry-pick ${commit.slice(0, 12)} failed (${describeExit(result)})\n${tail(result.output)}`,
          EXIT.gate,
        );
      }
    }
  }
}

async function changedFiles(ctx: Ctx, from: string, to: string): Promise<string[] | null> {
  const result = await git(ctx, ['diff', '--name-only', from, to]);
  return succeeded(result) ? result.output.split('\n').filter((l) => l.trim() !== '') : null;
}

function describePlan(c: Classification, selected: GateConfig[], scopedOut: GateConfig[]): string {
  const why = c.full
    ? `FULL suite (${c.reasons.slice(0, 3).join('; ')})`
    : `scopes: ${c.scopes.join(', ')}`;
  const out =
    scopedOut.length === 0 ? '' : `; not applicable: ${scopedOut.map((g) => g.name).join(', ')}`;
  return `plan: ${why}; gates: ${selected.map((g) => g.name).join(', ') || 'none'}${out}`;
}

async function runLefthookBatch(ctx: Ctx, jobs: string[], evidence: Evidence): Promise<void> {
  if (jobs.length === 0) return;
  const args = ['run', 'pre-push', '--force', ...jobs.flatMap((j) => ['--job', j])];
  const [bin = 'lefthook', ...pre] = ctx.config.lefthook.split(/\s+/);
  const result = await runLogged(ctx, 'lefthook', bin, [...pre, ...args], ctx.worktree);
  const passed = passedJobs(result.output);
  // Measured, not inferred: exit 0 with a job missing from the summary is a silent skip.
  const missing = jobs.filter((j) => !passed.has(j));
  for (const job of jobs.filter((j) => passed.has(j))) evidence.passed.set(job, evidence.sha);
  if (!succeeded(result) || missing.length > 0) {
    const detail = succeeded(result)
      ? `not reported as passed: ${missing.join(', ')}`
      : describeExit(result);
    throw new Abort(`gates failed: ${detail}\n${tail(result.output)}`, EXIT.gate);
  }
}

/** Many hooks soft-skip (exit 0) when a tool is missing. A landing must fail closed instead. */
async function requireTools(ctx: Ctx, gates: GateConfig[]): Promise<void> {
  const missing: string[] = [];
  for (const tool of new Set(gates.flatMap((g) => g.requires ?? []))) {
    const found = await ctx.deps.run('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', tool], {
      cwd: ctx.worktree,
      env: baseEnv(ctx),
    });
    if (!succeeded(found)) missing.push(tool);
  }
  if (missing.length > 0) {
    throw new Abort(
      `required tool(s) not on PATH: ${missing.join(', ')}; refusing to land on a soft-skipped gate`,
      EXIT.gate,
    );
  }
}

/** Evidence is bound to a SHA only if the gates ran against exactly that tree. */
async function assertUnchanged(ctx: Ctx, sha: string): Promise<void> {
  const head = await gitOut(ctx, ['rev-parse', 'HEAD']);
  // Tracked files that differ from HEAD (working tree or index). Untracked output is not evidence.
  const changed = await gitOut(ctx, ['diff', '--name-only', 'HEAD']);
  const dirty = changed
    .split('\n')
    .filter(Boolean)
    .filter((path) => !matchesAny(path, ctx.config.ignoreDirty));
  const treeChanged = head !== sha || dirty.length > 0;
  if (treeChanged) {
    const names = dirty.length > 0 ? dirty.join(', ') : 'none';
    const heads = `HEAD ${shortSha(head)} vs ${shortSha(sha)}`;
    const message = `gates changed the tree they were validating (${heads}; modified: ${names}); evidence no longer binds the SHA`;
    throw new Abort(message, EXIT.gate);
  }
}

async function runCheck(ctx: Ctx, check: CheckConfig, vars: Vars): Promise<void> {
  const cwd = check.cwd === 'source' ? ctx.sourceRoot : ctx.worktree;
  const result = await runLogged(ctx, check.name, 'sh', ['-c', expand(check.run, vars)], cwd);
  if (!succeeded(result)) {
    throw new Abort(
      `${check.name} failed (${describeExit(result)})\n${tail(result.output)}`,
      EXIT.gate,
    );
  }
}

async function bootstrapIfNeeded(ctx: Ctx, c: Classification, vars: Vars): Promise<void> {
  const { bootstrap } = ctx.config;
  if (bootstrap === null || !ctx.options.bootstrap) return;
  const marker = join(ctx.stateDir, 'bootstrapped');
  if (ctx.deps.exists(marker) && !gateApplies(bootstrap.when, c)) return;
  await runCheck(ctx, { name: 'bootstrap', run: bootstrap.run, cwd: 'worktree' }, vars);
  ctx.deps.writeFile(marker, `${ctx.deps.now()}\n`);
}

interface Validated {
  base: string;
  evidence: Evidence;
  scopedOut: GateConfig[];
}

async function validate(ctx: Ctx, prev: Evidence | null): Promise<Validated> {
  await fetchRemote(ctx);
  const base = await remoteTip(ctx);
  const target = await gitOut(
    ctx,
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ctx.options.ref}^{commit}`],
    ctx.sourceRoot,
  );
  ctx.deps.log(
    `landing ${target.slice(0, 12)} onto ${ctx.config.remote}/${ctx.config.targetBranch} ${base.slice(0, 12)}`,
  );
  await ensureWorktree(ctx, base);
  await applyTarget(ctx, base, target);
  const sha = await gitOut(ctx, ['rev-parse', 'HEAD']);
  const evidence =
    prev === null || prev.sha === sha
      ? { sha, passed: new Map(prev?.passed ?? []) }
      : inheritEvidence(prev, sha, await changedFiles(ctx, prev.sha, sha), ctx.config);
  const c = classify(await changedFiles(ctx, base, sha), ctx.config);
  const { selected, scopedOut } = planGates(ctx.config, c);
  ctx.deps.log(describePlan(c, selected, scopedOut));
  const vars = { base, head: sha, worktree: ctx.worktree, source: ctx.sourceRoot };
  await bootstrapIfNeeded(ctx, c, vars);
  const todo = selected.filter((g) => !evidence.passed.has(g.name));
  await requireTools(ctx, todo);
  await runLefthookBatch(
    ctx,
    todo.filter(isLefthookGate).map((g) => g.name),
    evidence,
  );
  for (const gate of todo) {
    if (gate.run === undefined) continue;
    await runCheck(ctx, { name: gate.name, run: gate.run, cwd: 'worktree' }, vars);
    evidence.passed.set(gate.name, sha);
  }
  for (const check of ctx.config.checks) await runCheck(ctx, check, vars);
  await assertUnchanged(ctx, sha);
  return { base, evidence, scopedOut };
}

function pushEnv(ctx: Ctx, sha: string, exclude: string[]): Record<string, string | undefined> {
  const env = baseEnv(ctx);
  env[ctx.config.markerEnv] = sha;
  if (exclude.length > 0) env.LEFTHOOK_EXCLUDE = exclude.join(',');
  return env;
}

async function landed(ctx: Ctx, sha: string): Promise<boolean> {
  // If this fetch fails it throws: an unverifiable outcome must never read as "not landed".
  await fetchRemote(ctx);
  const { remote, targetBranch } = ctx.config;
  return succeeded(
    await git(
      ctx,
      ['merge-base', '--is-ancestor', sha, `refs/remotes/${remote}/${targetBranch}`],
      ctx.sourceRoot,
    ),
  );
}

async function dryRunHooks(ctx: Ctx, v: Validated, sha: string): Promise<void> {
  const { remote, targetBranch } = ctx.config;
  const url = await gitOut(ctx, ['remote', 'get-url', remote]);
  const stdinFile = join(ctx.logDir, 'pre-push.stdin');
  ctx.deps.mkdirp(ctx.logDir);
  ctx.deps.writeFile(stdinFile, `HEAD ${sha} refs/heads/${targetBranch} ${v.base}\n`);
  const env = pushEnv(ctx, sha, excludedJobs(ctx.config, v.evidence, v.scopedOut));
  const result = await ctx.deps.run(
    'git',
    ['hook', 'run', '--ignore-missing', `--to-stdin=${stdinFile}`, 'pre-push', '--', remote, url],
    { cwd: ctx.worktree, env, onLine: (l) => ctx.deps.log(`  [pre-push] ${l}`) },
  );
  if (!succeeded(result))
    throw new Abort(`pre-push guards refused the dry run (${describeExit(result)})`, EXIT.gate);
}

type PushOutcome = 'landed' | 'moved';

async function pushAndConfirm(ctx: Ctx, v: Validated, sha: string): Promise<PushOutcome> {
  const { remote, targetBranch } = ctx.config;
  const env = pushEnv(ctx, sha, excludedJobs(ctx.config, v.evidence, v.scopedOut));
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    ctx.deps.log(
      `pushing ${sha.slice(0, 12)} (jobs skipped, verified on this SHA: ${env.LEFTHOOK_EXCLUDE ?? 'none'})`,
    );
    const result = await ctx.deps.run(
      'git',
      ['push', remote, `${sha}:refs/heads/${targetBranch}`],
      {
        cwd: ctx.worktree,
        env,
        onLine: (l) => ctx.deps.log(`  [push] ${l}`),
      },
    );
    // The push's own status is a claim; origin containing the SHA is the fact.
    if (await landed(ctx, sha)) {
      if (!succeeded(result))
        ctx.deps.log(
          `push reported ${describeExit(result)} but ${remote}/${targetBranch} contains ${sha.slice(0, 12)}`,
        );
      return 'landed';
    }
    if ((await remoteTip(ctx)) !== v.base) return 'moved';
    const transport = result.signal !== null || result.status === 128;
    if (!transport || attempt === 3) {
      throw new Abort(
        `push failed (${describeExit(result)}) and ${remote}/${targetBranch} does not contain ${sha.slice(0, 12)}\n${tail(result.output)}`,
        EXIT.push,
      );
    }
    ctx.deps.log(
      `push ${describeExit(result)}; ${remote}/${targetBranch} unmoved, retrying (gates are green on this SHA)`,
    );
    await ctx.deps.sleep(2000 * attempt);
  }
  throw new Abort('unreachable', EXIT.push);
}

async function runAttempts(ctx: Ctx): Promise<void> {
  let prev: Evidence | null = null;
  for (let attempt = 1; attempt <= ctx.config.maxAttempts; attempt += 1) {
    const v = await validate(ctx, prev);
    const sha = v.evidence.sha;
    await fetchRemote(ctx);
    if ((await remoteTip(ctx)) !== v.base) {
      ctx.deps.log(
        `${ctx.config.remote}/${ctx.config.targetBranch} moved during validation; re-applying (attempt ${attempt})`,
      );
      prev = v.evidence;
      continue;
    }
    if (ctx.options.dryRun) {
      await dryRunHooks(ctx, v, sha);
      ctx.deps.log('dry-run: validated landing and exercised the pre-push guards; nothing pushed');
      return;
    }
    if ((await pushAndConfirm(ctx, v, sha)) === 'landed') {
      ctx.deps.log(`LANDED ${sha} on ${ctx.config.remote}/${ctx.config.targetBranch}`);
      return;
    }
    ctx.deps.log(
      `${ctx.config.remote}/${ctx.config.targetBranch} moved before the push landed; re-applying (attempt ${attempt})`,
    );
    prev = v.evidence;
  }
  throw new Abort(
    `${ctx.config.remote}/${ctx.config.targetBranch} kept moving; gave up after ${ctx.config.maxAttempts} attempts`,
    EXIT.push,
  );
}

export async function land(
  deps: EngineDeps,
  options: LandOptions,
  config: LandConfig,
): Promise<number> {
  const seed = { deps, options, config } as Ctx;
  seed.logDir = '';
  let handle: Awaited<ReturnType<typeof acquireLock>> | null = null;
  try {
    const sourceRoot = await gitOut(seed, ['rev-parse', '--show-toplevel'], deps.cwd);
    const commonDir = await gitOut(
      seed,
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      sourceRoot,
    );
    const id = repoId(commonDir, sourceRoot);
    const stateDir = join(deps.home, id);
    const stamp = new Date(deps.now()).toISOString().replace(/[:.]/g, '-');
    const ctx: Ctx = {
      deps,
      options,
      config,
      sourceRoot,
      worktree: join(stateDir, 'worktree'),
      stateDir,
      logDir: join(stateDir, 'logs', stamp),
    };
    for (const check of config.preflight)
      await runCheck(ctx, check, { base: '', head: '', worktree: '', source: sourceRoot });
    handle = await acquireLock(
      deps.lock,
      { pid: process.pid, repo: sourceRoot, ref: options.ref, user: deps.user() },
      config.lockWaitMaxSeconds * 1000,
    );
    await waitForLoad(ctx);
    await runAttempts(ctx);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof LockTimeout) {
      deps.error(error.message);
      return EXIT.busy;
    }
    deps.error(error instanceof Error ? error.message : String(error));
    return error instanceof Abort ? error.code : EXIT.gate;
  } finally {
    handle?.release();
  }
}
