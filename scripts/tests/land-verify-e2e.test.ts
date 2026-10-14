import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import type { Ctx } from '../lib/land/core';
import { EXIT, land } from '../lib/land/engine';
import { type PassRecord, parsePass } from '../lib/land/pass';
import { writePassNote } from '../lib/land/verified';
import { branch, type Fixture, fixture, OPTS, parseRun, sh } from './helpers/land-fixture';
import { memoryLock } from './helpers/memory-lock';

// drives verify and land against throwaway repos, like land-e2e.test.ts. The heaviest test (verify,
// a rejected fast land, then the full land) takes 3.1 s alone but starved past 150 s under
// taskpolicy -b at load ~30 (2026-10-13), so the allowance is 10 s idle (200 s).
vi.setConfig({ testTimeout: 200_000 });

const VERIFY = { ...OPTS, verify: true };

/** A fixture whose main carries land.config.json, as a real repo does: land reads the gate set from main. */
async function setup(extra: Record<string, unknown> = {}): Promise<Fixture> {
  const f = await fixture();
  await f.publishConfig(extra);
  return f;
}

async function note(f: Fixture, c: string): Promise<PassRecord> {
  const record = parsePass(await sh(f.src, `git notes --ref=refs/notes/land-pass show ${c}`));
  if (record === null) throw new Error(`no readable pass note on ${c}`);
  return record;
}

const verifiedC = async (f: Fixture, refSha: string, dir = f.src): Promise<string> =>
  sh(dir, `git rev-parse refs/land/verified/${refSha}`);

async function runs(f: Fixture): Promise<ReturnType<typeof parseRun>[]> {
  const dir = await sh(f.home, 'ls -d src-*');
  return readFileSync(join(f.home, dir, 'runs.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => parseRun(line));
}

/** Hold the landing lease as a live process (pid 100 is alive in the memory lock). */
function holdLease(f: Fixture): void {
  const holder = {
    pid: 100,
    bootId: 'boot1',
    startedAt: '2026-10-08T00:00:00Z',
    repo: 'r',
    ref: 'x',
    user: 'u',
  };
  f.deps.lock.createExclusive(f.deps.lock.lockPath, JSON.stringify(holder));
}

describe('just verify: gate on fresh main, record a pass, push nothing', () => {
  test('records the pass as a ref and a git note on C, without the lease, and pushes nothing', async () => {
    const f = await setup();
    const before = await f.mainTip();
    const refSha = await branch(f, 'crates/x.rs');
    holdLease(f); // a full land is running: verify must not need the lease
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(before);
    expect(f.ran()).toEqual(['run pre-push --force --job cov-rust --job adr']);
    const c = await verifiedC(f, refSha);
    expect(c).toBe(refSha); // fast-forward: C is the ref itself
    expect(await note(f, c)).toMatchObject({
      format: 3,
      mode: 'auto',
      message: null,
      ref_sha: refSha,
      C: c,
      B: before,
      passed: ['adr', 'cov-rust'],
      host: 'testhost',
      gates: [{ name: 'lefthook', seconds: 0, retried: false }],
    });
    expect(f.logs.join('\n')).toMatch(
      /verifying in .*verify\/1\/worktree .*the landing lease is not taken/,
    );
    expect(f.logs.join('\n')).toMatch(/VERIFIED .*Land it with: just land feat/);
    expect((await runs(f)).at(-1)).toMatchObject({ stage: 'verify', sha: c, exit: 0 });
  });

  test('a failed gate records no pass', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    f.env.FAKE_FAIL = 'cov-rust';
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.gate);
    await expect(verifiedC(f, refSha)).rejects.toThrow();
  });

  test('concurrent verifies take separate worktrees and both record passes', async () => {
    const f = await setup();
    f.deps.lock = memoryLock({ alive: new Set([process.pid, 100]) }).deps;
    const a = await branch(f, 'crates/a.rs');
    await sh(f.src, 'git checkout -q -B feat2 main');
    const b = await f.commit(f.src, 'crates/b.rs');
    await sh(f.src, 'git checkout -q main');
    const codes = await Promise.allSettled([
      land(f.deps, VERIFY, f.config()),
      land(f.deps, { ...VERIFY, ref: 'feat2' }, f.config()),
    ]);
    expect(codes).toEqual([
      { status: 'fulfilled', value: EXIT.ok },
      { status: 'fulfilled', value: EXIT.ok },
    ]);
    expect(await verifiedC(f, a)).toBe(a);
    expect(await verifiedC(f, b)).toBe(b);
    const slots = f.logs.filter((l) => l.startsWith('verifying in')).join('\n');
    expect(slots).toMatch(/verify\/1\/worktree/);
    expect(slots).toMatch(/verify\/2\/worktree/);
  });

  test('every slot busy refuses at once, naming the holders', async () => {
    const f = await setup();
    f.deps.lock = memoryLock({ alive: new Set([process.pid, 100]) }).deps;
    await branch(f, 'crates/x.rs');
    const config = f.config({ verifySlots: 1 });
    expect(await land(f.deps, VERIFY, config)).toBe(EXIT.ok); // creates the state dir
    const state = join(f.home, await sh(f.home, 'ls -d src-*'));
    const holder = {
      pid: 100,
      bootId: 'boot1',
      startedAt: '2026-10-08T00:00:00Z',
      repo: 'r',
      ref: 'other',
      user: 'u',
    };
    f.deps.lock.createExclusive(
      join(state, 'verify', '1', 'worktree.lock'),
      JSON.stringify(holder),
    );
    expect(await land(f.deps, VERIFY, config)).toBe(EXIT.busy);
    expect(f.errors.join('\n')).toMatch(
      /all 1 verification worktrees are busy[^\n]*\n.*landing other/,
    );
  });
});

describe('just land from a pass', () => {
  test('verify then land: pushes exactly C with a CAS on B, guards run, no gate re-runs', async () => {
    const f = await setup();
    const base = await f.mainTip();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    const gateRuns = f.ran().length;
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(refSha);
    expect(f.ran()).toHaveLength(gateRuns); // no gates in land
    const push = f.hookSeen().at(-1) ?? '';
    expect(push).toContain(`marker=${refSha}`);
    expect(push).toContain('exclude=adr,cov-rust,cov-ts,doc-validator ');
    expect(push).toContain(`${refSha} refs/heads/main ${base}`);
    expect(f.logs.join('\n')).toMatch(/LANDED .* \(from pass record, no gates re-run\)/);
    const receipt = (await runs(f)).at(-1);
    expect(receipt).toMatchObject({
      stage: 'land',
      sha: refSha,
      exit: 0,
      sampleEnd: null,
      confirm: 'porcelain', // a clean porcelain "pushed" report needs no confirm fetch
    });
    expect(receipt?.steps.map((s) => s.name)).toEqual([
      'lease',
      'checkout',
      'guards',
      'hooks',
      'push',
    ]);
  });

  test('a signal-killed push never trusts porcelain: it fetches to confirm', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    await sh(f.state, 'rm -f hook-count');
    f.env.FAKE_HOOK = 'land-then-kill'; // the hook lands C itself, then kills the push
    expect(await land(f.deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(refSha);
    expect(f.logs.join('\n')).toMatch(
      /already landed: .* contains .* this push moved nothing \(killed by SIGKILL/,
    );
    const receipt = (await runs(f)).at(-1);
    expect(receipt).toMatchObject({ stage: 'land', exit: 0, confirm: 'fetched' });
    expect(receipt?.steps.map((s) => s.name)).toEqual([
      'lease',
      'checkout',
      'guards',
      'hooks',
      'push',
      'confirm',
    ]);
  });

  test('a push killed before it landed fetches, finds C absent, and fails', async () => {
    const f = await setup();
    const before = await f.mainTip();
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    await sh(f.state, 'rm -f hook-count');
    f.env.FAKE_HOOK = 'kill-first';
    expect(await land(f.deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.push);
    expect(f.errors.join('\n')).toMatch(/push failed \(killed by SIGKILL\)/);
    expect(await f.mainTip()).toBe(before);
    expect((await runs(f)).at(-1)).toMatchObject({ confirm: 'fetched' });
  });

  test('a cherry-picked verification lands the verified commit C, not the ref', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    await f.commit(f.other, 'docs/adv.md');
    await sh(f.other, 'git push -q origin HEAD:main');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    const c = await verifiedC(f, refSha);
    expect(c).not.toBe(refSha);
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(c);
  });

  test('landing again reports already landed and pushes nothing', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    const hooks = f.hookSeen().length;
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.hookSeen()).toHaveLength(hooks);
    expect(f.logs.join('\n')).toMatch(/already landed: .* nothing pushed/);
  });

  test('main moved since verify: says why, then falls back to the full land', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    await f.commit(f.other, 'docs/adv.md');
    await sh(f.other, 'git push -q origin HEAD:main');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.logs.join('\n')).toMatch(
      /not verified on current main: main moved since verify .*; run just verify feat\. Falling back to the full gated land\./,
    );
    expect(f.logs.join('\n')).toMatch(/cherry-picking 1 commit/);
    expect((await runs(f)).at(-1)).toMatchObject({ stage: 'full', exit: 0 });
  });

  test('--require-pass refuses instead of falling back (no pass, stale pass)', async () => {
    const f = await setup();
    const before = await f.mainTip();
    await branch(f, 'crates/x.rs');
    const strict = { ...OPTS, requirePass: true };
    expect(await land(f.deps, strict, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(
      /not verified on current main: no pass record for .*--require-pass/,
    );
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    await f.commit(f.other, 'docs/adv.md');
    await sh(f.other, 'git push -q origin HEAD:main');
    expect(await land(f.deps, strict, f.config())).toBe(EXIT.unverified);
    expect(await f.mainTip()).not.toBe(before); // only the other clone's push
    expect(f.ran()).toHaveLength(1); // the verify's gates; no full land ran
  });

  test('a land config change since verify is stale', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    const c = await verifiedC(f, refSha);
    const record = { ...(await note(f, c)), config_key: 'from-another-config' };
    const file = join(f.root, 'pass.json');
    writeFileSync(file, JSON.stringify(record));
    await sh(f.src, `git notes --ref=refs/notes/land-pass add -f -F ${file} ${c}`);
    expect(await land(f.deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/land config changed since verify/);
  });

  test('main moving between fetch and push: the CAS rejects, nothing lands from the stale pass', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    await sh(f.state, 'rm -f hook-count');
    f.env.FAKE_HOOK = 'move-main'; // the push's own pre-push hook moves main first
    expect(await land(f.deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(
      /main moved before the push \(compare-and-swap on .* rejected/,
    );
    expect(
      await sh(
        f.root,
        `git --git-dir=origin.git merge-base --is-ancestor ${refSha} main || echo no`,
      ),
    ).toBe('no');
  });

  test('a CAS rejection without --require-pass falls back to the full land, which lands', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    await sh(f.state, 'rm -f hook-count');
    f.env.FAKE_HOOK = 'move-main';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.logs.join('\n')).toMatch(
      /compare-and-swap .* rejected.*Falling back to the full gated land/,
    );
    expect(f.logs.join('\n')).toMatch(/^LANDED /m);
  });

  test('--pass-from lands from a pass verified in another clone', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    const lander = join(f.root, 'lander');
    await sh(f.root, `git clone -q origin.git lander 2>/dev/null`);
    await sh(lander, `git remote add verifier ${f.src} && git fetch -q verifier feat:feat`);
    writeFileSync(
      join(lander, '.git/hooks/pre-push'),
      readFileSync(join(f.src, '.git/hooks/pre-push')),
    );
    chmodSync(join(lander, '.git/hooks/pre-push'), 0o755);
    const deps = { ...f.deps, cwd: lander };
    // No local pass in the lander: a plain --require-pass refuses.
    expect(await land(deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.unverified);
    const gateRuns = f.ran().length;
    expect(await land(deps, { ...OPTS, requirePass: true, passFrom: 'verifier' }, f.config())).toBe(
      EXIT.ok,
    );
    expect(await f.mainTip()).toBe(refSha);
    expect(f.ran()).toHaveLength(gateRuns);
    expect(await sh(lander, `git rev-parse refs/land/pass-from/verifier/verified/${refSha}`)).toBe(
      refSha,
    );
  });

  test('--pass-from an unreachable remote fails loudly', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    await sh(f.src, `git remote add nowhere ${join(f.root, 'gone.git')}`);
    expect(await land(f.deps, { ...OPTS, passFrom: 'nowhere' }, f.config())).toBe(EXIT.push);
    expect(f.errors.join('\n')).toMatch(/could not fetch pass records from nowhere/);
  });
});

describe('a pass binds to what actually ran, and land fails closed (review round 1)', () => {
  test('verify refuses under a weakened local config; the restored config then has no pass to land', async () => {
    const f = await setup();
    await branch(f, 'crates/x.rs');
    // Weaken the invoking checkout: drop the unconditional gate, uncommitted.
    const gates = [
      { name: 'cov-rust', when: ['rust'] },
      { name: 'cov-ts', when: ['ts'] },
      { name: 'doc-validator', when: ['docs'] },
    ];
    writeFileSync(join(f.src, 'land.config.json'), JSON.stringify({ gates }));
    const weak = f.config({ gates });
    expect(await land(f.deps, VERIFY, weak)).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/land config or engine .* differs from origin\/main/);
    expect(f.ran()).toEqual([]); // refused before any gate
    await sh(f.src, 'git checkout -- land.config.json');
    expect(await land(f.deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/no pass record/);
  });

  test('a record whose engine_version is not main is refused', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    const c = await verifiedC(f, refSha);
    await rewriteNote(f, c, { engine_version: 'a-weaker-engine' });
    expect(await land(f.deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(
      /engine and config that ran the verification are not main's/,
    );
  });

  test('a record missing evidence for an applicable gate is refused; exclusions never come from the record', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    const c = await verifiedC(f, refSha);
    await rewriteNote(f, c, { passed: ['cov-rust'] });
    expect(await land(f.deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(/the pass has no evidence for: adr/);
    // An extra, unsupported exclusion field in the record changes nothing.
    await rewriteNote(f, c, {
      passed: ['adr', 'cov-rust'],
      lefthook_exclude: ['cov-ts', 'guard-main-push'],
    });
    expect(await land(f.deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.ok);
    expect(f.hookSeen().at(-1)).toContain('exclude=adr,cov-rust,cov-ts,doc-validator ');
  });

  test('a fresh clone with no pre-push hook gets one installed by the runner, and the guards run', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    const lander = join(f.root, 'bare-lander');
    await sh(f.root, 'git clone -q origin.git bare-lander 2>/dev/null');
    await sh(lander, `git remote add verifier ${f.src} && git fetch -q verifier feat:feat`);
    expect(await sh(lander, 'test -e .git/hooks/pre-push && echo hook || echo none')).toBe('none');
    const hooks = f.hookSeen().length;
    const deps = { ...f.deps, cwd: lander };
    expect(await land(deps, { ...OPTS, requirePass: true, passFrom: 'verifier' }, f.config())).toBe(
      EXIT.ok,
    );
    expect(await f.mainTip()).toBe(refSha);
    expect(f.hookSeen()).toHaveLength(hooks + 1); // the installed hook ran on the real push
    expect(f.hookSeen().at(-1)).toContain(`marker=${refSha}`);
  });

  test('a runner that cannot install the hook refuses the push (fail closed)', async () => {
    const f = await setup();
    const before = await f.mainTip();
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    f.env.FAKE_INSTALL_FAIL = '1';
    expect(await land(f.deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.push);
    expect(f.errors.join('\n')).toMatch(
      /could not install the pre-push hook .*the push guards would not run, refusing/,
    );
    expect(await f.mainTip()).toBe(before);
  });

  test("main's pushRequires governs the push even when the caller's config omits it; versioning-release-check can never be a gate", async () => {
    // Main requires a guard tool this machine lacks; the invoking config object does not list it.
    const f = await setup({ pushRequires: ['no-such-guard-tool'] });
    const before = await f.mainTip();
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    expect(await land(f.deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.push);
    expect(f.errors.join('\n')).toMatch(/push guard tool\(s\) not on PATH: no-such-guard-tool/);
    expect(await f.mainTip()).toBe(before);
    expect(() => f.config({ gates: [{ name: 'versioning-release-check' }] })).toThrow(
      /is a guard and may never be skipped/,
    );
  });

  test('a weakened local land config (pushRequires dropped) cannot ride a valid pass', async () => {
    const f = await setup({ pushRequires: ['sh'] });
    const before = await f.mainTip();
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config({ pushRequires: ['sh'] }))).toBe(EXIT.ok);
    writeFileSync(join(f.src, 'land.config.json'), JSON.stringify({ pushRequires: [] }));
    expect(await land(f.deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.unverified);
    expect(f.errors.join('\n')).toMatch(
      /not verified on current main: this checkout's land config or engine differs from main's/,
    );
    expect(await f.mainTip()).toBe(before);
  });

  test('a non-executable pre-push hook is reinstalled before the push, and the guards run', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    chmodSync(join(f.src, '.git/hooks/pre-push'), 0o644);
    const hooks = f.hookSeen().length;
    expect(await land(f.deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.ok);
    expect(f.hookSeen()).toHaveLength(hooks + 1);
    expect(f.hookSeen().at(-1)).toContain(`marker=${refSha}`);
  });

  test('a stub hook that only names the runner in a comment is replaced, and the guards actually run', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    // Passes any content inspection: executable, mentions the runner, runs nothing.
    const stub = join(f.src, '.git/hooks/pre-push');
    writeFileSync(stub, '#!/bin/sh\n# fake-lefthook\nexit 0\n');
    chmodSync(stub, 0o755);
    const hooks = f.hookSeen().length;
    expect(await land(f.deps, { ...OPTS, requirePass: true }, f.config())).toBe(EXIT.ok);
    expect(readFileSync(stub, 'utf8')).toBe(readFileSync(join(f.root, 'hook-template'), 'utf8'));
    expect(f.hookSeen()).toHaveLength(hooks + 1); // the guard hook ran on the real push
    expect(f.hookSeen().at(-1)).toContain(`marker=${refSha}`);
    expect(readFileSync(join(f.state, 'install.log'), 'utf8')).toContain('install pre-push');
  });

  test('verify runs cwd: source steps from a clean checkout of B, not the edited invoking checkout', async () => {
    const probe = {
      name: 'src-probe',
      run: 'sh probe.sh {source}',
      cwd: 'source',
    };
    const f = await fixture();
    writeFileSync(
      join(f.src, 'probe.sh'),
      'echo "B-version $(pwd) $1" > "$FAKE_STATE/probe.log"\n',
    );
    await sh(f.src, 'git add probe.sh && git commit -qm probe && git push -q origin HEAD:main');
    const base = await f.publishConfig({
      checks: [probe],
      earlyChecks: [{ ...probe, name: 'early-probe' }],
    });
    await branch(f, 'crates/x.rs');
    // A local, uncommitted edit that would make the check pass vacuously.
    writeFileSync(join(f.src, 'probe.sh'), 'echo LOCAL > "$FAKE_STATE/probe.log"\n');
    const config = f.config({ checks: [probe], earlyChecks: [{ ...probe, name: 'early-probe' }] });
    expect(await land(f.deps, VERIFY, config)).toBe(EXIT.ok);
    const seen = readFileSync(join(f.state, 'probe.log'), 'utf8').trim();
    expect(seen).toMatch(/^B-version \S+\/verify\/1\/source \S+\/verify\/1\/source$/);
    const dir = seen.split(' ')[1] ?? '';
    expect(await sh(dir, 'git rev-parse HEAD')).toBe(base);
    expect(await sh(dir, 'git status --porcelain')).toBe('');
  });

  test('overlapping note writes all survive (compare-and-swap on the notes ref)', async () => {
    const f = await setup();
    const commits: string[] = [];
    for (const n of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']) {
      commits.push(await f.commit(f.src, `${n}.txt`));
    }
    const ctx = {
      deps: f.deps,
      config: f.config(),
      options: OPTS,
      sourceRoot: f.src,
      receipt: { steps: [] },
    } as unknown as Ctx;
    const writes = await Promise.allSettled(
      commits.map((c) => writePassNote(ctx, c, `note for ${c}\n`)),
    );
    expect(writes.map((w) => w.status)).toEqual(commits.map(() => 'fulfilled'));
    for (const c of commits) {
      expect(await sh(f.src, `git notes --ref=refs/notes/land-pass show ${c}`)).toBe(
        `note for ${c}`,
      );
    }
    expect(await sh(f.src, 'git for-each-ref refs/notes/land-pass-write')).toBe('');
  });

  test('another lander landing C while this one waits for the lease: "already landed", nothing pushed', async () => {
    const f = await setup();
    const refSha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, VERIFY, f.config())).toBe(EXIT.ok);
    const hooks = f.hookSeen().length;
    holdLease(f);
    const lock = f.deps.lock;
    let released = false;
    f.deps.lock = {
      ...lock,
      sleep: async (ms) => {
        if (!released) {
          // The other lander pushes C, then releases the lease.
          await sh(f.root, `git --git-dir=origin.git fetch -q ${f.src} ${refSha}:refs/heads/main`);
          lock.remove(lock.lockPath);
          released = true;
        }
        await lock.sleep(ms);
      },
    };
    expect(await land(f.deps, { ...OPTS, waitSeconds: 60 }, f.config())).toBe(EXIT.ok);
    expect(f.logs.join('\n')).toMatch(
      /already landed: .*another lander got there first.*nothing pushed/,
    );
    expect(f.logs.join('\n')).not.toMatch(/^LANDED /m);
    expect(f.hookSeen()).toHaveLength(hooks);
  });
});

async function rewriteNote(f: Fixture, c: string, change: Record<string, unknown>): Promise<void> {
  const file = join(f.root, `note-${c}.json`);
  writeFileSync(file, JSON.stringify({ ...(await note(f, c)), ...change }));
  await sh(f.src, `git notes --ref=refs/notes/land-pass add -f -F ${file} ${c}`);
}
