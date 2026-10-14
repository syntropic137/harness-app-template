import { join } from 'node:path';
import { CONFIG_FILE, DEFAULT_CONFIG, type LandConfig, parseConfig } from './config';
import {
  Abort,
  baseEnv,
  type Ctx,
  EXIT,
  ensureWorktree,
  fetchRemote,
  git,
  gitOut,
  guardWorktree,
  isAncestor,
  pushEnv,
  remoteTip,
  requirePushTools,
  shortSha,
  tail,
} from './core';
import { describeExit, type RunResult, succeeded } from './exec';
import { acquireLock, type LockDeps, LockTimeout } from './lock';
import {
  CONFIG_KEY_PATHS,
  configKeyFromLsTree,
  effectiveHooks,
  hooksKey,
  judgePass,
  LEFTHOOK_LOCAL_PATHS,
  LOCAL_PASSES,
  PASS_FORMAT,
  type PassRecord,
  type PassSource,
  type PassVerdict,
  parsePass,
  passFetchRefspecs,
  remotePasses,
  summariseGates,
} from './pass';

/** Verify (record a pass) and land from a pass: the git side of the harness ADR-0034 verify/land split. */

const SLOT_POLL_MS = 5000;
const NOTE_ATTEMPTS = 8;

export async function configKeyAt(ctx: Ctx, commit: string): Promise<string> {
  const out = await gitOut(ctx, ['ls-tree', commit, '--', ...CONFIG_KEY_PATHS], ctx.sourceRoot);
  return configKeyFromLsTree(out);
}

/**
 * The land config and engine that run here are the invoking checkout's working tree. A pass binds
 * to B's, so refuse unless they are identical: no tracked difference from B (staged, unstaged or
 * committed) and no untracked file under CONFIG_KEY_PATHS.
 */
export async function landFilesMatch(ctx: Ctx, base: string): Promise<boolean> {
  const paths = ['--', ...CONFIG_KEY_PATHS];
  const diff = await git(ctx, ['diff', '--quiet', base, ...paths], ctx.sourceRoot);
  const untracked = await gitOut(
    ctx,
    ['ls-files', '--others', '--exclude-standard', ...paths],
    ctx.sourceRoot,
  );
  return succeeded(diff) && untracked === '';
}

export async function assertLandFilesMatch(ctx: Ctx, base: string): Promise<void> {
  if (await landFilesMatch(ctx, base)) return;
  throw new Abort(
    `this checkout's land config or engine (${CONFIG_KEY_PATHS.join(', ')}) differs from ${ctx.config.remote}/${ctx.config.targetBranch} ${shortSha(base)}; a pass would be judged by rules main does not hold. Bring those files to main's (rebase or restore them), then verify again`,
    EXIT.gate,
  );
}

/** Seconds with hundredths, for steps measured in a land that should take seconds. */
const since = (ctx: Ctx, start: number): number => Math.round((ctx.deps.now() - start) / 10) / 100;

async function timed<T>(ctx: Ctx, name: string, step: () => Promise<T>): Promise<T> {
  const start = ctx.deps.now();
  let ok = false;
  try {
    const value = await step();
    ok = true;
    return value;
  } finally {
    ctx.receipt.steps.push({ name, seconds: since(ctx, start), ok });
  }
}

/**
 * Take the first free verification worktree (`<state>/verify/<n>/worktree`, n = 1..verifySlots).
 * Each slot keeps its own node_modules and target/, so concurrent verifies never share a build dir;
 * a configured cargoTargetDir is split per slot for the same reason.
 */
export async function acquireVerifySlot(ctx: Ctx): Promise<void> {
  const { deps, options, config } = ctx;
  const slots = Math.max(1, Math.floor(config.verifySlots));
  const deadline = deps.now() + (options.waitSeconds ?? config.lockWaitMaxSeconds) * 1000;
  for (;;) {
    const busy: string[] = [];
    for (let n = 1; n <= slots; n += 1) {
      const dir = join(ctx.repoState, 'verify', String(n));
      const worktree = join(dir, 'worktree');
      try {
        const handle = await guardWorktree(ctx, dir, worktree, 'verification');
        ctx.receipt.release = () => handle.release();
        ctx.stateDir = dir;
        ctx.worktree = worktree;
        ctx.logDir = `${ctx.logDir}-verify-${n}`;
        const target = config.cargoTargetDir;
        if (target !== null) ctx.config = { ...config, cargoTargetDir: `${target}/verify-${n}` };
        deps.log(
          `verifying in ${worktree} (slot ${n} of ${slots}); the landing lease is not taken`,
        );
        return;
      } catch (error) {
        if (!(error instanceof LockTimeout)) throw error;
        busy.push(error.message);
      }
    }
    if (deps.now() >= deadline) {
      throw new LockTimeout(
        `all ${slots} verification worktrees are busy (verifySlots in land.config.json):\n${busy.join('\n')}`,
      );
    }
    await deps.sleep(SLOT_POLL_MS);
  }
}

export interface PassInput {
  refSha: string;
  c: string;
  base: string;
  passed: string[];
  hooksKey: string;
}

const ZERO_OID = '0'.repeat(40);

/**
 * Add the note for C to `refs/notes/land-pass` with a compare-and-swap: `git notes add` on a private
 * copy of the current notes ref, then `update-ref <notes> <new> <old>`. A concurrent writer makes
 * the swap fail; the note is then rebuilt on the new tip, so no writer's note is ever lost.
 */
export async function writePassNote(ctx: Ctx, c: string, text: string): Promise<void> {
  const notes = LOCAL_PASSES.notes;
  const scratch = `refs/notes/land-pass-write/${process.pid}-${ctx.deps.now()}-${c.slice(0, 12)}`;
  let failure = '';
  try {
    for (let attempt = 1; attempt <= NOTE_ATTEMPTS; attempt += 1) {
      const current = await git(ctx, ['rev-parse', '--verify', '--quiet', notes], ctx.sourceRoot);
      const old = succeeded(current) ? current.output.trim() : '';
      if (old === '') await git(ctx, ['update-ref', '-d', scratch], ctx.sourceRoot);
      else await gitOut(ctx, ['update-ref', scratch, old], ctx.sourceRoot);
      const added = await ctx.deps.run(
        'git',
        ['-c', 'core.hooksPath=/dev/null', 'notes', `--ref=${scratch}`, 'add', '-f', '-F', '-', c],
        { cwd: ctx.sourceRoot, env: baseEnv(ctx), input: text },
      );
      if (!succeeded(added)) {
        throw new Abort(
          `git notes add failed (${describeExit(added)})\n${tail(added.output)}`,
          EXIT.gate,
        );
      }
      const next = await gitOut(ctx, ['rev-parse', '--verify', scratch], ctx.sourceRoot);
      const swap = await git(
        ctx,
        ['update-ref', notes, next, old === '' ? ZERO_OID : old],
        ctx.sourceRoot,
      );
      if (succeeded(swap)) return;
      failure = `${notes} moved during the write (attempt ${attempt}): ${tail(swap.output)}`;
      await ctx.deps.sleep(50 * attempt);
    }
  } finally {
    await git(ctx, ['update-ref', '-d', scratch], ctx.sourceRoot);
  }
  throw new Abort(`could not record the pass note: ${failure}`, EXIT.gate);
}

/**
 * Write the record as a git note on C, then point `refs/land/verified/<ref_sha>` at C. The ref is
 * the commit point: land finds a record only through it, so a half-recorded pass is never used.
 * Both are plain git refs, so a pass verified here can be landed from any clone that fetches them.
 */
export async function recordPass(ctx: Ctx, input: PassInput): Promise<PassRecord> {
  const { deps, receipt } = ctx;
  // Checked again at the end: B may have moved, or the checkout changed, since the start.
  await assertLandFilesMatch(ctx, input.base);
  const key = await configKeyAt(ctx, input.base);
  const pass: PassRecord = {
    format: PASS_FORMAT,
    ref_sha: input.refSha,
    C: input.c,
    B: input.base,
    mode: ctx.options.mode,
    message: ctx.options.message,
    config_key: key,
    gates: summariseGates(receipt.steps),
    passed: input.passed,
    started: new Date(receipt.startedAt).toISOString(),
    seconds: since(ctx, receipt.startedAt),
    host: deps.host(),
    engine_version: key,
    hooks_key: input.hooksKey,
  };
  await writePassNote(ctx, input.c, `${JSON.stringify(pass, null, 2)}\n`);
  const ref = `${LOCAL_PASSES.verified}${input.refSha}`;
  await gitOut(ctx, ['update-ref', ref, input.c], ctx.sourceRoot);
  deps.log(
    `VERIFIED ${input.c} (ref ${shortSha(input.refSha)} on ${ctx.config.remote}/${ctx.config.targetBranch} ${shortSha(input.base)}); pass recorded as ${ref} + note ${LOCAL_PASSES.notes}. Land it with: just land ${ctx.options.ref}`,
  );
  return pass;
}

/** Copy a remote's pass records into `refs/land/pass-from/<remote>/`, never over local ones. */
async function fetchPasses(ctx: Ctx, remote: string): Promise<PassSource> {
  const result = await git(
    ctx,
    ['fetch', '--no-tags', remote, ...passFetchRefspecs(remote)],
    ctx.sourceRoot,
  );
  if (!succeeded(result)) {
    throw new Abort(
      `could not fetch pass records from ${remote} (${describeExit(result)})\n${tail(result.output)}`,
      EXIT.push,
    );
  }
  return remotePasses(remote);
}

/** main's land.config.json as committed at `commit` (defaults when absent), or why it is unreadable. */
async function configAt(ctx: Ctx, commit: string): Promise<LandConfig | string> {
  const path = `${commit}:${CONFIG_FILE}`;
  if (!succeeded(await git(ctx, ['cat-file', '-e', path], ctx.sourceRoot))) {
    return structuredClone(DEFAULT_CONFIG);
  }
  try {
    return parseConfig(JSON.parse(await gitOut(ctx, ['show', path], ctx.sourceRoot)));
  } catch (error) {
    // parseConfig, JSON.parse and gitOut all throw Error.
    return (error as Error).message;
  }
}

/**
 * Refuse when the worktree that runs hooks holds a lefthook local override (tracked, untracked or
 * ignored): lefthook merges it over the committed rules, and `git clean -fd` keeps ignored files in
 * a persistent worktree. A plain filesystem test, so ignore rules cannot hide one.
 */
export function assertNoLocalHookOverrides(ctx: Ctx): void {
  const found = LEFTHOOK_LOCAL_PATHS.filter((p) => ctx.deps.exists(join(ctx.worktree, p)));
  if (found.length === 0) return;
  throw new Abort(
    `${found.join(', ')} in ${ctx.worktree} overrides the committed lefthook config, so the hooks run there are not main's; remove it and run again`,
    EXIT.gate,
  );
}

/** The git tree id of `dir` in the worktree's HEAD, or `absent`. */
async function treeAtHead(ctx: Ctx, dir: string): Promise<string> {
  const tree = await git(ctx, ['rev-parse', '--verify', '--quiet', `HEAD:${dir}`]);
  return succeeded(tree) ? tree.output.trim() : 'absent';
}

/**
 * The key of the effective hook config of `ctx.worktree` as it stands: lefthook's own merge
 * (`lefthook dump`) plus the committed tree ids of the script dirs it names, which must hold
 * nothing beyond what is committed. A local script dir must not exist at all.
 */
async function effectiveHooksHere(ctx: Ctx): Promise<{ key: string } | { problem: string }> {
  const dump = await ctx.deps.run('sh', ['-c', `${ctx.config.lefthook} dump --format json`], {
    cwd: ctx.worktree,
    env: baseEnv(ctx),
  });
  if (!succeeded(dump)) return { problem: `lefthook dump failed (${describeExit(dump)})` };
  const hooks = effectiveHooks(dump.output);
  if ('problem' in hooks) return hooks;
  if (ctx.deps.exists(join(ctx.worktree, hooks.sourceDirLocal))) {
    return { problem: `the local lefthook script dir ${hooks.sourceDirLocal} exists here` };
  }
  // core.fileMode=false: lefthook marks scripts executable when it runs them; only content counts.
  const extra = await gitOut(ctx, [
    '-c',
    'core.fileMode=false',
    'status',
    '--porcelain',
    '--ignored',
    '--untracked-files=all',
    '--',
    hooks.sourceDir,
  ]);
  if (extra !== '') {
    return {
      problem: `the lefthook script dir ${hooks.sourceDir} holds files that are not committed: ${extra.split('\n')[0]}`,
    };
  }
  const [source, local] = [
    await treeAtHead(ctx, hooks.sourceDir),
    await treeAtHead(ctx, hooks.sourceDirLocal),
  ];
  return { key: hooksKey(hooks, source, local) };
}

/**
 * The key of the effective lefthook config that judged C, for the pass: lefthook's merged view
 * (`lefthook dump`) and its script dirs at C, which must equal the ones at B, so a candidate cannot
 * change the hook rules or scripts through any input (an `extends` file, a `source_dir`, another
 * format) the land-file key does not name. Leaves the verification worktree at B. Throws when no
 * pass can be recorded.
 */
export async function bindHooks(ctx: Ctx, base: string): Promise<string> {
  assertNoLocalHookOverrides(ctx);
  const atC = await effectiveHooksHere(ctx);
  await gitOut(ctx, ['checkout', '--detach', '--force', base]);
  assertNoLocalHookOverrides(ctx);
  const atB = await effectiveHooksHere(ctx);
  const noPass = (why: string): Abort =>
    new Abort(`no pass recorded: ${why}; land it with the full land`, EXIT.unverified);
  if ('problem' in atC) throw noPass(atC.problem);
  if ('problem' in atB) throw noPass(atB.problem);
  if (atB.key !== atC.key) {
    throw noPass(
      'the ref changes the effective lefthook config (lefthook dump or its script dirs differ between main and the verified commit)',
    );
  }
  return atC.key;
}

async function readPass(ctx: Ctx, source: PassSource, c: string): Promise<PassRecord | null> {
  const note = await git(ctx, ['notes', `--ref=${source.notes}`, 'show', c], ctx.sourceRoot);
  const read = succeeded(note) ? parsePass(note.output) : null;
  return read?.C === c ? read : null;
}

/**
 * What the pass record says about landing this ref right now. Without --pass-from it fetches only
 * when a local record exists, so a ref that was never verified costs nothing before the full land.
 */
export async function passVerdict(ctx: Ctx): Promise<PassVerdict> {
  const resolved = await git(
    ctx,
    ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ctx.options.ref}^{commit}`],
    ctx.sourceRoot,
  );
  if (!succeeded(resolved)) return { kind: 'stale', reason: `cannot resolve ${ctx.options.ref}` };
  const refSha = resolved.output.trim();
  const from = ctx.options.passFrom;
  const source = from === undefined ? LOCAL_PASSES : await fetchPasses(ctx, from);
  const where = from === undefined ? '' : ` from ${from}`;
  const ref = await git(
    ctx,
    ['rev-parse', '--verify', '--quiet', `${source.verified}${refSha}`],
    ctx.sourceRoot,
  );
  if (!succeeded(ref))
    return { kind: 'stale', reason: `no pass record${where} for ${shortSha(refSha)}` };
  const c = ref.output.trim();
  const pass = await readPass(ctx, source, c);
  await fetchRemote(ctx);
  const main = await remoteTip(ctx);
  const cExists = succeeded(await git(ctx, ['cat-file', '-e', `${c}^{commit}`], ctx.sourceRoot));
  const diff = await git(ctx, ['diff', '--name-only', main, c], ctx.sourceRoot);
  return judgePass({
    refSha,
    pass,
    main,
    mainConfigKey: await configKeyAt(ctx, main),
    cConfigKey: cExists ? await configKeyAt(ctx, c) : null,
    mainConfig: await configAt(ctx, main),
    changed: succeeded(diff) ? diff.output.split('\n').filter((l) => l.trim() !== '') : null,
    cExists,
    cOnMain: cExists && (await isAncestor(ctx, c, main)),
    requested: { mode: ctx.options.mode, message: ctx.options.message },
  });
}

/** A land from a pass ends in an exit code, or finds the pass stale after all (main moved). */
export type FastOutcome = number | { stale: string };

/** Take the lease and the landing worktree; true when the lease was contended (this run waited). */
async function takeLeaseAndWorktree(ctx: Ctx): Promise<boolean> {
  const { deps, options, config, receipt } = ctx;
  const queuedAt = deps.now();
  let waited = false;
  const lock: LockDeps = {
    ...deps.lock,
    sleep: (ms) => {
      waited = true;
      return deps.lock.sleep(ms);
    },
  };
  const lease = await acquireLock(
    lock,
    { pid: process.pid, repo: ctx.sourceRoot, ref: options.ref, user: deps.user() },
    (options.waitSeconds ?? config.lockWaitMaxSeconds) * 1000,
  );
  receipt.release = () => lease.release();
  const guard = await guardWorktree(
    ctx,
    ctx.stateDir,
    ctx.worktree,
    'landing',
    '; refusing a second land on it',
  );
  receipt.release = () => {
    guard.release();
    lease.release();
  };
  receipt.waitedSeconds = Math.round((deps.now() - queuedAt) / 1000);
  return waited;
}

function releaseAll(ctx: Ctx): void {
  ctx.receipt.release();
  ctx.receipt.release = () => undefined;
}

/** The program name of the configured hook runner (`pnpm exec lefthook` -> `lefthook`). */
export function runnerName(lefthook: string): string {
  // The last path segment of the last word; split always yields at least one element.
  return lefthook
    .trim()
    .split(/[\s/]+/)
    .at(-1) as string;
}

/**
 * Why the pre-push hook git will run for a push from the landing worktree (core.hooksPath
 * honoured) cannot be trusted to run the guards, or null when it can: it must exist, be executable
 * (git silently skips a hook that is not), and invoke the configured hook runner.
 */
async function hookProblem(ctx: Ctx): Promise<string | null> {
  const found = await ctx.deps.run(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-path', 'hooks/pre-push'],
    { cwd: ctx.worktree, env: baseEnv(ctx) },
  );
  const hook = found.output.trim();
  if (!succeeded(found) || !ctx.deps.exists(hook)) return `no pre-push hook is installed (${hook})`;
  const runner = runnerName(ctx.config.lefthook);
  const probe = await ctx.deps.run(
    'sh',
    [
      '-c',
      'test -x "$1" || { echo not-executable; exit 1; }; grep -q -- "$2" "$1" || { echo no-runner; exit 1; }',
      'sh',
      hook,
      runner,
    ],
    { cwd: ctx.worktree, env: baseEnv(ctx) },
  );
  if (succeeded(probe)) return null;
  return probe.output.includes('not-executable')
    ? `the pre-push hook ${hook} is not executable, so git would skip it`
    : `the pre-push hook ${hook} does not invoke the hook runner (${runner})`;
}

/** `<runner> install pre-push` from the landing worktree (main's config and lefthook.yml). */
async function installPrePush(ctx: Ctx): Promise<RunResult> {
  return ctx.deps.run('sh', ['-c', `${ctx.config.lefthook} install pre-push`], {
    cwd: ctx.worktree,
    env: baseEnv(ctx),
  });
}

/**
 * The guards run only inside the pre-push hook, so the hook's content must be known, not
 * inspected: before every push, install it with the configured runner (main's config; about 0.3 s
 * measured), so whatever was there before (missing, non-executable, foreign, or a stub that only
 * mentions the runner) is replaced. When the runner cannot install, provision with the configured
 * bootstrap once and retry; then refuse. The installed hook is checked (exists, executable,
 * invokes the runner) and every pushRequires tool must be on PATH.
 */
export async function requireGuards(ctx: Ctx, provision: () => Promise<void>): Promise<void> {
  assertNoLocalHookOverrides(ctx);
  let installed = await installPrePush(ctx);
  if (!succeeded(installed)) {
    ctx.deps.log(
      'the hook runner could not install the pre-push hook; provisioning with the bootstrap',
    );
    await provision();
    installed = await installPrePush(ctx);
  }
  if (!succeeded(installed)) {
    throw new Abort(
      `the hook runner (${ctx.config.lefthook}) could not install the pre-push hook (${describeExit(installed)}): the push guards would not run, refusing\n${tail(installed.output)}`,
      EXIT.push,
    );
  }
  // The bootstrap or the runner's install may itself have written a local override.
  assertNoLocalHookOverrides(ctx);
  const problem = await hookProblem(ctx);
  if (problem !== null) {
    throw new Abort(
      `${problem} after installing it: the push guards would not run, refusing`,
      EXIT.push,
    );
  }
  await requirePushTools(ctx);
}

/** `git push --porcelain` marks a ref the remote already had with `=`: nothing was pushed. */
function upToDate(output: string, targetBranch: string): boolean {
  return output
    .split('\n')
    .some((l) => l.startsWith('=') && l.includes(`refs/heads/${targetBranch}`));
}

/**
 * The remote's verdict on pushing C to the target, from `git push --porcelain`, trusted only when
 * unambiguous: the push exited 0 on its own (not signal-killed), reported `Done`, and has exactly
 * one line for the target whose source is C, flagged ` ` (fast-forward), `+` or `*` (pushed) or
 * `=` (already there). Anything else is 'unclear' and must be confirmed by a fetch.
 */
export function porcelainOutcome(
  result: RunResult,
  c: string,
  targetBranch: string,
): 'pushed' | 'up-to-date' | 'unclear' {
  if (result.signal !== null || result.status !== 0) return 'unclear';
  const lines = result.output.split('\n').map((l) => l.replace(/\r$/, ''));
  if (!lines.some((l) => l.trim() === 'Done')) return 'unclear';
  const target = `:refs/heads/${targetBranch}`;
  const refLines = lines.filter((l) => /^[ +*=!-]\t/.test(l) && l.split('\t')[1]?.endsWith(target));
  if (refLines.length !== 1) return 'unclear';
  const [flag, spec = ''] = (refLines[0] as string).split('\t');
  if (spec !== `${c}${target}`) return 'unclear';
  if (flag === '=') return 'up-to-date';
  return flag === ' ' || flag === '+' || flag === '*' ? 'pushed' : 'unclear';
}

/**
 * ADR-0034 decision 1 without the queue: under the lease, push exactly C with a compare-and-swap on
 * main tip M, the SHA-bound marker set so guard-main-push and every other pre-push guard run on the
 * real push (C4), then observe C on main (C5). No gate runs here.
 */
export async function fastLand(
  ctx: Ctx,
  pass: PassRecord,
  exclude: string[],
  provision: () => Promise<void>,
): Promise<FastOutcome> {
  const { deps, config, receipt } = ctx;
  const { remote, targetBranch } = config;
  receipt.stage = 'land';
  receipt.sha = pass.C;
  const contended = await timed(ctx, 'lease', () => takeLeaseAndWorktree(ctx));
  // M is the tip passVerdict just fetched and judged equal to B. When this run had to wait for the
  // lease, another lander may have pushed meanwhile: look again before pushing. Uncontended, the
  // compare-and-swap push and the up-to-date check below cover the race without a second fetch.
  let main = pass.B;
  if (contended) {
    main = await timed(ctx, 'fetch', async () => {
      await fetchRemote(ctx);
      return remoteTip(ctx);
    });
    if (await isAncestor(ctx, pass.C, main)) {
      deps.log(
        `already landed: ${shortSha(pass.C)} is on ${remote}/${targetBranch} (another lander got there first); nothing pushed`,
      );
      return EXIT.ok;
    }
  }
  if (main !== pass.B) {
    releaseAll(ctx);
    return {
      stale: `main moved while waiting for the lease (verified on ${shortSha(pass.B)}, main is ${shortSha(main)})`,
    };
  }
  // Verify builds C on B, so only a forged record fails this; a force-with-lease push of such a C
  // would rewrite main instead of extending it.
  if (!(await isAncestor(ctx, main, pass.C))) {
    releaseAll(ctx);
    return {
      stale: `the verified commit ${shortSha(pass.C)} does not descend from main ${shortSha(main)}`,
    };
  }
  await timed(ctx, 'checkout', () => ensureWorktree(ctx, pass.C));
  await timed(ctx, 'guards', () => requireGuards(ctx, provision));
  // The hooks that run on this push are lefthook's merged view here: it must be the one verified.
  const here = await timed(ctx, 'hooks', () => effectiveHooksHere(ctx));
  if ('problem' in here || here.key !== pass.hooks_key) {
    releaseAll(ctx);
    return {
      stale:
        'problem' in here
          ? here.problem
          : 'the effective lefthook config here (lefthook dump) is not the one verified',
    };
  }
  deps.log(
    `landing verified ${shortSha(pass.C)} onto ${remote}/${targetBranch} ${shortSha(main)} (jobs skipped, verified on this SHA: ${exclude.join(',') || 'none'})`,
  );
  assertNoLocalHookOverrides(ctx);
  const result = await timed(ctx, 'push', () =>
    deps.run(
      'git',
      [
        'push',
        '--porcelain',
        `--force-with-lease=refs/heads/${targetBranch}:${main}`,
        remote,
        `${pass.C}:refs/heads/${targetBranch}`,
      ],
      {
        cwd: ctx.worktree,
        env: pushEnv(ctx, pass.C, exclude),
        onLine: (l) => deps.log(`  [push] ${l}`),
      },
    ),
  );
  // The remote's own per-ref report, from a push that exited 0 on its own, is the observation (C5)
  // and saves a round trip. Anything less clear fetches and checks ancestry.
  const reported = porcelainOutcome(result, pass.C, targetBranch);
  if (reported !== 'unclear') {
    receipt.confirm = 'porcelain';
    if (reported === 'pushed') {
      deps.log(`LANDED ${pass.C} on ${remote}/${targetBranch} (from pass record, no gates re-run)`);
    } else {
      deps.log(
        `already landed: ${remote}/${targetBranch} already had ${shortSha(pass.C)}; this push moved nothing (another lander got there first)`,
      );
    }
    return EXIT.ok;
  }
  receipt.confirm = 'fetched';
  // The push's own status is a claim; origin containing C is the fact (C5).
  const tip = await timed(ctx, 'confirm', async () => {
    await fetchRemote(ctx);
    return remoteTip(ctx);
  });
  const onMain = await isAncestor(ctx, pass.C, tip);
  if (onMain && succeeded(result) && !upToDate(result.output, targetBranch)) {
    deps.log(`LANDED ${pass.C} on ${remote}/${targetBranch} (from pass record, no gates re-run)`);
    return EXIT.ok;
  }
  if (onMain) {
    deps.log(
      `already landed: ${remote}/${targetBranch} contains ${shortSha(pass.C)} and this push moved nothing (${describeExit(result)}; another lander got there first)`,
    );
    return EXIT.ok;
  }
  if (tip !== main) {
    releaseAll(ctx);
    return {
      stale: `main moved before the push (compare-and-swap on ${shortSha(main)} rejected; main is ${shortSha(tip)})`,
    };
  }
  throw new Abort(
    `push failed (${describeExit(result)}) and ${remote}/${targetBranch} does not contain ${shortSha(pass.C)}\n${tail(result.output)}`,
    EXIT.push,
  );
}
