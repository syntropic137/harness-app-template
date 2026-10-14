import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import type { CheckConfig, GateConfig, LandConfig } from './config';
import {
  Abort,
  baseEnv,
  type Ctx,
  type EngineDeps,
  type Evidence,
  EXIT,
  ensureCheckout,
  ensureWorktree,
  excludedJobs,
  fetchRemote,
  git,
  gitOut,
  guardWorktree,
  isLefthookGate,
  type LandOptions,
  planGates,
  pushEnv,
  type Receipt,
  remoteTip,
  requirePushTools,
  shortSha,
  tail,
} from './core';
import { describeExit, type RunResult, succeeded } from './exec';
import { acquireLock, LockTimeout } from './lock';
import type { PassVerdict } from './pass';
import { type Classification, classify, gateApplies, matchesAny } from './scope';
import {
  acquireVerifySlot,
  assertLandFilesMatch,
  type FastOutcome,
  fastLand,
  landFilesMatch,
  passVerdict,
  recordPass,
} from './verified';

export type { EngineDeps, Evidence, LandMode, LandOptions, Receipt } from './core';
export { EXIT, excludedJobs, isLefthookGate, planGates } from './core';

const PASSED_JOB = /^\s*(?:✔️|✔|✓)\s+(\S+)/u;

export function passedJobs(output: string): Set<string> {
  const jobs = new Set<string>();
  for (const line of output.split('\n')) {
    const match = PASSED_JOB.exec(line);
    if (match?.[1] !== undefined) jobs.add(match[1]);
  }
  return jobs;
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

export function repoId(commonDir: string, toplevel: string): string {
  return `${basename(toplevel)}-${createHash('sha1').update(commonDir).digest('hex').slice(0, 10)}`;
}

async function runLogged(
  ctx: Ctx,
  name: string,
  command: string,
  args: string[],
  cwd: string,
  input?: string,
): Promise<RunResult> {
  const start = ctx.deps.now();
  const lines: string[] = [];
  const result = await ctx.deps.run(command, args, {
    cwd,
    env: baseEnv(ctx),
    input,
    onLine: (line) => {
      lines.push(line);
      ctx.deps.log(`  [${name}] ${line}`);
    },
  });
  ctx.deps.mkdirp(ctx.logDir);
  ctx.deps.writeFile(join(ctx.logDir, `${name}.log`), `${lines.join('\n')}\n`);
  const seconds = Math.round((ctx.deps.now() - start) / 1000);
  ctx.receipt.steps.push({ name, seconds, ok: succeeded(result) });
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

/** Why the machine is not quiet right now, or null when it is. */
async function busyReason(ctx: Ctx): Promise<string | null> {
  const load = ctx.deps.loadavg();
  if (load > ctx.config.loadMax) return `load ${load.toFixed(1)} is above ${ctx.config.loadMax}`;
  const { quietCommand } = ctx.config;
  if (quietCommand === null) return null;
  const quiet = await ctx.deps.run('sh', ['-c', quietCommand], {
    cwd: ctx.sourceRoot,
    env: baseEnv(ctx),
  });
  return succeeded(quiet)
    ? null
    : `quiet check failed (${describeExit(quiet)}): ${quiet.output.trim()}`;
}

async function waitForLoad(ctx: Ctx): Promise<void> {
  const { loadPollSeconds, loadWaitMaxSeconds } = ctx.config;
  const deadline = ctx.deps.now() + loadWaitMaxSeconds * 1000;
  for (let reason = await busyReason(ctx); reason !== null; reason = await busyReason(ctx)) {
    if (ctx.deps.now() >= deadline) {
      if (ctx.config.onLoadTimeout === 'proceed') {
        ctx.deps.log(
          `${reason}; still busy after waiting ${loadWaitMaxSeconds}s, proceeding anyway`,
        );
        return;
      }
      throw new Abort(
        `${reason}; still busy after ${loadWaitMaxSeconds}s, not starting gates`,
        EXIT.busy,
      );
    }
    ctx.deps.log(`${reason}; waiting ${loadPollSeconds}s`);
    await ctx.deps.sleep(loadPollSeconds * 1000);
  }
}

async function applyMerge(ctx: Ctx, target: string): Promise<void> {
  const { message } = ctx.options;
  const args =
    message === null
      ? ['merge', '--no-ff', '--no-edit', target]
      : ['merge', '--no-ff', '-m', message, target];
  await gitOut(ctx, args);
}

async function applyCherryPick(ctx: Ctx, base: string, target: string): Promise<void> {
  const listed = await gitOut(ctx, ['rev-list', '--reverse', `${base}..${target}`]);
  const commits = listed.split('\n').filter(Boolean);
  if (commits.length === 0) {
    throw new Abort(
      `ref ${ctx.options.ref} has no commits absent from ${shortSha(base)}`,
      EXIT.gate,
    );
  }
  ctx.deps.log(`cherry-picking ${commits.length} commit(s) onto ${shortSha(base)}`);
  for (const commit of commits) {
    const result = await git(ctx, ['cherry-pick', commit]);
    if (!succeeded(result)) {
      await git(ctx, ['cherry-pick', '--abort']);
      throw new Abort(
        `cherry-pick ${shortSha(commit)} failed (${describeExit(result)})\n${tail(result.output)}`,
        EXIT.gate,
      );
    }
  }
}

async function applyTarget(ctx: Ctx, base: string, target: string): Promise<void> {
  const { mode } = ctx.options;
  if (mode === 'merge') return applyMerge(ctx, target);
  const ff = succeeded(await git(ctx, ['merge-base', '--is-ancestor', base, target]));
  if (mode === 'ff-only' || (mode === 'auto' && ff)) {
    await gitOut(ctx, ['merge', '--ff-only', target]);
    return;
  }
  return applyCherryPick(ctx, base, target);
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

/** The ref line git feeds a pre-push hook, so jobs that use stdin (`use_stdin`) see this landing's push. */
function prePushStdin(ctx: Ctx, base: string, sha: string): string {
  return `HEAD ${sha} refs/heads/${ctx.config.targetBranch} ${base}\n`;
}

async function runLefthookBatch(
  ctx: Ctx,
  jobs: string[],
  evidence: Evidence,
  base: string,
): Promise<void> {
  const url = await gitOut(ctx, ['remote', 'get-url', ctx.config.remote]);
  const selector = ctx.config.lefthookSelector;
  const selected = selector.endsWith('s')
    ? [selector, jobs.join(',')]
    : jobs.flatMap((job) => [selector, job]);
  const args = ['run', 'pre-push', '--force', ...selected, ctx.config.remote, url];
  const [bin = 'lefthook', ...pre] = ctx.config.lefthook.split(/\s+/);
  const result = await runLogged(
    ctx,
    'lefthook',
    bin,
    [...pre, ...args],
    ctx.worktree,
    prePushStdin(ctx, base, evidence.sha),
  );
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

/**
 * Run lanes with at most `limit` in flight. Every started lane finishes (a child cannot be
 * recalled mid-run) and the first failure, in lane order, is then thrown, so one red gate never
 * hides another and evidence is recorded for every lane that passed.
 */
export async function runLanes(lanes: Array<() => Promise<void>>, limit: number): Promise<void> {
  const failures: unknown[] = new Array(lanes.length).fill(undefined);
  let failed = false;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < lanes.length) {
      const index = next;
      next += 1;
      try {
        await (lanes[index] as () => Promise<void>)();
      } catch (error) {
        failures[index] = error;
        failed = true;
      }
    }
  };
  await Promise.allSettled(Array.from({ length: Math.max(1, limit) }, worker));
  if (failed) throw failures.find((f) => f !== undefined);
}

async function runCheck(ctx: Ctx, check: CheckConfig, vars: Vars): Promise<void> {
  const cwd = check.cwd === 'source' ? ctx.sourceRun : ctx.worktree;
  const command = expand(check.run, vars);
  let result = await runLogged(ctx, check.name, 'sh', ['-c', command], cwd);
  if (
    !succeeded(result) &&
    check.retryOnOutput !== undefined &&
    new RegExp(check.retryOnOutput).test(result.output)
  ) {
    ctx.deps.log(`${check.name}: output matched /${check.retryOnOutput}/; retrying once`);
    result = await runLogged(ctx, `${check.name}-retry`, 'sh', ['-c', command], cwd);
  }
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
  /** The commit the ref named. */
  target: string;
  base: string;
  evidence: Evidence;
  scopedOut: GateConfig[];
}

type CommandGate = GateConfig & { run: string };

const hasCommand = (gate: GateConfig): gate is CommandGate => gate.run !== undefined;

/** The work to do for these gates: the lefthook batch is one lane, command gates share lanes by name. */
function gateLanes(
  ctx: Ctx,
  todo: GateConfig[],
  evidence: Evidence,
  vars: Vars,
  base: string,
): Array<() => Promise<void>> {
  const lanes: Array<() => Promise<void>> = [];
  const jobs = todo.filter(isLefthookGate).map((g) => g.name);
  if (jobs.length > 0) lanes.push(() => runLefthookBatch(ctx, jobs, evidence, base));
  const commandLanes = new Map<string, CommandGate[]>();
  for (const gate of todo.filter(hasCommand)) {
    const key = gate.lane ?? `gate:${gate.name}`;
    commandLanes.set(key, [...(commandLanes.get(key) ?? []), gate]);
  }
  for (const gates of commandLanes.values()) {
    lanes.push(async () => {
      // Gates in one lane run in order; the first failure stops the lane.
      for (const gate of gates) {
        const { name, run, retryOnOutput, cwd } = gate;
        await runCheck(ctx, { name, run, cwd: cwd ?? 'worktree', retryOnOutput }, vars);
        evidence.passed.set(name, evidence.sha);
      }
    });
  }
  return lanes;
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
  // Evidence belongs to one SHA: a different SHA starts empty unless inheritance is provable.
  const evidence =
    prev === null
      ? { sha, passed: new Map<string, string>() }
      : inheritEvidence(prev, sha, await changedFiles(ctx, prev.sha, sha), ctx.config);
  const c = classify(await changedFiles(ctx, base, sha), ctx.config);
  const { selected, scopedOut } = planGates(ctx.config, c);
  ctx.deps.log(describePlan(c, selected, scopedOut));
  if (ctx.options.verify === true) await useCleanSource(ctx, base);
  const vars = { base, head: sha, worktree: ctx.worktree, source: ctx.sourceRun };
  for (const check of ctx.config.earlyChecks) await runCheck(ctx, check, vars);
  await bootstrapIfNeeded(ctx, c, vars);
  const todo = selected.filter((g) => !evidence.passed.has(g.name));
  await requireTools(ctx, todo);
  const lanes = gateLanes(ctx, todo, evidence, vars, base);
  await runLanes(lanes, ctx.config.parallelGates);
  for (const check of ctx.config.checks) await runCheck(ctx, check, vars);
  await assertUnchanged(ctx, sha);
  return { target, base, evidence, scopedOut };
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
    ctx.receipt.sha = sha;
    await fetchRemote(ctx);
    if ((await remoteTip(ctx)) !== v.base) {
      ctx.deps.log(
        `${ctx.config.remote}/${ctx.config.targetBranch} moved during validation; re-applying (attempt ${attempt})`,
      );
      prev = v.evidence;
      continue;
    }
    await requirePushTools(ctx);
    if (ctx.options.verify === true) {
      await dryRunHooks(ctx, v, sha);
      // Every gate with evidence on C, plus the early checks and checks, which all ran and passed
      // to get here. Land requires each one its own reading of main's config makes applicable.
      const ran = [...ctx.config.earlyChecks, ...ctx.config.checks].map((c) => c.name);
      await recordPass(ctx, {
        refSha: v.target,
        c: sha,
        base: v.base,
        passed: [...new Set([...v.evidence.passed.keys(), ...ran])].sort(),
      });
      return;
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

/** The exit code for an error that escaped the landing. */
function failureCode(deps: EngineDeps, error: unknown): number {
  deps.error(error instanceof Error ? error.message : String(error));
  if (error instanceof LockTimeout) return EXIT.busy;
  return error instanceof Abort ? error.code : EXIT.gate;
}

/** Resolve the source repo and its landing state; nothing is locked yet. */
async function makeCtx(
  deps: EngineDeps,
  options: LandOptions,
  config: LandConfig,
  receipt: Receipt,
): Promise<Ctx> {
  const seed = { deps, options, config } as Ctx;
  seed.logDir = '';
  const sourceRoot = await gitOut(seed, ['rev-parse', '--show-toplevel'], deps.cwd);
  const commonDir = await gitOut(
    seed,
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    sourceRoot,
  );
  const repoState = join(deps.home, repoId(commonDir, sourceRoot));
  const stamp = new Date(deps.now()).toISOString().replace(/[:.]/g, '-');
  receipt.stateDir = repoState;
  return {
    deps,
    receipt,
    options,
    config,
    sourceRoot,
    sourceRun: sourceRoot,
    repoState,
    worktree: join(repoState, 'worktree'),
    stateDir: repoState,
    logDir: join(repoState, 'logs', stamp),
  };
}

/**
 * Verify runs every `cwd: source` step (preflight, early checks, checks, gates) from a clean
 * slot-owned checkout of B, never the invoking checkout: a local edit to a source-run script cannot
 * change what a pass says ran. It holds no ignored caches, so such steps must not need them.
 */
async function useCleanSource(ctx: Ctx, base: string): Promise<void> {
  const dir = join(ctx.stateDir, 'source');
  await ensureCheckout(ctx, dir, base);
  ctx.sourceRun = dir;
}

async function runPreflight(ctx: Ctx): Promise<void> {
  for (const check of ctx.config.preflight)
    await runCheck(ctx, check, { base: '', head: '', worktree: '', source: ctx.sourceRun });
}

/** Today's land: under the lease, gate the ref on fresh main in the landing worktree, then push (or dry-run). */
async function fullLand(ctx: Ctx): Promise<number> {
  const { deps, options, config, receipt } = ctx;
  receipt.stage = 'full';
  await runPreflight(ctx);
  const queuedAt = deps.now();
  const handle = await acquireLock(
    deps.lock,
    { pid: process.pid, repo: ctx.sourceRoot, ref: options.ref, user: deps.user() },
    (options.waitSeconds ?? config.lockWaitMaxSeconds) * 1000,
  );
  receipt.release = () => handle.release();
  // Second line of defence behind the lease: if a live holder was ever wrongly reaped, a second
  // land refuses at once instead of resetting a worktree another land is gating in.
  const worktreeGuard = await guardWorktree(
    ctx,
    ctx.stateDir,
    ctx.worktree,
    'landing',
    '; refusing a second land on it',
  );
  receipt.release = () => {
    worktreeGuard.release();
    handle.release();
  };
  receipt.sampleStart = await samplePressure(deps, config);
  await waitForLoad(ctx);
  receipt.waitedSeconds = Math.round((deps.now() - queuedAt) / 1000);
  await runAttempts(ctx);
  return EXIT.ok;
}

/**
 * `just verify`: the full land's gates and pre-push dry run, minus the push, in a verification
 * worktree of its own (never the lease), so several refs can verify at once. Records a pass.
 */
async function verifyRun(ctx: Ctx): Promise<number> {
  const { deps, config, receipt } = ctx;
  receipt.stage = 'verify';
  // Fail before any gate when this checkout would judge the ref by rules main does not hold.
  await fetchRemote(ctx);
  const tip = await remoteTip(ctx);
  await assertLandFilesMatch(ctx, tip);
  const queuedAt = deps.now();
  await acquireVerifySlot(ctx);
  await useCleanSource(ctx, tip);
  await runPreflight(ctx);
  receipt.sampleStart = await samplePressure(deps, config);
  await waitForLoad(ctx);
  receipt.waitedSeconds = Math.round((deps.now() - queuedAt) / 1000);
  await runAttempts(ctx);
  return EXIT.ok;
}

/**
 * Land from a current pass, run entirely under main's validated config (pushRequires, lefthook,
 * marker, remote, guards), and only from a checkout whose land config and engine are main's: the
 * same rule verify applies, so a weakened local config can never ride a valid pass.
 */
async function landFromPass(
  ctx: Ctx,
  verdict: Extract<PassVerdict, { kind: 'current' }>,
): Promise<FastOutcome> {
  const { pass } = verdict;
  if (!(await landFilesMatch(ctx, pass.B))) {
    return {
      stale: "this checkout's land config or engine differs from main's (rebase, or restore them)",
    };
  }
  ctx.config = verdict.config;
  const provision = async (): Promise<void> => {
    const { bootstrap } = ctx.config;
    if (bootstrap === null) return;
    const vars = { base: pass.B, head: pass.C, worktree: ctx.worktree, source: ctx.sourceRoot };
    await runCheck(ctx, { name: 'bootstrap', run: bootstrap.run, cwd: 'worktree' }, vars);
    ctx.deps.writeFile(join(ctx.stateDir, 'bootstrapped'), `${ctx.deps.now()}\n`);
  };
  return fastLand(ctx, pass, verdict.exclude, provision);
}

/** `just land`: a current pass lands in seconds; otherwise say why, then the full land (or refuse with --require-pass). */
async function landFromPassOrFull(ctx: Ctx): Promise<number> {
  const { deps, options, receipt } = ctx;
  const verdict = await passVerdict(ctx);
  let reason: string;
  if (verdict.kind === 'landed') {
    receipt.stage = 'land';
    receipt.sha = verdict.pass.C;
    deps.log(
      `already landed: ${shortSha(verdict.pass.C)} (verified from ${shortSha(verdict.pass.ref_sha)}) is on ${ctx.config.remote}/${ctx.config.targetBranch}; nothing pushed`,
    );
    return EXIT.ok;
  }
  if (verdict.kind === 'current') {
    const outcome = await landFromPass(ctx, verdict);
    if (typeof outcome === 'number') return outcome;
    reason = outcome.stale;
  } else {
    reason = verdict.reason;
  }
  const line = `not verified on current main: ${reason}; run just verify ${options.ref}`;
  if (options.requirePass === true) {
    deps.error(`${line} (--require-pass: refusing the full land)`);
    return EXIT.unverified;
  }
  deps.log(`${line}. Falling back to the full gated land.`);
  return fullLand(ctx);
}

async function dispatch(
  deps: EngineDeps,
  options: LandOptions,
  config: LandConfig,
  receipt: Receipt,
): Promise<number> {
  const ctx = await makeCtx(deps, options, config, receipt);
  if (options.verify === true) return verifyRun(ctx);
  if (options.dryRun) return fullLand(ctx);
  return landFromPassOrFull(ctx);
}

/** One-line output of the configured sampler, or a note on why there is none. Never throws, never gates. */
async function samplePressure(deps: EngineDeps, config: LandConfig): Promise<string | null> {
  if (config.sampleCommand === null) return null;
  const result = await deps.run('sh', ['-c', config.sampleCommand], {
    cwd: deps.cwd,
    env: deps.env,
  });
  const line = result.output.trim().split('\n').join(' ').slice(0, 500);
  return succeeded(result) ? line : `sample failed (${describeExit(result)}): ${line}`;
}

/** Append this run to <state>/runs.jsonl. A receipt that cannot be written never changes the outcome. */
function recordRun(
  deps: EngineDeps,
  options: LandOptions,
  receipt: Receipt,
  exit: number,
  startedAt: number,
): void {
  if (receipt.stateDir === null) return;
  const line = JSON.stringify({
    at: new Date(startedAt).toISOString(),
    ref: options.ref,
    stage: receipt.stage,
    ...(receipt.confirm === undefined ? {} : { confirm: receipt.confirm }),
    dryRun: options.dryRun,
    sha: receipt.sha,
    exit,
    // Hundredths: a land from a pass takes seconds, and whole seconds would hide its budget.
    totalSeconds: Math.round((deps.now() - startedAt) / 10) / 100,
    waitedSeconds: receipt.waitedSeconds,
    sampleStart: receipt.sampleStart,
    sampleEnd: receipt.sampleEnd,
    steps: receipt.steps,
  });
  try {
    deps.mkdirp(receipt.stateDir);
    deps.appendFile(join(receipt.stateDir, 'runs.jsonl'), `${line}\n`);
  } catch (error) {
    deps.error(
      `could not record the run receipt: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function land(
  deps: EngineDeps,
  options: LandOptions,
  config: LandConfig,
): Promise<number> {
  const startedAt = deps.now();
  const receipt: Receipt = {
    release: () => undefined,
    stateDir: null,
    stage: 'full',
    startedAt,
    sha: null,
    waitedSeconds: 0,
    sampleStart: null,
    sampleEnd: null,
    steps: [],
  };
  const code = await dispatch(deps, options, config, receipt).catch((error: unknown) =>
    failureCode(deps, error),
  );
  receipt.release();
  // The pressure sample explains slow gates; a land from a pass runs none, and the sampler itself
  // can take a second (iostat), which would be a fifth of that land's budget.
  const sampled = receipt.stateDir !== null && receipt.stage !== 'land';
  receipt.sampleEnd = sampled ? await samplePressure(deps, config) : null;
  recordRun(deps, options, receipt, code, startedAt);
  return code;
}
