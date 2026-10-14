import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { EXIT, land } from '../lib/land/engine';
import { branch, fixture, OPTS, parseRun, sh } from './helpers/land-fixture';
import { memoryLock } from './helpers/memory-lock';

// drives the whole land engine against throwaway repos; slowest test about 7.5 s at load ~20 (full run, 2026-10-09).
vi.setConfig({ testTimeout: 120_000 });

describe('land engine end to end (real git, local bare origin)', () => {
  test('docs-only land runs only docs and unconditional gates, then pushes with exact-SHA exclusions', async () => {
    const f = await fixture();
    const sha = await branch(f, 'docs/note.md');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(sha);
    expect(f.ran()).toEqual(['run pre-push --force --job doc-validator --job adr']);
    const seen = f.hookSeen()[0] ?? '';
    expect(seen).toContain(`marker=${sha}`);
    // adr and doc-validator ran on this SHA; cov-rust and cov-ts are inapplicable to a docs-only diff
    expect(seen).toContain('exclude=adr,cov-rust,cov-ts,doc-validator ');
    expect(f.logs.some((l) => l.startsWith('LANDED'))).toBe(true);
    expect(f.logs.join('\n')).toMatch(
      /plan: scopes: docs; gates: doc-validator, adr; not applicable: cov-rust, cov-ts/,
    );
  });

  test('rust-only land runs rust and unconditional gates', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.ran()).toEqual(['run pre-push --force --job cov-rust --job adr']);
  });

  test('an unmapped path runs the full suite', async () => {
    const f = await fixture();
    await branch(f, 'mystery.bin');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.ran()).toEqual([
      'run pre-push --force --job cov-rust --job cov-ts --job doc-validator --job adr',
    ]);
    expect(f.hookSeen()[0]).toMatch(/exclude=adr,cov-rust,cov-ts,doc-validator /);
  });

  test('changing land.config.json or the engine runs the full suite', async () => {
    const f = await fixture();
    await branch(f, 'scripts/lib/land/engine.ts');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.ran()[0]).toContain('--job cov-rust --job cov-ts');
  });

  test('a failed gate stops before any push', async () => {
    const f = await fixture();
    const before = await f.mainTip();
    await branch(f, 'crates/x.rs');
    f.env.FAKE_FAIL = 'cov-rust';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.gate);
    expect(await f.mainTip()).toBe(before);
    expect(f.hookSeen()).toEqual([]);
    expect(f.errors.join('\n')).toMatch(/gates failed: exit status 1/);
  });

  test('exit 0 with a job missing from the summary is a failure, not a silent skip', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    f.env.FAKE_SKIP = 'cov-rust';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/not reported as passed: cov-rust/);
  });

  test('command gates, checks, bootstrap and preflight run with placeholders', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    const config = f.config({
      bootstrap: { run: 'echo boot >> "$FAKE_STATE/boot.log"', when: ['ts'] },
      preflight: [{ name: 'pre', run: 'echo {source} > "$FAKE_STATE/pre.log"', cwd: 'source' }],
      gates: [
        { name: 'cmd', run: 'echo gated >> "$FAKE_STATE/cmd.log"', when: ['rust'] },
        { name: 'skipme', run: 'false', when: ['ts'] },
      ],
      checks: [
        {
          name: 'chk',
          run: 'test "$(git rev-parse HEAD)" = {head} && git diff --exit-code {base} -- baseline.json',
        },
      ],
    });
    expect(await land(f.deps, OPTS, config)).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'cmd.log'), 'utf8')).toBe('gated\n');
    expect(readFileSync(join(f.state, 'boot.log'), 'utf8')).toBe('boot\n'); // first run bootstraps
    expect(f.ran()).toEqual([]); // no lefthook gates at all
    expect(f.hookSeen()[0]).toMatch(/exclude=\s/);
    // second land: bootstrap not repeated (ts untouched), persistent worktree reused
    await sh(f.src, 'git checkout -q -B feat2 main');
    await f.commit(f.src, 'crates/y.rs');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'feat2' }, config)).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'boot.log'), 'utf8')).toBe('boot\n');
    // --skip-bootstrap
    await sh(f.src, 'git checkout -q -B feat3 main');
    await f.commit(f.src, 'z/z.ts');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'feat3', bootstrap: false }, config)).toBe(EXIT.gate);
    expect(readFileSync(join(f.state, 'boot.log'), 'utf8')).toBe('boot\n');
  });

  test('lefthook jobs see this landing as a pre-push: ref line on stdin, remote and url as args', async () => {
    const f = await fixture();
    const base = await f.mainTip();
    const sha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'lefthook.stdin'), 'utf8')).toBe(
      `HEAD ${sha} refs/heads/main ${base}\n`,
    );
    expect(readFileSync(join(f.state, 'lefthook.log'), 'utf8').trim()).toMatch(
      / origin \S+origin\.git$/,
    );
  });

  test("cargoTargetDir is set for gates (with ~ expanded) and the caller's own is never inherited", async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    f.env.CARGO_TARGET_DIR = '/shared/target';
    const probe = {
      name: 'cargo',
      run: `echo "\${CARGO_TARGET_DIR-unset}" > "$FAKE_STATE/cargo.log"`,
    };
    expect(await land(f.deps, OPTS, f.config({ checks: [probe] }))).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'cargo.log'), 'utf8').trim()).toBe('unset');
    await sh(f.src, 'git checkout -q -B feat7 main');
    await f.commit(f.src, 'crates/z.rs');
    await sh(f.src, 'git checkout -q main');
    expect(
      await land(
        f.deps,
        { ...OPTS, ref: 'feat7' },
        f.config({ checks: [probe], cargoTargetDir: '~/warm' }),
      ),
    ).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'cargo.log'), 'utf8').trim()).toBe(join(f.root, 'warm'));
    await sh(f.src, 'git checkout -q -B feat8 main');
    await f.commit(f.src, 'crates/w.rs');
    await sh(f.src, 'git checkout -q main');
    expect(
      await land(
        f.deps,
        { ...OPTS, ref: 'feat8' },
        f.config({ checks: [probe], cargoTargetDir: '/abs/t' }),
      ),
    ).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'cargo.log'), 'utf8').trim()).toBe('/abs/t');
    // no HOME: a ~/ path degrades to a relative one rather than throwing
    await sh(f.src, 'git checkout -q -B feat9 main');
    await f.commit(f.src, 'crates/v.rs');
    await sh(f.src, 'git checkout -q main');
    f.env.HOME = undefined;
    expect(
      await land(
        f.deps,
        { ...OPTS, ref: 'feat9' },
        f.config({ checks: [probe], cargoTargetDir: '~/rel' }),
      ),
    ).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'cargo.log'), 'utf8').trim()).toBe('rel');
  });

  test('every run leaves a receipt for p50/p90: timings per step, wait, sha and exit', async () => {
    const f = await fixture();
    const sha = await branch(f, 'crates/x.rs');
    f.clock.t += 0;
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    f.env.FAKE_FAIL = 'cov-rust';
    await sh(f.src, 'git checkout -q -B feat10 main');
    await f.commit(f.src, 'crates/q2.rs');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'feat10', dryRun: true }, f.config())).toBe(
      EXIT.gate,
    );
    const state = join(f.home, readdirSync(f.home).find((d) => d.startsWith('src-')) ?? '');
    const lines = readFileSync(join(state, 'runs.jsonl'), 'utf8').trim().split('\n');
    const runs = lines.map((line) => parseRun(line));
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ ref: 'feat', sha, exit: 0, dryRun: false, waitedSeconds: 0 });
    expect(runs[0]?.steps.map((step) => step.name)).toEqual(['lefthook']);
    expect(runs[1]).toMatchObject({ ref: 'feat10', exit: 1, dryRun: true });
    expect(runs[1]?.steps[0]).toMatchObject({ name: 'lefthook', ok: false });
    expect(typeof runs[0]?.totalSeconds).toBe('number');
  });

  test('sampleCommand output is recorded at lease time and at the end, and never gates', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    const sample = 'echo "pressure $(date +%s)"; echo second line';
    expect(await land(f.deps, OPTS, f.config({ sampleCommand: sample }))).toBe(EXIT.ok);
    await sh(f.src, 'git checkout -q -B feat13 main');
    await f.commit(f.src, 'crates/s2.rs');
    await sh(f.src, 'git checkout -q main');
    expect(
      await land(
        f.deps,
        { ...OPTS, ref: 'feat13' },
        f.config({ sampleCommand: 'echo broke; exit 3' }),
      ),
    ).toBe(EXIT.ok);
    const state = join(f.home, readdirSync(f.home).find((d) => d.startsWith('src-')) ?? '');
    const runs = readFileSync(join(state, 'runs.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => parseRun(line));
    expect(runs[0]?.sampleStart).toMatch(/^pressure \d+ second line$/);
    expect(runs[0]?.sampleEnd).toMatch(/^pressure \d+ second line$/);
    expect(runs[1]?.sampleStart).toBe('sample failed (exit status 3): broke');
  });

  test('a run receipt that cannot be written never changes the outcome', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    f.deps.appendFile = () => {
      throw new Error('disk full');
    };
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.errors.join('\n')).toMatch(/could not record the run receipt: disk full/);
    const nonError: unknown = 'plain';
    f.deps.appendFile = () => {
      throw nonError;
    };
    await sh(f.src, 'git checkout -q -B feat11 main');
    await f.commit(f.src, 'crates/q3.rs');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'feat11' }, f.config())).toBe(EXIT.ok);
    expect(f.errors.join('\n')).toMatch(/could not record the run receipt: plain/);
  });

  test('retryOnOutput re-runs a failed command once, only when its output matches', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    // Fails the first time with a matching line, passes the second.
    const flaky = {
      name: 'flaky',
      run: 'if [ -f "$FAKE_STATE/seen" ]; then echo ok; else touch "$FAKE_STATE/seen"; echo "Timeout calling onTaskUpdate"; exit 1; fi',
      when: ['rust'],
      retryOnOutput: 'Timeout calling',
    };
    expect(await land(f.deps, OPTS, f.config({ gates: [flaky] }))).toBe(EXIT.ok);
    expect(f.logs.join('\n')).toMatch(/flaky: output matched \/Timeout calling\/; retrying once/);
    expect(f.logs.join('\n')).toMatch(/PASS flaky-retry/);
    // a non-matching failure is NOT retried
    await sh(f.src, 'git checkout -q -B feat14 main');
    await f.commit(f.src, 'crates/r1.rs');
    await sh(f.src, 'git checkout -q main');
    f.logs.length = 0;
    const real = { ...flaky, run: 'echo real failure; exit 1' };
    expect(await land(f.deps, { ...OPTS, ref: 'feat14' }, f.config({ gates: [real] }))).toBe(
      EXIT.gate,
    );
    expect(f.logs.join('\n')).not.toMatch(/retrying once/);
    // a matching failure that fails again still fails
    await sh(f.src, 'git checkout -q -B feat15 main');
    await f.commit(f.src, 'crates/r2.rs');
    await sh(f.src, 'git checkout -q main');
    const always = { ...flaky, run: 'echo "Timeout calling"; exit 1' };
    expect(await land(f.deps, { ...OPTS, ref: 'feat15' }, f.config({ gates: [always] }))).toBe(
      EXIT.gate,
    );
  });

  test('lefthook 1.x style comma selectors are supported', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, OPTS, f.config({ lefthookSelector: '--commands' }))).toBe(EXIT.ok);
    expect(f.ran()).toEqual(['run pre-push --force --commands cov-rust,adr']);
  });

  test('an early check runs before bootstrap and any gate, and a failure stops the land there', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    const config = f.config({
      earlyChecks: [{ name: 'early', run: 'echo early-{head}-{base} >> "$FAKE_STATE/order.log"' }],
      bootstrap: { run: 'echo bootstrap >> "$FAKE_STATE/order.log"' },
      gates: [{ name: 'cmd', run: 'echo gate >> "$FAKE_STATE/order.log"' }],
    });
    expect(await land(f.deps, OPTS, config)).toBe(EXIT.ok);
    const lines = readFileSync(join(f.state, 'order.log'), 'utf8').trim().split('\n');
    expect(lines.map((l) => l.split('-')[0])).toEqual(['early', 'bootstrap', 'gate']);
    await sh(f.src, 'git checkout -q -B feat6 main');
    await f.commit(f.src, 'crates/y.rs');
    await sh(f.src, 'git checkout -q main');
    const failing = f.config({
      earlyChecks: [{ name: 'host', run: 'echo host down; exit 9' }],
      gates: [{ name: 'cmd', run: 'echo gate >> "$FAKE_STATE/never.log"' }],
    });
    expect(await land(f.deps, { ...OPTS, ref: 'feat6' }, failing)).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/host failed \(exit status 9\)\nhost down/);
    expect(existsSync(join(f.state, 'never.log'))).toBe(false);
  });

  test('a failing project check blocks landing', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    expect(
      await land(
        f.deps,
        OPTS,
        f.config({ checks: [{ name: 'baseline', run: 'echo drift; exit 3' }] }),
      ),
    ).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/baseline failed \(exit status 3\)\ndrift/);
  });

  test('a push killed by a signal that did not land is reported by signal and retried', async () => {
    const f = await fixture();
    const sha = await branch(f, 'crates/x.rs');
    f.env.FAKE_HOOK = 'kill-first';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(sha);
    expect(f.logs.join('\n')).toMatch(/push killed by SIGKILL; origin\/main unmoved, retrying/);
  });

  test('a push that always dies fails after bounded retries and names the signal', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    f.env.FAKE_HOOK = 'kill-always';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.push);
    expect(f.errors.join('\n')).toMatch(
      /push failed \(killed by SIGKILL\) and origin\/main does not contain/,
    );
    expect(f.hookSeen()).toHaveLength(3);
  });

  test('a push reported as failed that actually landed is a success', async () => {
    const f = await fixture();
    const sha = await branch(f, 'crates/x.rs');
    f.env.FAKE_HOOK = 'land-then-kill';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(sha);
    expect(f.logs.join('\n')).toMatch(/push reported killed by SIGKILL but origin\/main contains/);
  });

  test('a hook refusal (not transport) fails without retry', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    f.env.FAKE_HOOK = 'refuse';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.push);
    expect(f.hookSeen()).toHaveLength(1);
    expect(f.errors.join('\n')).toMatch(/exit status 1\) and origin\/main does not contain/);
  });

  test('main moving during validation re-applies on the new base; evidence for the old SHA is discarded', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    writeFileSync(join(f.state, 'move-once'), '');
    writeFileSync(join(f.state, 'move-file'), 'crates/other.rs');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    // the gate set ran again on the new SHA because the SHA changed
    expect(f.ran()).toEqual([
      'run pre-push --force --job cov-rust --job adr',
      'run pre-push --force --job cov-rust --job adr',
    ]);
    expect(f.logs.join('\n')).toMatch(/moved during validation; re-applying/);
    const landed = await f.mainTip();
    expect(f.hookSeen()[0]).toContain(`marker=${landed}`);
    expect(await sh(f.src, `git --git-dir=${f.origin} log --format=%s -3`)).toContain('main moved');
  });

  test('evidence can be inherited across a re-apply only when enabled and the delta misses the gate scope', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    writeFileSync(join(f.state, 'move-once'), '');
    writeFileSync(join(f.state, 'move-file'), 'docs/moved.md'); // delta outside rust
    const config = f.config({ inheritUnaffectedEvidence: true, maxAttempts: 3 });
    expect(await land(f.deps, OPTS, config)).toBe(EXIT.ok);
    // `adr` is unconditional (no scope) so it is not provably unaffected and re-runs; cov-rust is inherited.
    expect(f.ran()).toEqual([
      'run pre-push --force --job cov-rust --job adr',
      'run pre-push --force --job adr',
    ]);
    expect(f.hookSeen()[0]).toMatch(/exclude=adr,cov-rust,cov-ts,doc-validator /);
  });

  test('main moving between gates and push (rejected push) re-applies', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    f.env.FAKE_HOOK = 'move-main';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.logs.join('\n')).toMatch(/moved before the push landed; re-applying/);
    expect(f.ran()).toHaveLength(2);
  });

  test('gives up when main never stops moving', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    writeFileSync(join(f.state, 'move-always'), '');
    expect(await land(f.deps, OPTS, f.config({ maxAttempts: 2 }))).toBe(EXIT.push);
    expect(f.errors.join('\n')).toMatch(/kept moving; gave up after 2 attempts/);
  });

  test('cherry-picks when main has advanced past the branch base; ff-only and merge modes', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    await f.commit(f.other, 'docs/adv.md');
    await sh(f.other, 'git push -q origin HEAD:main');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.logs.join('\n')).toMatch(/cherry-picking 1 commit/);
    // ff-only fails when diverged
    await sh(f.src, 'git fetch -q origin && git checkout -q -B feat4 origin/main~1');
    await f.commit(f.src, 'crates/q.rs');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'feat4', mode: 'ff-only' }, f.config())).toBe(
      EXIT.gate,
    );
    // merge mode with and without message
    expect(
      await land(
        f.deps,
        { ...OPTS, ref: 'feat4', mode: 'merge', message: 'custom msg' },
        f.config(),
      ),
    ).toBe(EXIT.ok);
    expect(await sh(f.src, `git --git-dir=${f.origin} log -1 --format=%s`)).toBe('custom msg');
    await sh(f.src, 'git checkout -q -B feat5 origin/main~1');
    await f.commit(f.src, 'crates/r.rs');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'feat5', mode: 'merge' }, f.config())).toBe(EXIT.ok);
  });

  test('a ref with nothing new and a conflicting cherry-pick both fail cleanly', async () => {
    const f = await fixture();
    expect(await land(f.deps, { ...OPTS, ref: 'main', mode: 'cherry-pick' }, f.config())).toBe(
      EXIT.gate,
    );
    expect(f.errors.join('\n')).toMatch(/has no commits absent/);
    await sh(f.src, 'git checkout -q -B conflict main');
    await f.commit(f.src, 'c.txt', 'one\n');
    await sh(f.src, 'git checkout -q main');
    await f.commit(f.other, 'c.txt', 'two\n');
    await sh(f.other, 'git push -q origin HEAD:main');
    expect(await land(f.deps, { ...OPTS, ref: 'conflict' }, f.config())).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/cherry-pick .* failed/);
  });

  test('unknown ref, unfetchable remote and broken worktree are reported or healed', async () => {
    const f = await fixture();
    expect(await land(f.deps, { ...OPTS, ref: 'nope' }, f.config())).toBe(EXIT.gate);
    await branch(f, 'crates/x.rs');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    // corrupt the persistent worktree: it is rebuilt
    const wt =
      f.logs.find((l) => l.includes('plan:')) &&
      join(f.home, readdirSync(f.home).find((d) => d.startsWith('src-')) ?? '', 'worktree');
    rmSync(join(wt as string, '.git'), { force: true });
    writeFileSync(join(wt as string, '.git'), 'gitdir: /nonexistent\n');
    await sh(f.src, 'git checkout -q -B again main');
    await f.commit(f.src, 'crates/again.rs');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'again' }, f.config())).toBe(EXIT.ok);
    // remote gone
    await sh(f.src, `git remote set-url origin ${join(f.root, 'gone.git')}`);
    expect(await land(f.deps, { ...OPTS, ref: 'again' }, f.config())).toBe(EXIT.push);
    expect(f.errors.join('\n')).toMatch(/fetch origin failed/);
  });

  test('when no gate applies nothing runs through lefthook and nothing is excluded needlessly', async () => {
    const f = await fixture();
    await branch(f, 'docs/only.md');
    const config = f.config({ gates: [{ name: 'cov-rust', when: ['rust'] }] });
    expect(await land(f.deps, OPTS, config)).toBe(EXIT.ok);
    expect(f.ran()).toEqual([]);
    expect(f.logs.join('\n')).toMatch(/gates: none; not applicable: cov-rust/);
    expect(f.hookSeen()[0]).toContain('exclude=cov-rust ');
  });

  test('an unreadable diff runs the full suite', async () => {
    const f = await fixture();
    await branch(f, 'docs/only.md');
    const real = f.deps.run;
    f.deps.run = async (cmd, args, o) =>
      cmd === 'git' &&
      args.includes('diff') &&
      args.includes('--name-only') &&
      !args.includes('HEAD')
        ? { status: 128, signal: null, output: 'boom' }
        : real(cmd, args, o);
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.ran()[0]).toContain('--job cov-rust --job cov-ts');
    expect(f.logs.join('\n')).toMatch(/changed files could not be read/);
  });

  test('unexpected throws surface as a gate failure', async () => {
    const f = await fixture();
    f.deps.run = async () => {
      throw new Error('spawn exploded');
    };
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.gate);
    expect(f.errors).toEqual(['spawn exploded']);
    f.errors.length = 0;
    const nonError: unknown = 'plain string';
    f.deps.run = async () => {
      throw nonError;
    };
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.gate);
    expect(f.errors).toEqual(['plain string']);
  });

  test('dry run exercises the real pre-push hook with synthetic ref lines and pushes nothing', async () => {
    const f = await fixture();
    const before = await f.mainTip();
    const sha = await branch(f, 'crates/x.rs');
    expect(await land(f.deps, { ...OPTS, dryRun: true }, f.config())).toBe(EXIT.ok);
    expect(await f.mainTip()).toBe(before);
    expect(f.hookSeen()[0]).toContain(`marker=${sha}`);
    expect(f.hookSeen()[0]).toContain(`stdin=HEAD ${sha} refs/heads/main ${before}`);
    f.env.FAKE_HOOK = 'refuse';
    expect(await land(f.deps, { ...OPTS, dryRun: true }, f.config())).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/guards refused the dry run/);
  });

  test('ambient LEFTHOOK=0, LEFTHOOK_EXCLUDE and CARGO_TARGET_DIR never reach gates or the push', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    f.env.LEFTHOOK = '0';
    f.env.LEFTHOOK_EXCLUDE = 'everything';
    f.env.CARGO_TARGET_DIR = '/shared/target';
    f.env.HARNESS_LAND_GATE = 'forged';
    const config = f.config({
      checks: [
        {
          name: 'env',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax, not a template literal
          run: 'echo "L=${LEFTHOOK-unset} X=${LEFTHOOK_EXCLUDE-unset} C=${CARGO_TARGET_DIR-unset} G=${HARNESS_LAND_GATE-unset}" > "$FAKE_STATE/env.log"',
        },
      ],
    });
    expect(await land(f.deps, OPTS, config)).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'env.log'), 'utf8').trim()).toBe(
      'L=unset X=unset C=unset G=unset',
    );
    expect(f.hookSeen()[0]).not.toContain('forged');
    expect(f.hookSeen()[0]).not.toContain('everything');
  });

  test('a gate whose required tool is missing fails closed instead of soft-skipping', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    const config = f.config({
      gates: [
        { name: 'cov-rust', when: ['rust'], requires: ['definitely-not-installed-xyz', 'sh'] },
      ],
    });
    expect(await land(f.deps, OPTS, config)).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(
      /required tool\(s\) not on PATH: definitely-not-installed-xyz/,
    );
    expect(f.ran()).toEqual([]);
    const ok = f.config({ gates: [{ name: 'cov-rust', when: ['rust'], requires: ['sh'] }] });
    expect(await land(f.deps, OPTS, ok)).toBe(EXIT.ok);
  });

  test('gates that rewrite the tree they validate invalidate the evidence, except declared paths', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    const mutate = { gates: [{ name: 'mut', run: 'echo changed >> a.txt', when: ['rust'] }] };
    expect(await land(f.deps, OPTS, f.config(mutate))).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(
      /gates changed the tree they were validating .*modified: a.txt/,
    );
    expect(f.hookSeen()).toEqual([]);
    const allowed = f.config({ ...mutate, ignoreDirty: ['a.txt'] });
    expect(await land(f.deps, OPTS, allowed)).toBe(EXIT.ok);
    const moved = {
      gates: [{ name: 'mv', run: 'git commit -q --allow-empty -m sneaky', when: ['rust'] }],
    };
    await sh(f.src, 'git checkout -q -B feat9 main');
    await f.commit(f.src, 'crates/n.rs');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'feat9' }, f.config(moved))).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/HEAD [0-9a-f]{12} vs [0-9a-f]{12}/);
  });

  test('git config injection and repo-routing variables never reach gates; the diff base is bound', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    f.env.GIT_CONFIG_COUNT = '1';
    f.env.GIT_CONFIG_KEY_0 = 'core.hooksPath';
    f.env.GIT_CONFIG_VALUE_0 = '/dev/null';
    f.env.GIT_CONFIG_PARAMETERS = "'core.hooksPath=/dev/null'";
    const config = f.config({
      env: { GIT_DIR: '/elsewhere' },
      checks: [
        {
          name: 'cfg',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax, not a template literal
          run: 'echo "$(git config harness.hookBaseRemote)/$(git config harness.hookBaseRef) $(git config core.hooksPath) ${GIT_DIR-unset} ${GIT_CONFIG_PARAMETERS-unset}" > "$FAKE_STATE/cfg.log"',
        },
      ],
    });
    expect(await land(f.deps, OPTS, config)).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'cfg.log'), 'utf8').trim()).toBe('origin/main  unset unset');
    expect(f.hookSeen()).toHaveLength(1); // the push hook still fired
  });

  test('waits for load, gives up when it never drops, and queues behind the lock', async () => {
    const f = await fixture();
    await branch(f, 'crates/x.rs');
    let calls = 0;
    f.deps.loadavg = () => (++calls < 4 ? 99 : 1);
    expect(await land(f.deps, OPTS, f.config({ loadPollSeconds: 5 }))).toBe(EXIT.ok);
    expect(f.logs.filter((l) => l.includes('is above 40')).length).toBeGreaterThan(0);
    // an I/O-starved box can have a low load average: the quiet command is the second signal
    f.deps.loadavg = () => 1;
    await sh(f.src, 'git checkout -q -B io main');
    await f.commit(f.src, 'crates/io.rs');
    await sh(f.src, 'git checkout -q main');
    const starved = f.config({ quietCommand: 'echo disk busy; exit 1', loadWaitMaxSeconds: 10 });
    expect(await land(f.deps, { ...OPTS, ref: 'io' }, starved)).toBe(EXIT.busy);
    expect(f.errors.join('\n')).toMatch(
      /quiet check failed \(exit status 1\): disk busy; still busy after 10s/,
    );
    expect(await land(f.deps, { ...OPTS, ref: 'io' }, f.config({ quietCommand: 'true' }))).toBe(
      EXIT.ok,
    );
    f.deps.loadavg = () => 99;
    await sh(f.src, 'git checkout -q -B busy main');
    await f.commit(f.src, 'crates/busy.rs');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'busy' }, f.config({ loadWaitMaxSeconds: 10 }))).toBe(
      EXIT.busy,
    );
    // onLoadTimeout=proceed: the wait is capped, logged, and the land goes ahead
    f.errors.length = 0;
    f.deps.loadavg = () => 99;
    await sh(f.src, 'git checkout -q -B cap main');
    await f.commit(f.src, 'crates/cap.rs');
    await sh(f.src, 'git checkout -q main');
    const capped = f.config({ loadWaitMaxSeconds: 10, onLoadTimeout: 'proceed' });
    expect(await land(f.deps, { ...OPTS, ref: 'cap' }, capped)).toBe(EXIT.ok);
    expect(f.logs.join('\n')).toMatch(
      /load 99.0 is above 40; still busy after waiting 10s, proceeding anyway/,
    );
    // lock held by a live process: times out as busy
    const m = memoryLock();
    m.files.set('/l', {
      text: JSON.stringify({
        pid: 100,
        bootId: 'boot1',
        startedAt: new Date(f.clock.t).toISOString(),
        repo: '/o',
        ref: 'r',
        user: 'u',
      }),
      at: 0,
    });
    f.deps.lock = m.deps;
    f.errors.length = 0;
    f.deps.loadavg = () => 1;
    expect(await land(f.deps, { ...OPTS, ref: 'busy' }, f.config({ lockWaitMaxSeconds: 10 }))).toBe(
      EXIT.busy,
    );
    expect(f.errors.join('\n')).toMatch(
      /landing lock is held by pid 100 \(u\) landing r in \/o, since .* \(\d+ min ago\); not waiting/,
    );
    // default is to refuse at once, naming the holder
    f.errors.length = 0;
    expect(await land(f.deps, { ...OPTS, ref: 'busy' }, f.config())).toBe(EXIT.busy);
    expect(f.errors.join('\n')).toMatch(/held by pid 100/);
    expect(f.clock.t).toBeLessThan(2_000_000);
  });
});

describe('landing worktree guard', () => {
  test('a second land on the same worktree refuses even when the lease wrongly let it through', async () => {
    const f = await fixture();
    await branch(f, 'crates/g.rs');
    const guarded = memoryLock();
    const realRead = guarded.deps.read;
    // The lease is free (it was wrongly reaped), but a live land already holds the worktree guard.
    guarded.deps.read = (p) =>
      p.endsWith('worktree.lock')
        ? JSON.stringify({
            pid: 100,
            bootId: 'boot1',
            startedAt: new Date(f.clock.t).toISOString(),
            repo: '/o',
            ref: 'first',
            user: 'u',
          })
        : realRead(p);
    const realCreate = guarded.deps.createExclusive;
    guarded.deps.createExclusive = (p, c) =>
      p.endsWith('worktree.lock') ? false : realCreate(p, c);
    f.deps.lock = guarded.deps;
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.busy);
    expect(guarded.files.has('/l')).toBe(false); // the refused land does not leak the lease
    expect(f.errors.join('\n')).toMatch(
      /landing worktree .* is in use: pid 100 .*refusing a second land/,
    );
  });

  test('a guard that cannot be taken for another reason fails the land and still releases the lease', async () => {
    const f = await fixture();
    await branch(f, 'crates/i.rs');
    const guarded = memoryLock();
    const realCreate = guarded.deps.createExclusive;
    guarded.deps.createExclusive = (p, c) => {
      if (p.endsWith('worktree.lock')) throw new Error('disk full');
      return realCreate(p, c);
    };
    f.deps.lock = guarded.deps;
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.gate);
    expect(guarded.files.has('/l')).toBe(false);
    expect(f.errors.join('\n')).toMatch(/disk full/);
  });

  test('two lands in turn from one cwd each take and release the guard', async () => {
    const f = await fixture();
    await branch(f, 'crates/h.rs');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    await sh(f.src, 'git checkout -q -B h2 main');
    await f.commit(f.src, 'crates/h2.rs');
    await sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'h2' }, f.config())).toBe(EXIT.ok);
  });
});

function readdirSync(dir: string): string[] {
  return execFileSync('ls', [dir], { encoding: 'utf8' }).split('\n').filter(Boolean);
}
