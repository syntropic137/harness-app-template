import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import type { Ctx } from '../lib/land/core';
import { EXIT, land } from '../lib/land/engine';
import type { RunResult } from '../lib/land/exec';
import type { LockDeps } from '../lib/land/lock';
import { writePassNote } from '../lib/land/verified';
import { branch, type Fixture, fixture, OPTS, parseRun, sh } from './helpers/land-fixture';

// The failure and race paths of verify and land from a pass, against throwaway repos (the main
// flows are in land-verify-e2e.test.ts). Same allowance as that file.
vi.setConfig({ testTimeout: 200_000 });

const VERIFY = { ...OPTS, verify: true };
const STRICT = { ...OPTS, requirePass: true };

async function setup(extra: Record<string, unknown> = {}): Promise<Fixture> {
  const f = await fixture();
  await f.publishConfig(extra);
  return f;
}

const stateDir = async (f: Fixture): Promise<string> =>
  join(f.home, await sh(f.home, 'ls -d src-*'));

async function lastRun(f: Fixture): Promise<ReturnType<typeof parseRun>> {
  const lines = readFileSync(join(await stateDir(f), 'runs.jsonl'), 'utf8')
    .trim()
    .split('\n');
  return parseRun(lines.at(-1) as string);
}

/** A live holder (pid 100 is alive in the fixture's memory lock). */
const holder = (ref: string): string =>
  JSON.stringify({
    pid: 100,
    bootId: 'boot1',
    startedAt: '2026-10-08T00:00:00Z',
    repo: 'r',
    ref,
    user: 'u',
  });

/** Hold the lease; on the first wait, run `meanwhile` (another lander), then release it. */
function contend(f: Fixture, meanwhile: () => Promise<void> | void): void {
  const lock = f.deps.lock;
  lock.createExclusive(lock.lockPath, holder('other'));
  let released = false;
  const wrapped: LockDeps = {
    ...lock,
    sleep: async (ms) => {
      if (!released) {
        await meanwhile();
        lock.remove(lock.lockPath);
        released = true;
      }
      await lock.sleep(ms);
    },
  };
  f.deps.lock = wrapped;
}

function noteCtx(f: Fixture): Ctx {
  return {
    deps: f.deps,
    config: f.config(),
    options: OPTS,
    sourceRoot: f.src,
    receipt: { steps: [] },
  } as unknown as Ctx;
}

describe('verify: slots, cargo dir and note writing', () => {
  test('a configured cargoTargetDir is split per verification slot', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    const probe = { name: 'cargo', run: 'echo "$CARGO_TARGET_DIR" > "$FAKE_STATE/cargo.log"' };
    const config = f.config({ cargoTargetDir: '/abs/t', checks: [probe] });
    expect(await land(f.deps, VERIFY, config)).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'cargo.log'), 'utf8').trim()).toBe('/abs/t/verify-1');
  });

  test('a lock failure other than "busy" while taking a slot is reported, not swallowed', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    const lock = f.deps.lock;
    f.deps.lock = {
      ...lock,
      createExclusive: (path, text) => {
        if (path.includes('/verify/')) throw new Error('disk full');
        return lock.createExclusive(path, text);
      },
    };
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/disk full/);
  });

  test('with --wait, busy slots are polled until the deadline, then refused', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    const config = f.config({ verifySlots: 1 });
    expect(await land(f.deps, VERIFY, config)).toBe(EXIT.ok); // creates the state dir
    f.deps.lock.createExclusive(
      join(await stateDir(f), 'verify', '1', 'worktree.lock'),
      holder('x'),
    );
    const before = f.clock.t;
    expect(await land(f.deps, { ...VERIFY, waitSeconds: 12 }, config)).toBe(EXIT.busy);
    expect(f.clock.t - before).toBeGreaterThanOrEqual(12_000);
    expect(f.errors.join('\n')).toMatch(/all 1 verification worktrees are busy/);
  });

  test('a note that git cannot add (an unresolvable object name) fails the write', async () => {
    const f = await setup();
    await expect(writePassNote(noteCtx(f), 'no-such-object', 'x\n')).rejects.toThrow(
      /git notes add failed/,
    );
  });

  test('a notes ref that keeps moving gives up after bounded attempts and leaves no scratch ref', async () => {
    const f = await setup();
    const c = await f.commit(f.src, 'n.txt');
    const ctx = noteCtx(f);
    const run = f.deps.run;
    ctx.deps = {
      ...f.deps,
      run: async (command, args, options): Promise<RunResult> => {
        const swap = args.includes('update-ref') && args.at(-3) === 'refs/notes/land-pass';
        return swap
          ? { status: 1, signal: null, output: 'lost the race' }
          : run(command, args, options);
      },
    };
    await expect(writePassNote(ctx, c, 'x\n')).rejects.toThrow(
      /could not record the pass note: refs\/notes\/land-pass moved during the write \(attempt 8\)/,
    );
    expect(await sh(f.src, 'git for-each-ref refs/notes/land-pass-write')).toBe('');
  });
});

describe('land from a pass: what is read from main and the record', () => {
  test('main without land.config.json lands from a pass under the defaults', async () => {
    const f = await fixture();
    // The default runner is `lefthook` on PATH: point it at the fixture's fake runner.
    const bin = join(f.root, 'bin');
    await sh(f.root, `mkdir -p bin && ln -s ${join(f.root, 'fake-lefthook')} bin/lefthook`);
    f.env.PATH = `${bin}:${f.env.PATH ?? ''}`;
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    expect(await land(f.deps, STRICT, f.config())).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(refSha);
  });

  test("an unparsable land.config.json on main is stale, with parseConfig's reason", async () => {
    const f = await setup({ bogusKey: 1 });
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    expect(await land(f.deps, STRICT, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/main's land config is unreadable: .*unknown key bogusKey/);
  });

  test('a verified ref without a readable note, or with a note for another commit, has no pass', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    const c = await sh(f.src, `git rev-parse refs/land/verified/${refSha}`);
    const record = await sh(f.src, `git notes --ref=refs/notes/land-pass show ${c}`);
    await sh(f.src, `git notes --ref=refs/notes/land-pass remove ${c}`);
    expect(await land(f.deps, STRICT, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/no pass record for/);
    const file = join(f.root, 'other.json');
    writeFileSync(file, record.replace(`"C": "${c}"`, `"C": "${'e'.repeat(40)}"`));
    await sh(f.src, `git notes --ref=refs/notes/land-pass add -f -F ${file} ${c}`);
    expect(await land(f.deps, STRICT, f.config())).toBe(EXIT.unverified);
  });

  test('a verified ref that names no commit (here a blob) is not a pass', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    const blob = await sh(f.src, 'echo not-a-commit | git hash-object -w --stdin');
    await sh(f.src, `git update-ref refs/land/verified/${refSha} ${blob}`);
    expect(await land(f.deps, STRICT, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/no pass record for/);
  });

  test('a forged record whose C does not descend from main is refused before any push', async () => {
    const f = await setup();
    const published = await f.mainTip();
    await f.commit(f.other, 'docs/adv.md');
    await sh(f.other, 'git push -q origin HEAD:main');
    // A sibling of main: same land files (it sits on the published config), not a descendant.
    await sh(f.src, `git checkout -q -B sib ${published}`);
    const x = await f.commit(f.src, 'crates/s.rs');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...VERIFY, ref: 'sib' }, f.config())).toBe(EXIT.ok);
    const c = await sh(f.src, `git rev-parse refs/land/verified/${x}`);
    const record = await sh(f.src, `git notes --ref=refs/notes/land-pass show ${c}`);
    const file = join(f.root, 'forged.json');
    // Claim C is the sibling itself, with evidence for every gate its diff from main selects.
    const forged = record
      .replace(`"C": "${c}"`, `"C": "${x}"`)
      .replace('"passed": [', '"passed": [\n    "doc-validator",');
    writeFileSync(file, forged);
    await sh(f.src, `git notes --ref=refs/notes/land-pass add -f -F ${file} ${x}`);
    await sh(f.src, `git update-ref refs/land/verified/${x} ${x}`);
    const before = await f.mainTip();
    expect(await land(f.deps, { ...STRICT, ref: 'sib' }, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/the verified commit \w+ does not descend from main/);
    expect(await f.mainTip()).toBe(before);
  });
});

describe('land from a pass: lease, worktree guard and hooks', () => {
  test('a landing worktree in use refuses, and the lease is released', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    f.deps.lock.createExclusive(join(await stateDir(f), 'worktree.lock'), holder('x'));
    expect(await land(f.deps, STRICT, f.config())).toBe(EXIT.busy);
    expect(f.errors.join('\n')).toMatch(/refusing a second land on it/);
    expect(f.deps.lock.read(f.deps.lock.lockPath)).toBeNull();
  });

  test.each([
    ['noop', /no pre-push hook is installed .* after installing it/],
    ['noexec', /is not executable, so git would skip it after installing it/],
    ['norunner', /does not invoke the hook runner \(fake-lefthook\) after installing it/],
  ])('an install that leaves a bad hook (%s) refuses the push', async (mode, message) => {
    const f = await setup();
    const before = await f.mainTip();
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    rmSync(join(f.src, '.git/hooks/pre-push'));
    f.env.FAKE_INSTALL_MODE = mode;
    expect(await land(f.deps, STRICT, f.config())).toBe(EXIT.push);
    expect(f.errors.join('\n')).toMatch(message);
    expect(await f.mainTip()).toBe(before);
  });

  test("a runner that cannot install at first is provisioned with main's bootstrap, then lands", async () => {
    const bootstrap = { run: 'echo boot >> "$FAKE_STATE/land-boot.log"' };
    const f = await setup({ bootstrap });
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config({ bootstrap }))).toBe(EXIT.ok);
    const boots = readFileSync(join(f.state, 'land-boot.log'), 'utf8').split('\n').length;
    writeFileSync(join(f.state, 'install-fail-once'), '');
    expect(await land(f.deps, STRICT, f.config({ bootstrap }))).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(refSha);
    expect(readFileSync(join(f.state, 'land-boot.log'), 'utf8').split('\n')).toHaveLength(
      boots + 1,
    );
  });

  test('a contended lease re-fetches; nobody else landed, so this run lands', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    contend(f, () => undefined);
    expect(await land(f.deps, { ...STRICT, waitSeconds: 60 }, f.config())).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(refSha);
    expect((await lastRun(f)).steps.map((s) => s.name)).toContain('fetch');
  });

  test('a contended lease that finds main moved elsewhere is stale', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    contend(f, async () => {
      await f.commit(f.other, 'docs/meanwhile.md');
      await sh(f.other, 'git push -q origin HEAD:main');
    });
    expect(await land(f.deps, { ...STRICT, waitSeconds: 60 }, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/main moved while waiting for the lease/);
  });
});

describe('land from a pass: how the outcome is observed', () => {
  test('remote already at C when the push starts: porcelain "up to date" is already landed, no fetch', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    const run = f.deps.run;
    f.deps.run = async (command, args, options) => {
      if (command === 'git' && args.includes('--porcelain') && args.includes('push')) {
        await sh(f.root, `git --git-dir=origin.git fetch -q ${f.src} ${refSha}:refs/heads/main`);
      }
      return run(command, args, options);
    };
    expect(await land(f.deps, STRICT, f.config())).toBe(EXIT.ok);
    expect(f.logs.join('\n')).toMatch(/already landed: .* already had .*this push moved nothing/);
    expect(await lastRun(f)).toMatchObject({ confirm: 'porcelain' });
  });

  test.each([
    ['noise-dup', /^LANDED /m],
    ['noise-eq', /already landed: .* contains .* this push moved nothing \(exit status 0/],
  ])('an ambiguous porcelain report (%s) is confirmed by a fetch', async (mode, message) => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    f.env.FAKE_HOOK = mode;
    expect(await land(f.deps, STRICT, f.config())).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(refSha);
    expect(f.logs.join('\n')).toMatch(message);
    expect(await lastRun(f)).toMatchObject({ confirm: 'fetched' });
  });
});

describe('review pass 1: guards on every push, lefthook overrides, apply mode', () => {
  test('a runner that cannot install the hook refuses verify, the dry run and the full land', async () => {
    const f = await setup();
    const before = await f.mainTip();
    await branch(f, 'crates/x.rs');
    f.env.FAKE_INSTALL_FAIL = '1';
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.push);
    expect(await land(f.deps, { ...OPTS, dryRun: true }, f.config())).toBe(EXIT.push);
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.push);
    expect(f.errors.join('\n').match(/could not install the pre-push hook/g)).toHaveLength(3);
    expect(await f.mainTip()).toBe(before);
  });

  test('a removed hook is reinstalled before verify, the dry run and the full land, and its guard refusal stands', async () => {
    const f = await setup();
    const before = await f.mainTip();
    const refSha = await branch(f, 'crates/x.rs');
    f.env.FAKE_HOOK = 'refuse';
    const hook = join(f.src, '.git/hooks/pre-push');
    rmSync(hook);
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.gate);
    await expect(
      sh(f.src, `git rev-parse --verify refs/land/verified/${refSha}`),
    ).rejects.toThrow();
    rmSync(hook);
    expect(await land(f.deps, { ...OPTS, dryRun: true }, f.config())).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/pre-push guards refused the dry run/);
    rmSync(hook);
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.push);
    expect(await f.mainTip()).toBe(before);
  });

  test('a candidate that adds lefthook-local.yml (which could replace a gate) never lands from a pass', async () => {
    const f = await setup();
    const before = await f.mainTip();
    await branch(f, 'lefthook-local.yml');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.gate); // the override is in the slot
    expect(f.errors.join('\n')).toMatch(
      /lefthook-local.yml in .* overrides the committed lefthook config/,
    );
    expect(await land(f.deps, STRICT, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/no pass record for/);
    expect(await f.mainTip()).toBe(before);
  });

  test('a failing lefthook dump records no pass', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    f.env.FAKE_DUMP_FAIL = '1';
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/no pass recorded: lefthook dump failed \(exit status 1\)/);
  });

  test('main using remotes gives no pass, even when the candidate drops them', async () => {
    const f = await fixture();
    writeFileSync(join(f.src, 'lefthook.yml'), '# REMOTES\n');
    await sh(f.src, 'git add lefthook.yml && git commit -qm hooks && git push -q origin HEAD:main');
    await sh(f.other, 'git pull -q origin main');
    await f.publishConfig();
    await sh(f.src, 'git checkout -q -B feat main');
    writeFileSync(join(f.src, 'lefthook.yml'), '# plain\n');
    await sh(f.src, 'git commit -qam "drop remotes"');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/no pass recorded: the lefthook config uses remotes/);
  });

  test('a dump that is not JSON, or that changes between verify and land, gives no fast land', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    f.env.FAKE_DUMP = 'not json';
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/no pass recorded: lefthook dump did not print JSON/);
    f.env.FAKE_DUMP = undefined;
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    f.env.FAKE_DUMP = '{"config":"another machine"}';
    expect(await land(f.deps, STRICT, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(
      /the effective lefthook config here .* is not the one verified/,
    );
    f.env.FAKE_DUMP = '{"remotes":[{"git_url":"u"}]}';
    expect(await land(f.deps, STRICT, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/uses remotes, whose fetched rules a pass cannot bind/);
    expect(await f.mainTip()).not.toBe(refSha);
  });

  test('an ignored lefthook-local.yml left in the verification worktree refuses verify', async () => {
    const f = await setup();
    await f.commit(f.src, '.gitignore', 'lefthook-local.yml\n');
    await sh(f.src, 'git push -q origin HEAD:main');
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok); // creates verify slot 1
    writeFileSync(
      join(await stateDir(f), 'verify', '1', 'worktree', 'lefthook-local.yml'),
      'x: 1\n',
    );
    await sh(f.src, `git update-ref -d refs/land/verified/${refSha}`);
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(
      /lefthook-local.yml in .*verify\/1\/worktree overrides the committed lefthook config/,
    );
    await expect(
      sh(f.src, `git rev-parse --verify refs/land/verified/${refSha}`),
    ).rejects.toThrow();
  });

  test('an ignored lefthook-local.yml left in the push checkout refuses the land', async () => {
    const f = await setup();
    await f.commit(f.src, '.gitignore', 'lefthook-local.yml\n');
    await sh(f.src, 'git push -q origin HEAD:main');
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, { ...OPTS, dryRun: true }, f.config())).toBe(EXIT.ok); // creates it
    writeFileSync(join(await stateDir(f), 'worktree', 'lefthook-local.yml'), 'x: 1\n');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    const before = await f.mainTip();
    expect(await land(f.deps, STRICT, f.config())).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/lefthook-local.yml in .*\/worktree overrides/);
    expect(await f.mainTip()).toBe(before);
  });

  test('--mode ff-only after a cherry-picked verify does not land the cherry-pick', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    await f.commit(f.other, 'docs/adv.md');
    await sh(f.other, 'git push -q origin HEAD:main');
    const moved = await f.mainTip();
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok); // auto: a cherry-pick
    const ffOnly = { ...OPTS, mode: 'ff-only' as const };
    expect(await land(f.deps, { ...ffOnly, requirePass: true }, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(
      /verified with --mode auto; this land asks for --mode ff-only/,
    );
    // Without --require-pass the full land runs ff-only, which cannot apply a diverged ref.
    expect(await land(f.deps, ffOnly, f.config())).toBe(EXIT.gate);
    expect(await f.mainTip()).toBe(moved);
  });

  test('--mode merge --message binds into the pass: the same request lands it, another is stale', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    await f.commit(f.other, 'docs/adv.md');
    await sh(f.other, 'git push -q origin HEAD:main');
    const merge = { ...OPTS, mode: 'merge' as const, message: 'merge it' };
    expect(await land(f.deps, { ...merge, verify: true }, f.config())).toBe(EXIT.ok);
    const other = { ...merge, message: 'something else', requirePass: true };
    expect(await land(f.deps, other, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/--message "merge it"; this land asks for/);
    expect(await land(f.deps, { ...merge, requirePass: true }, f.config())).toBe(EXIT.ok);
    expect(await sh(f.root, 'git --git-dir=origin.git log -1 --format=%s main')).toBe('merge it');
  });

  test('ambient LEFTHOOK, LEFTHOOK_CONFIG and LEFTHOOK_BIN cannot switch off the real guards', async () => {
    const f = await fixture();
    const bin = join(process.cwd(), 'node_modules', '.bin');
    const real = join(bin, 'lefthook');
    writeFileSync(
      join(f.src, 'lefthook.yml'),
      'pre-push:\n  commands:\n    real-guard:\n      run: echo ran >> "$FAKE_STATE/real-guard.log"\n',
    );
    writeFileSync(
      join(f.root, 'alt.yml'),
      'pre-push:\n  commands:\n    real-guard:\n      run: "true"\n',
    );
    await sh(f.src, 'git add lefthook.yml && git commit -qm hooks && git push -q origin HEAD:main');
    await sh(f.other, 'git pull -q origin main');
    await f.publishConfig({ lefthook: real, gates: [] });
    const refSha = await branch(f, 'crates/x.rs');
    f.env.PATH = `${bin}:${f.env.PATH ?? ''}`;
    f.env.LEFTHOOK = '0';
    f.env.LEFTHOOK_CONFIG = join(f.root, 'alt.yml');
    f.env.LEFTHOOK_BIN = '/usr/bin/true';
    const config = f.config({ lefthook: real, gates: [] });
    expect(await land(f.deps, VERIFY, config)).toBe(EXIT.ok);
    expect(await land(f.deps, STRICT, config)).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(refSha);
    // The real guard ran on the verify dry run and on the real push.
    expect(readFileSync(join(f.state, 'real-guard.log'), 'utf8').trim().split('\n')).toEqual([
      'ran',
      'ran',
    ]);
  });
});

describe('review pass 2: the effective lefthook config, through the real runner', () => {
  const bin = join(process.cwd(), 'node_modules', '.bin');
  const real = join(bin, 'lefthook');

  /** Main carries `files` (lefthook configs) and a land config that runs the real lefthook. */
  async function realRunner(files: Record<string, string>): Promise<Fixture> {
    const f = await fixture();
    for (const [path, text] of Object.entries(files)) {
      await sh(f.src, `mkdir -p "$(dirname ${path})"`);
      writeFileSync(join(f.src, path), text);
    }
    await sh(f.src, 'git add -A && git commit -qm hooks && git push -q origin HEAD:main');
    await sh(f.other, 'git pull -q origin main');
    await f.publishConfig({ lefthook: real, gates: [] });
    f.env.PATH = `${bin}:${f.env.PATH ?? ''}`;
    return f;
  }

  const config = (f: Fixture) => f.config({ lefthook: real, gates: [] });

  test.each([
    [
      'JSON {"extends": [...]}',
      'lefthook.json',
      '{"extends":["hooks/extra.json"],"pre-push":{"commands":{"main-guard":{"run":"true"}}}}\n',
      'hooks/extra.json',
      '{"pre-push":{"commands":{"extra-guard":{"run":"echo guarded"}}}}\n',
      '{"pre-push":{"commands":{"extra-guard":{"run":"true"}}}}\n',
    ],
    [
      "YAML 'extends': [...]",
      'lefthook.yml',
      "'extends': ['hooks/extra.yml']\npre-push:\n  commands:\n    main-guard:\n      run: 'true'\n",
      'hooks/extra.yml',
      'pre-push:\n  commands:\n    extra-guard:\n      run: echo guarded\n',
      "pre-push:\n  commands:\n    extra-guard:\n      run: 'true'\n",
    ],
  ])(
    'a candidate that weakens an %s file gets no pass',
    async (_n, cfg, cfgText, extra, before, after) => {
      const f = await realRunner({ [cfg]: cfgText, [extra]: before });
      await sh(f.src, 'git checkout -q -B feat main');
      writeFileSync(join(f.src, extra), after);
      await sh(f.src, 'git commit -qam "weaken the extended guard"');
      const refSha = await sh(f.src, 'git rev-parse HEAD');
      await sh(f.src, 'git checkout -q main');
      expect(await land(f.deps, VERIFY, config(f))).toBe(EXIT.unverified);
      expect(f.errors.join('\n')).toMatch(
        /no pass recorded: the ref changes the effective lefthook config \(lefthook dump or its script dirs differ/,
      );
      await expect(
        sh(f.src, `git rev-parse --verify refs/land/verified/${refSha}`),
      ).rejects.toThrow();
    },
  );

  test('a main lefthook.toml with [[remotes]] gets no pass', async () => {
    const f = await realRunner({
      'lefthook.toml':
        '[[remotes]]\ngit_url = "file:///nonexistent/remote.git"\nref = "main"\nconfigs = ["lefthook.yml"]\n\n[pre-push.commands.main-guard]\nrun = "true"\n',
    });
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, config(f))).not.toBe(EXIT.ok);
    expect(f.errors.join('\n')).toMatch(/remotes|could not install/);
    await expect(
      sh(f.src, `git rev-parse --verify refs/land/verified/${refSha}`),
    ).rejects.toThrow();
  });

  test('an unchanged effective config (extends included) lands from the pass', async () => {
    const f = await realRunner({
      'lefthook.json': '{"extends":["hooks/extra.json"]}\n',
      'hooks/extra.json':
        '{"pre-push":{"commands":{"extra-guard":{"run":"echo guarded >> \\"$FAKE_STATE/extra.log\\""}}}}\n',
    });
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, config(f))).toBe(EXIT.ok);
    expect(await land(f.deps, STRICT, config(f))).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(refSha);
    // The extended guard ran on the verify dry run and on the real push.
    expect(readFileSync(join(f.state, 'extra.log'), 'utf8').trim().split('\n')).toHaveLength(2);
  });
});

describe('review pass 3: script dirs and overrides written by provisioning', () => {
  test('a candidate that replaces a source_dir script (named through extends) with exit 0 gets no pass', async () => {
    const bin = join(process.cwd(), 'node_modules', '.bin');
    const real = join(bin, 'lefthook');
    const f = await fixture();
    const files: Record<string, string> = {
      'lefthook.yml': 'extends:\n  - hooks/base.yml\n',
      'hooks/base.yml':
        'source_dir: hook-scripts\npre-push:\n  scripts:\n    guard.sh:\n      runner: sh\n',
      'hook-scripts/pre-push/guard.sh': 'echo guarded >> "$FAKE_STATE/script.log"\n',
    };
    for (const [path, text] of Object.entries(files)) {
      await sh(f.src, `mkdir -p "$(dirname ${path})"`);
      writeFileSync(join(f.src, path), text);
    }
    await sh(f.src, 'git add -A && git commit -qm hooks && git push -q origin HEAD:main');
    await sh(f.other, 'git pull -q origin main');
    await f.publishConfig({ lefthook: real, gates: [] });
    f.env.PATH = `${bin}:${f.env.PATH ?? ''}`;
    await sh(f.src, 'git checkout -q -B feat main');
    writeFileSync(join(f.src, 'hook-scripts/pre-push/guard.sh'), 'exit 0\n');
    await sh(f.src, 'git commit -qam "the guard script does nothing"');
    const refSha = await sh(f.src, 'git rev-parse HEAD');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, VERIFY, f.config({ lefthook: real, gates: [] }))).toBe(
      EXIT.unverified,
    );
    expect(f.errors.join('\n')).toMatch(/script dirs differ between main and the verified commit/);
    await expect(
      sh(f.src, `git rev-parse --verify refs/land/verified/${refSha}`),
    ).rejects.toThrow();
  });

  test('a source_dir outside the repository gets no pass', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    f.env.FAKE_DUMP = '{"source_dir":"/tmp/elsewhere"}';
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/source_dir lies outside the repository/);
  });

  test('an existing local script dir gets no pass', async () => {
    const f = await setup();
    await f.commit(f.src, 'my-local/pre-push/x.sh', 'exit 0\n');
    await sh(f.src, 'git push -q origin HEAD:main');
    await branch(f, 'crates/x.rs');
    f.env.FAKE_DUMP = '{"source_dir_local":"my-local"}';
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/the local lefthook script dir my-local exists here/);
  });

  test('an ignored file in the script dir of the verification worktree gets no pass', async () => {
    const f = await setup();
    await f.commit(f.src, '.lefthook/pre-push/guard.sh', 'echo ok\n');
    await f.commit(f.src, '.gitignore', '.lefthook/pre-push/extra.sh\n');
    await sh(f.src, 'git push -q origin HEAD:main');
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok); // creates verify slot 1
    await sh(f.src, `git update-ref -d refs/land/verified/${refSha}`);
    writeFileSync(
      join(await stateDir(f), 'verify', '1', 'worktree', '.lefthook', 'pre-push', 'extra.sh'),
      'exit 0\n',
    );
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/script dir .lefthook holds files that are not committed/);
  });

  test('a bootstrap that writes lefthook-local.yml in the verification worktree refuses verify', async () => {
    const bootstrap = { run: 'touch lefthook-local.yml' };
    const f = await setup({ bootstrap });
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config({ bootstrap }))).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/lefthook-local.yml in .*verify\/1\/worktree overrides/);
  });

  test('a provisioning bootstrap that writes lefthook-local.yml in the push checkout refuses the land', async () => {
    const bootstrap = {
      run: 'if [ -f "$FAKE_STATE/boot-override" ]; then touch lefthook-local.yml; fi',
    };
    const f = await setup({ bootstrap });
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config({ bootstrap }))).toBe(EXIT.ok);
    writeFileSync(join(f.state, 'boot-override'), '');
    writeFileSync(join(f.state, 'install-fail-once'), '');
    const before = await f.mainTip();
    expect(await land(f.deps, STRICT, f.config({ bootstrap }))).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/lefthook-local.yml in .*\/worktree overrides/);
    expect(await f.mainTip()).toBe(before);
  });
});

describe('review pass 4: symlinks in hook script dirs', () => {
  test('a candidate whose script dir holds a symlink to a file it changes gets no pass', async () => {
    const f = await setup();
    await sh(f.src, 'git checkout -q -B feat main');
    await sh(f.src, 'mkdir -p .lefthook/pre-push scripts');
    writeFileSync(join(f.src, 'scripts/guard-body.sh'), 'exit 0\n');
    await sh(f.src, 'ln -s ../../scripts/guard-body.sh .lefthook/pre-push/guard.sh');
    await sh(f.src, 'git add -A && git commit -qm "guard script is a symlink"');
    const refSha = await sh(f.src, 'git rev-parse HEAD');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(
      /no pass recorded: a lefthook script dir holds or sits under a symlink \(.lefthook\/pre-push\/guard.sh\)/,
    );
    await expect(
      sh(f.src, `git rev-parse --verify refs/land/verified/${refSha}`),
    ).rejects.toThrow();
  });
});

describe('review pass 5: symlinked ancestors and script dirs missing from the commit', () => {
  test('a source_dir reached through a symlinked ancestor (hooks -> scripts) gets no pass', async () => {
    const f = await setup();
    await sh(f.src, 'git checkout -q -B feat main');
    await sh(f.src, 'mkdir -p scripts/guards && ln -s scripts hooks');
    writeFileSync(join(f.src, 'scripts/guards/guard.sh'), 'exit 0\n');
    await sh(f.src, 'git add -A && git commit -qm "guards behind a symlinked dir"');
    const refSha = await sh(f.src, 'git rev-parse HEAD');
    await sh(f.src, 'git checkout -q main');
    f.env.FAKE_DUMP = '{"source_dir":"hooks/guards"}';
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(
      /no pass recorded: a lefthook script dir holds or sits under a symlink \(hooks\)/,
    );
    await expect(
      sh(f.src, `git rev-parse --verify refs/land/verified/${refSha}`),
    ).rejects.toThrow();
  });

  test('a configured script dir absent from the commit but present on disk gets no pass', async () => {
    const f = await setup();
    await f.commit(f.src, '.gitignore', 'guards/\n');
    await sh(f.src, 'git push -q origin HEAD:main');
    const refSha = await branch(f, 'crates/x.rs');
    f.env.FAKE_DUMP = '{"source_dir":"guards"}';
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok); // absent everywhere: fine
    await sh(f.src, `git update-ref -d refs/land/verified/${refSha}`);
    const slot = join(await stateDir(f), 'verify', '1', 'worktree');
    await sh(slot, 'mkdir -p guards/pre-push');
    writeFileSync(join(slot, 'guards/pre-push/guard.sh'), 'exit 0\n');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(
      /the lefthook script dir guards is not in the commit but exists on disk/,
    );
  });
});
