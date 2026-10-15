import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { idlePercent, landHome, parseArgs, pidAlive, readBootId, sampleIdle, USAGE } from '../land';
import { isMainEntry } from '../lib/entrypoint';
import { DEFAULT_CONFIG, type GateConfig, loadConfig, parseConfig } from '../lib/land/config';
import {
  allOrFirstError,
  type Ctx,
  type EngineDeps,
  hookRunner,
  requirePushTools,
} from '../lib/land/core';
import {
  admitHeavyLanes,
  excludedJobs,
  inheritEvidence,
  isLefthookGate,
  LAND_NICENESS,
  lowerPriority,
  passedJobs,
  planGates,
  repoId,
  rootAndCommonDir,
  runLanes,
} from '../lib/land/engine';
import { describeExit, runProcess, succeeded } from '../lib/land/exec';
import { createLineFolder, foldedLine } from '../lib/land/fold';
import { classify, gateApplies, globToRegExp, matchesAny } from '../lib/land/scope';

const cfg = (extra: Record<string, unknown> = {}) =>
  parseConfig({
    scopes: { rust: ['**/*.rs', 'Cargo.toml'], ts: ['**/*.ts'], docs: ['docs/**', '*.md'] },
    full: ['harness/**'],
    gates: [
      { name: 'cov-rust', when: ['rust'] },
      { name: 'cov-ts', when: ['ts'] },
      { name: 'docs', when: ['docs'] },
      { name: 'always' },
      { name: 'cmd', run: 'true', when: ['rust'] },
    ],
    ...extra,
  });

describe('fold', () => {
  test('keeps the last carriage-return redraw of a line', () => {
    expect(foldedLine('10%\r50%\r100%')).toBe('100%');
    expect(foldedLine('line\r')).toBe('line');
    expect(foldedLine('plain')).toBe('plain');
  });
  test('splits chunks on newlines and flushes the tail', () => {
    const out: string[] = [];
    const f = createLineFolder((l) => out.push(l));
    f.write('a\r');
    f.write('b\nc\nd');
    f.end();
    f.end();
    expect(out).toEqual(['b', 'c', 'd']);
  });
});

describe('scope', () => {
  test('globs', () => {
    expect(globToRegExp('**/*.rs').test('a/b/c.rs')).toBe(true);
    expect(globToRegExp('**/*.rs').test('c.rs')).toBe(true);
    expect(globToRegExp('*.md').test('docs/a.md')).toBe(false);
    expect(globToRegExp('docs/**').test('docs/x/y.md')).toBe(true);
    expect(globToRegExp('a?.txt').test('ab.txt')).toBe(true);
    expect(globToRegExp('a?.txt').test('a/.txt')).toBe(false);
    expect(globToRegExp('a.b+c').test('a.b+c')).toBe(true);
    expect(matchesAny('x', [])).toBe(false);
  });
  test('docs-only diff selects docs scope and not rust', () => {
    const c = classify(['docs/a.md', 'README.md'], cfg());
    expect(c).toEqual({ full: false, scopes: ['docs'], reasons: [] });
    const { selected, scopedOut } = planGates(cfg(), c);
    expect(selected.map((g) => g.name)).toEqual(['docs', 'always']);
    expect(scopedOut.map((g) => g.name)).toEqual(['cov-rust', 'cov-ts', 'cmd']);
  });
  test('rust-only diff', () => {
    const c = classify(['crates/a/src/lib.rs'], cfg());
    expect(c.scopes).toEqual(['rust']);
    expect(gateApplies(['ts'], c)).toBe(false);
    expect(gateApplies(['rust'], c)).toBe(true);
    expect(gateApplies(undefined, c)).toBe(true);
  });
  test.each([
    ['unreadable diff', null],
    ['empty diff', []],
    ['unmapped path', ['mystery.bin']],
    ['config full glob', ['harness/x']],
    ['land config', ['land.config.json']],
    ['lefthook.yml', ['lefthook.yml']],
    ['land engine', ['scripts/lib/land/engine.ts']],
    ['land cli', ['scripts/land.ts']],
  ])('%s runs the full suite', (_n, files) => {
    const c = classify(files as string[] | null, cfg());
    expect(c.full).toBe(true);
    expect(c.reasons.length).toBeGreaterThan(0);
    expect(gateApplies(['ts'], c)).toBe(true);
    expect(planGates(cfg(), c).selected).toHaveLength(5);
  });
  test('multi-scope file', () => {
    const c = classify(
      ['Cargo.toml'],
      cfg({ scopes: { rust: ['Cargo.toml'], deps: ['Cargo.toml'] } }),
    );
    expect(c.scopes).toEqual(['deps', 'rust']);
  });
});

describe('config', () => {
  test('defaults and loading', () => {
    const dir = mkdtempSync(join(tmpdir(), 'land-cfg-'));
    expect(loadConfig(dir)).toEqual(DEFAULT_CONFIG);
    writeFileSync(
      join(dir, 'land.config.json'),
      JSON.stringify({
        $schema: 'x',
        loadMax: 10,
        remote: 'up',
        lefthook: 'pnpm exec lefthook',
        quietCommand: 'true',
        sampleCommand: 'echo hi',
        onLoadTimeout: 'proceed',
        cargoTargetDir: '~/t',
        lefthookSelector: '--commands',
        inheritUnaffectedEvidence: true,
        env: { A: 'b' },
        bootstrap: { run: 'x', when: ['ts'] },
        preflight: [{ name: 'p', run: 'true' }],
        earlyChecks: [{ name: 'e', run: 'true', cwd: 'source' }],
        prepare: [
          { name: 'clean', run: 'true', when: ['rust'] },
          { name: 'always', run: 'true' },
        ],
        checks: [{ name: 'c', run: 'true', cwd: 'source', retryOnOutput: 'x' }],
        gates: [
          {
            name: 'g',
            run: 'true',
            when: ['x'],
            requires: ['sh'],
            retryOnOutput: 'flaky',
            lane: 'heavy',
            cwd: 'source',
          },
        ],
        ignoreDirty: ['a.log'],
        scopes: { x: ['a'] },
        full: ['f'],
      }),
    );
    const c = loadConfig(dir);
    expect(c.loadMax).toBe(10);
    expect(c.remote).toBe('up');
    expect(c.bootstrap).toEqual({ run: 'x', when: ['ts'] });
    expect(c.checks[0]?.cwd).toBe('source');
    expect(c.checks[0]?.retryOnOutput).toBe('x');
    expect(c.gates[0]?.retryOnOutput).toBe('flaky');
    expect(c.gates[0]?.lane).toBe('heavy');
    expect(c.gates[0]?.cwd).toBe('source');
    expect(c.earlyChecks[0]?.name).toBe('e');
    expect(c.prepare).toMatchObject([
      { name: 'clean', run: 'true', when: ['rust'] },
      { name: 'always', run: 'true' },
    ]);
    expect(c.prepare[1]).not.toHaveProperty('when');
    expect(c.inheritUnaffectedEvidence).toBe(true);
    expect(c.ignoreDirty).toEqual(['a.log']);
    expect(c.quietCommand).toBe('true');
    expect(c.sampleCommand).toBe('echo hi');
    expect(c.onLoadTimeout).toBe('proceed');
    expect(c.cargoTargetDir).toBe('~/t');
    expect(c.lefthookSelector).toBe('--commands');
    expect(c.gates[0]?.requires).toEqual(['sh']);
    expect(parseConfig({ bootstrap: { run: 'x' } }).bootstrap).toEqual({ run: 'x' });
  });
  test('malformed JSON is loud', () => {
    const dir = mkdtempSync(join(tmpdir(), 'land-cfg-'));
    writeFileSync(join(dir, 'land.config.json'), '{');
    expect(() => loadConfig(dir)).toThrow(/not valid JSON/);
    writeFileSync(join(dir, 'land.config.json'), '1');
    expect(() => loadConfig(dir)).toThrow(/JSON object/);
    writeFileSync(join(dir, 'land.config.json'), '{');
    const nonError: unknown = 'str';
    vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw nonError;
    });
    expect(() => loadConfig(dir)).toThrow(/str/);
  });
  test.each([
    [{ nope: 1 }, /unknown key/],
    [{ loadMax: -1 }, /non-negative/],
    [{ loadMax: 'x' }, /non-negative/],
    [{ remote: 'bad name' }, /must match/],
    [{ remote: 3 }, /must match/],
    [{ lefthook: '' }, /non-empty/],
    [{ full: 'x' }, /array of strings/],
    [{ full: [1] }, /array of strings/],
    [{ scopes: 1 }, /scopes must be/],
    [{ scopes: { a: 'x' } }, /array of strings/],
    [{ scopes: { 'b d': [] } }, /scope name/],
    [{ gates: 1 }, /array/],
    [{ gates: [1] }, /must be an object/],
    [{ gates: [{ name: 'a', run: 1 }] }, /run must be a string/],
    [{ gates: [{ name: 'a', when: 1 }] }, /array of strings/],
    [{ gates: [{ name: '' }] }, /must match/],
    [{ checks: [{ name: 'a' }] }, /needs a run/],
    [{ checks: [1] }, /needs a run/],
    [{ earlyChecks: [{ name: 'a' }] }, /needs a run/],
    [{ checks: [{ name: 'a', run: 'x', cwd: 'z' }] }, /cwd/],
    [{ bootstrap: 1 }, /bootstrap needs/],
    [{ env: { a: 1 } }, /env must be/],
    [{ env: [] }, /env must be/],
    [{ inheritUnaffectedEvidence: 'y' }, /boolean/],
    [{ gates: [{ name: 'guard-main-push' }] }, /may never be skipped/],
    [{ gates: [{ name: 'push-scope-guard.sh' }] }, /may never be skipped/],
    [{ gates: [{ name: 'a', requires: 'pnpm' }] }, /array of strings/],
    [{ ignoreDirty: 1 }, /array of strings/],
    [{ quietCommand: '' }, /non-empty/],
    [{ gates: [{ name: 'a', run: 'x', cwd: 'elsewhere' }] }, /cwd must be worktree\|source/],
    [{ gates: [{ name: 'a', run: 'x', lane: 'bad lane' }] }, /must match/],
    [{ gates: [{ name: 'a', run: 'x', retryOnOutput: 5 }] }, /must be a string/],
    [{ gates: [{ name: 'a', run: 'x', retryOnOutput: '(' }] }, /valid regular expression/],
    [{ checks: [{ name: 'a', run: 'x', retryOnOutput: '(' }] }, /valid regular expression/],
    [{ sampleCommand: '' }, /non-empty/],
    [{ parallelGates: -1 }, /non-negative/],
    [{ onLoadTimeout: 'maybe' }, /fail or proceed/],
    [{ cargoTargetDir: '' }, /non-empty/],
    [{ lefthookSelector: '--nope' }, /lefthookSelector must be one of/],
  ])('rejects %j', (raw, re) => {
    expect(() => parseConfig(raw)).toThrow(re);
  });
});

describe('exec', () => {
  test('describes exits and signals distinctly', () => {
    expect(describeExit({ status: null, signal: 'SIGPIPE' })).toBe('killed by SIGPIPE');
    expect(describeExit({ status: 3, signal: null })).toBe('exit status 3');
    expect(describeExit({ status: null, signal: null })).toBe('exit status unknown');
    expect(succeeded({ status: 0, signal: null, output: '' })).toBe(true);
    expect(succeeded({ status: null, signal: 'SIGKILL', output: '' })).toBe(false);
  });
  test('reports the signal when the child is killed', async () => {
    const r = await runProcess('sh', ['-c', 'echo hi; kill -KILL $$']);
    expect(r.status).toBeNull();
    expect(r.signal).toBe('SIGKILL');
    expect(r.output).toBe('hi');
  });
  test('folds progress, forwards lines, feeds stdin, passes env', async () => {
    const seen: string[] = [];
    const r = await runProcess('sh', ['-c', 'printf "1\\r2\\r3\\n"; cat; echo "$X" >&2'], {
      env: { X: 'envval', PATH: process.env.PATH },
      onLine: (l) => seen.push(l),
      input: 'in\n',
      cwd: tmpdir(),
    });
    expect(r.output).toBe('3\nin\nenvval');
    expect(seen).toEqual(['3', 'in', 'envval']);
    expect(await runProcess('sh', ['-c', 'exit 4'])).toMatchObject({ status: 4, signal: null });
  });
  test('a child that exits before reading its stdin does not crash the runner', async () => {
    const r = await runProcess('true', [], { input: 'x'.repeat(5_000_000) });
    expect(r.status).toBe(0);
  });
  test('missing program is a 127, not a throw', async () => {
    const r = await runProcess('definitely-not-a-program-xyz', []);
    expect(r.status).toBe(127);
    expect(r.output).toMatch(/ENOENT/);
  });
});

describe('runLanes', () => {
  const lane =
    (log: string[], name: string, fail = false) =>
    async () => {
      log.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.push(`end ${name}`);
      if (fail) throw new Error(`${name} failed`);
    };

  test('limit 1 is sequential', async () => {
    const log: string[] = [];
    await runLanes([lane(log, 'a'), lane(log, 'b')], 1);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  test('limit 2 overlaps lanes', async () => {
    const log: string[] = [];
    await runLanes([lane(log, 'a'), lane(log, 'b')], 2);
    expect(log.slice(0, 2)).toEqual(['start a', 'start b']);
  });

  test('fail fast: after a failure no queued lane starts (bead luyfr.2)', async () => {
    const log: string[] = [];
    await expect(
      runLanes([lane(log, 'a', true), lane(log, 'b'), lane(log, 'c')], 1),
    ).rejects.toThrow('a failed');
    expect(log).toEqual(['start a', 'end a']);
  });

  test('a lane whose boundary check outlasts another lane failing is not started', async () => {
    const log: string[] = [];
    // Worker 2 awaits the boundary check for lane b while lane a fails.
    const between = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
    await expect(runLanes([lane(log, 'a', true), lane(log, 'b')], 2, between)).rejects.toThrow(
      'a failed',
    );
    expect(log).toEqual(['start a', 'end a']);
  });

  test('a gate marked early parses, and anything but a boolean is refused', () => {
    expect(cfg({ gates: [{ name: 'g', early: true }] }).gates[0]?.early).toBe(true);
    expect(cfg({ gates: [{ name: 'g' }] }).gates[0]?.early).toBeUndefined();
    expect(() => cfg({ gates: [{ name: 'g', early: 'yes' }] })).toThrow(
      /early must be true or false/,
    );
  });

  test('every started lane finishes, and the first failure in lane order is thrown', async () => {
    const log: string[] = [];
    await expect(
      runLanes([lane(log, 'a', true), lane(log, 'b', true), lane(log, 'c')], 3),
    ).rejects.toThrow('a failed');
    expect(log.filter((l) => l.startsWith('end'))).toHaveLength(3);
  });

  test('a limit below 1 still runs, sequentially, and no lanes is fine', async () => {
    const log: string[] = [];
    await runLanes([lane(log, 'a')], 0);
    expect(log).toEqual(['start a', 'end a']);
    await runLanes([], 4);
  });
});

describe('engine helpers', () => {
  test('passedJobs reads the lefthook summary', () => {
    const out = '✔️ cov-ts (1.2 seconds)\n🥊 cov-rust\n  ✓ docs (0.1)\n✔ a-b (1)';
    expect([...passedJobs(out)].sort()).toEqual(['a-b', 'cov-ts', 'docs']);
    expect(passedJobs('✔️')).toEqual(new Set());
  });
  test('repoId is keyed by the git common dir: stable, path-sensitive, shared by every worktree', () => {
    expect(repoId('/a/.git')).toBe(repoId('/a/.git'));
    expect(repoId('/a/.git')).not.toBe(repoId('/b/.git'));
    expect(repoId('/x/a/.git')).toMatch(/^a-[0-9a-f]{10}$/);
    expect(repoId('/srv/repo.git')).toMatch(/^repo-[0-9a-f]{10}$/); // a bare repository
  });
  test('exclude list names only lefthook jobs that passed on the SHA or are inapplicable', () => {
    const c = cfg();
    const ev = {
      sha: 's',
      passed: new Map([
        ['cov-rust', 's'],
        ['cmd', 's'],
      ]),
    };
    const { scopedOut } = planGates(c, classify(['crates/a.rs'], c));
    expect(isLefthookGate(c.gates[4] as GateConfig)).toBe(false);
    expect(excludedJobs(c, ev, scopedOut)).toEqual(['cov-ts', 'docs', 'cov-rust'].sort());
    // `always` never ran and is applicable: it must still run at push.
    expect(excludedJobs(c, ev, scopedOut)).not.toContain('always');
    expect(excludedJobs(c, { sha: 'new', passed: new Map() }, [])).toEqual([]);
  });
  test('evidence resets when the SHA changes unless inheritance is enabled and provable', () => {
    const prev = {
      sha: 'a',
      passed: new Map([
        ['cov-rust', 'a'],
        ['cov-ts', 'a'],
        ['always', 'a'],
      ]),
    };
    expect(inheritEvidence(prev, 'b', ['crates/x.rs'], cfg()).passed.size).toBe(0);
    const on = cfg({ inheritUnaffectedEvidence: true });
    // delta touches rust: rust evidence dropped, ts survives, always (no scope) is re-run
    const rustMoved = inheritEvidence(prev, 'b', ['crates/x.rs'], on);
    expect([...rustMoved.passed.keys()]).toEqual(['cov-ts']);
    expect(rustMoved.sha).toBe('b');
    // unreadable or unmapped delta: nothing carries
    expect(inheritEvidence(prev, 'b', null, on).passed.size).toBe(0);
    expect(inheritEvidence(prev, 'b', ['mystery'], on).passed.size).toBe(0);
    // identical trees: everything carries, and provenance chains through the first SHA
    const same = inheritEvidence(prev, 'b', [], on);
    expect(same.passed.get('cov-ts')).toBe('inherited from a');
    expect(inheritEvidence(same, 'c', [], on).passed.get('cov-ts')).toBe('inherited from a');
  });
});

describe('shipped land.config.json', () => {
  const root = join(__dirname, '..', '..');
  test('parses, and every lefthook gate names a real pre-push job', () => {
    const config = loadConfig(root);
    const yml = readFileSync(join(root, 'lefthook.yml'), 'utf8');
    const prePush = yml.slice(yml.indexOf('\npre-push:'), yml.indexOf('\n# After a checkout'));
    const jobs = new Set([...prePush.matchAll(/^ {4}([a-z0-9-]+):$/gm)].map((m) => m[1]));
    const lefthookGates = config.gates.filter((g) => g.run === undefined).map((g) => g.name);
    expect(lefthookGates.filter((g) => !jobs.has(g))).toEqual([]);
    // Every scope a gate or bootstrap refers to exists.
    const used = config.gates.flatMap((g) => g.when ?? []).concat(config.bootstrap?.when ?? []);
    expect(used.filter((s) => config.scopes[s] === undefined)).toEqual([]);
  });
});

describe('land cli helpers', () => {
  test('parseArgs', () => {
    expect(parseArgs(['feat', '--', '--dry-run', '--skip-bootstrap'])).toEqual({
      ok: true,
      options: {
        ref: 'feat',
        mode: 'auto',
        message: null,
        dryRun: true,
        bootstrap: false,
        waitSeconds: null,
      },
    });
    expect(parseArgs(['x', '--mode', 'merge', '--message', 'hi'])).toMatchObject({ ok: true });
    expect(parseArgs(['x', '--wait', '30'])).toMatchObject({
      ok: true,
      options: { waitSeconds: 30 },
    });
    expect(parseArgs(['--verify', 'x'])).toMatchObject({ ok: true, options: { verify: true } });
    expect(parseArgs(['x', '--require-pass', '--pass-from', 'tower'])).toMatchObject({
      ok: true,
      options: { requirePass: true, passFrom: 'tower' },
    });
    expect(parseArgs(['--help'])).toEqual({ ok: false, message: USAGE, exitCode: 0 });
    expect(parseArgs(['-h'])).toMatchObject({ exitCode: 0 });
    for (const argv of [
      [],
      ['x', '--mode'],
      ['x', '--mode', '--dry-run'],
      ['x', '--mode', 'bogus'],
      ['x', '--wait', 'soon'],
      ['x', '--wait', '-1'],
      ['x', '--nope'],
      ['x', 'y'],
      ['x', '--message', 'm'],
      ['x', '--verify', '--dry-run'],
      ['x', '--verify', '--require-pass'],
      ['x', '--dry-run', '--pass-from', 'tower'],
      ['x', '--pass-from', '-evil'],
      ['x', '--pass-from', 'a b'],
    ]) {
      expect(parseArgs(argv)).toMatchObject({ ok: false, exitCode: 64 });
    }
  });
  test('landHome, bootId and pidAlive', () => {
    expect(landHome({}, '/h')).toBe('/h/.cache/harness-land');
    expect(landHome({ HARNESS_LAND_HOME: '/x' }, '/h')).toBe('/x');
    expect(
      readBootId(
        () => ' abc\n',
        () => 'p',
      ),
    ).toBe('abc');
    expect(
      readBootId(
        () => {
          throw new Error('no /proc');
        },
        () => 'probe',
      ),
    ).toBe('probe');
    expect(pidAlive(1, () => undefined)).toBe(true);
    expect(
      pidAlive(1, () => {
        throw Object.assign(new Error(), { code: 'EPERM' });
      }),
    ).toBe(true);
    expect(
      pidAlive(1, () => {
        throw Object.assign(new Error(), { code: 'ESRCH' });
      }),
    ).toBe(false);
    expect(pidAlive(process.pid)).toBe(true);
  });
  test('entrypoint check is false under test', () => {
    expect(isMainEntry('file:///nope')).toBe(false);
    mkdirSync(tmpdir(), { recursive: true });
  });
});

describe('land runs at niceness 10 itself', () => {
  function niceDeps(current: number, refuse = false) {
    const set: number[] = [];
    const logs: string[] = [];
    const deps = {
      niceness: () => current,
      setNiceness: (n: number) => {
        if (refuse) throw new Error('EACCES: permission denied');
        set.push(n);
      },
      log: (m: string) => void logs.push(m),
    } as unknown as EngineDeps;
    return { deps, set, logs };
  }

  test('a process at the default priority is lowered to niceness 10', () => {
    const n = niceDeps(0);
    lowerPriority(n.deps);
    expect(n.set).toEqual([LAND_NICENESS]);
    expect(LAND_NICENESS).toBe(10);
  });

  test('a process already at niceness 10 or lower priority is never raised', () => {
    for (const current of [10, 19]) {
      const n = niceDeps(current);
      lowerPriority(n.deps);
      expect(n.set).toEqual([]);
    }
  });

  test('an OS that refuses is logged and the land carries on', () => {
    const n = niceDeps(0, true);
    expect(() => lowerPriority(n.deps)).not.toThrow();
    expect(n.logs.join('\n')).toMatch(
      /could not lower this process to niceness 10 \(EACCES: permission denied\); running at the current priority/,
    );
    const odd = niceDeps(0);
    (odd.deps as { niceness: () => number }).niceness = () => {
      const reason: unknown = 'no getpriority';
      throw reason; // a non-Error throw is reported as text
    };
    lowerPriority(odd.deps);
    expect(odd.logs.join('\n')).toMatch(/\(no getpriority\)/);
  });
});

describe('steps together', () => {
  const later = <T>(value: T, ms = 5) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
  const failing = (why: string, ms = 5) =>
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(why)), ms));

  test('every value, in order, when all succeed', async () => {
    expect(await allOrFirstError([later(1), later('b'), later(null)])).toEqual([1, 'b', null]);
  });

  test("the first step's error wins, after all have settled", async () => {
    let secondDone = false;
    const second = (async () => {
      const value = await later('b', 20);
      secondDone = true;
      return value;
    })();
    await expect(allOrFirstError([failing('a'), second])).rejects.toThrow('a');
    expect(secondDone).toBe(true); // never left running unobserved
    await expect(allOrFirstError([failing('a', 20), failing('b')])).rejects.toThrow('a');
  });

  test("a later step's error when only it fails", async () => {
    await expect(allOrFirstError([later(1), failing('b')])).rejects.toThrow('b');
  });
});

describe('land from a pass: fewer and cheaper processes', () => {
  const ctxWith = (lefthook: string, bins: string[], run?: EngineDeps['run']) =>
    ({
      worktree: '/wt',
      config: { ...DEFAULT_CONFIG, lefthook, pushRequires: ['cargo', 'bun', 'just'] },
      deps: { exists: (p: string) => bins.includes(p), env: {}, run },
    }) as unknown as Ctx;
  const result = (status: number, output: string) =>
    (async () => ({ status, signal: null, output })) as unknown as EngineDeps['run'];

  test('pnpm exec <bin> runs the worktree bin directly; anything else runs as configured', () => {
    expect(hookRunner(ctxWith('pnpm exec lefthook', ['/wt/node_modules/.bin/lefthook']))).toBe(
      "'/wt/node_modules/.bin/lefthook'",
    );
    expect(hookRunner(ctxWith('pnpm exec lefthook', []))).toBe('pnpm exec lefthook'); // not provisioned
    expect(hookRunner(ctxWith('lefthook', ['/wt/node_modules/.bin/lefthook']))).toBe('lefthook');
    expect(hookRunner(ctxWith('pnpm exec lefthook --verbose', []))).toBe(
      'pnpm exec lefthook --verbose',
    );
    const quoted = ctxWith('pnpm exec lefthook', ["/it's/node_modules/.bin/lefthook"]);
    expect(hookRunner(quoted, "/it's")).toBe(`'/it'\\''s/node_modules/.bin/lefthook'`);
  });

  test('every pushRequires tool is probed in one process, and each missing one is named', async () => {
    const calls: string[][] = [];
    const run = (async (_cmd: string, args: string[]) => {
      calls.push(args);
      return { status: 1, signal: null, output: 'missing:bun\nmissing:just\n' };
    }) as unknown as EngineDeps['run'];
    await expect(requirePushTools(ctxWith('lefthook', [], run))).rejects.toThrow(
      /push guard tool\(s\) not on PATH: bun, just/,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(-3)).toEqual(['cargo', 'bun', 'just']);
  });

  test('a probe that fails without naming a tool refuses with every tool unproven', async () => {
    await expect(
      requirePushTools(ctxWith('lefthook', [], result(127, 'sh: not found'))),
    ).rejects.toThrow(/not on PATH: cargo, bun, just/);
    await expect(requirePushTools(ctxWith('lefthook', [], result(0, '')))).resolves.toBeUndefined();
    const none = {
      ...ctxWith('lefthook', [], result(1, 'missing:x')),
      config: { ...DEFAULT_CONFIG, pushRequires: [] },
    } as unknown as Ctx;
    await expect(requirePushTools(none)).resolves.toBeUndefined(); // nothing to probe, nothing run
  });
});

describe('admission: heavy lanes wait for idle CPU (bead luyfr.3)', () => {
  function admitCtx(idles: Array<number | null>, extra: Record<string, number> = {}) {
    const clock = { t: 0 };
    const logs: string[] = [];
    const polls: Array<number | null> = [];
    const ctx = {
      config: {
        ...DEFAULT_CONFIG,
        admitIdleMin: 40,
        admitWaitMaxSeconds: 60,
        loadPollSeconds: 15,
        ...extra,
      },
      deps: {
        now: () => clock.t,
        sleep: async (ms: number) => {
          clock.t += ms;
        },
        log: (m: string) => void logs.push(m),
        cpuIdle: async () => {
          const idle = idles.length > 0 ? (idles.shift() as number | null) : 0;
          polls.push(idle);
          return idle;
        },
      },
    } as unknown as Ctx;
    return { ctx, logs, polls };
  }

  test('an idle machine starts at once and says nothing', async () => {
    const a = admitCtx([72.4]);
    await admitHeavyLanes(a.ctx);
    expect(a.logs).toEqual([]);
    expect(a.polls).toEqual([72.4]);
  });

  test('a busy machine waits, polling, until idle reaches the threshold', async () => {
    const a = admitCtx([12.2, 30, 41.6]);
    await admitHeavyLanes(a.ctx);
    expect(a.logs).toEqual([
      'admission: 12% idle CPU; waiting for 40% before the heavy lanes (checking every 15s, at most 60s)',
      'admission: 42% idle after 30s; starting the heavy lanes',
    ]);
  });

  test('after the most it waits it starts anyway, and says so', async () => {
    const a = admitCtx([5, 5, 5, 5, 5, 5]);
    await admitHeavyLanes(a.ctx);
    expect(a.logs.at(-1)).toBe(
      'admission: still 5% idle after 60s; starting the heavy lanes anyway',
    );
    expect(a.polls).toHaveLength(4); // at 0, 15, 30 and 45 s; none at the deadline
  });

  test('it never waits past the most it may, even when a poll is longer', async () => {
    const a = admitCtx([5, 5], { admitWaitMaxSeconds: 10, loadPollSeconds: 60 });
    await admitHeavyLanes(a.ctx);
    expect(a.logs.at(-1)).toBe(
      'admission: still 5% idle after 10s; starting the heavy lanes anyway',
    );
    expect(a.polls).toEqual([5]); // no sample after the deadline
  });

  test('idle CPU that cannot be measured starts the heavy lanes, and says so', async () => {
    const first = admitCtx([null]);
    await admitHeavyLanes(first.ctx);
    expect(first.logs).toEqual([
      'admission: idle CPU could not be measured; starting the heavy lanes',
    ]);
    const later = admitCtx([5, null]);
    await admitHeavyLanes(later.ctx);
    expect(later.logs.at(-1)).toBe(
      'admission: idle CPU could not be measured; starting the heavy lanes',
    );
  });

  test('a threshold of 0 turns admission off without sampling', async () => {
    const a = admitCtx([1], { admitIdleMin: 0 });
    await admitHeavyLanes(a.ctx);
    expect(a.polls).toEqual([]);
  });

  const cpu = (idle: number, busy: number) =>
    ({ model: 'x', speed: 1, times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } }) as never;

  test('idle share between two CPU samples, or none when they cannot be compared', () => {
    expect(idlePercent([cpu(100, 100), cpu(100, 100)], [cpu(160, 140), cpu(130, 170)])).toBe(45);
    expect(idlePercent([cpu(1, 1)], [cpu(1, 1)])).toBeNull(); // no time passed
    expect(idlePercent([cpu(100, 100)], [cpu(160, 140), cpu(1, 1)])).toBeNull(); // CPUs changed
    expect(idlePercent([cpu(100, 100)], [cpu(50, 300)])).toBeNull(); // a counter went down
    expect(idlePercent([], [])).toBeNull();
  });

  test('a pair that cannot be compared is sampled again; none at all gives null', async () => {
    const reads = [[cpu(100, 100)], [cpu(50, 300)], [cpu(100, 100)], [cpu(150, 150)]];
    const waits: number[] = [];
    const wait = async (ms: number) => void waits.push(ms);
    expect(await sampleIdle(() => reads.shift() ?? [], wait, 7)).toBe(50);
    expect(waits).toEqual([7, 7]);
    expect(await sampleIdle(() => [cpu(1, 1)], wait, 7, 2)).toBeNull();
  });
});

describe('the checkout root and common dir', () => {
  test('a path holding a newline is read in one process each, not split', async () => {
    const root = mkdtempSync(join(tmpdir(), 'land-newline-'));
    const repo = join(root, 'a\nb');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q', repo]);
    const seed = {
      deps: { run: runProcess, env: process.env },
      config: DEFAULT_CONFIG,
    } as unknown as Ctx;
    const [top, common] = await rootAndCommonDir(seed, repo);
    expect(top).toBe(realpathSync(repo));
    expect(common).toBe(join(realpathSync(repo), '.git'));
    const plain = join(root, 'plain');
    mkdirSync(plain);
    execFileSync('git', ['init', '-q', plain]);
    expect(await rootAndCommonDir(seed, plain)).toEqual([
      realpathSync(plain),
      join(realpathSync(plain), '.git'),
    ]);
  });
});
