import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { landHome, parseArgs, pidAlive, readBootId, USAGE } from '../land';
import { isMainEntry } from '../lib/entrypoint';
import { DEFAULT_CONFIG, type GateConfig, loadConfig, parseConfig } from '../lib/land/config';
import {
  excludedJobs,
  inheritEvidence,
  isLefthookGate,
  passedJobs,
  planGates,
  repoId,
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
        inheritUnaffectedEvidence: true,
        env: { A: 'b' },
        bootstrap: { run: 'x', when: ['ts'] },
        preflight: [{ name: 'p', run: 'true' }],
        checks: [{ name: 'c', run: 'true', cwd: 'source' }],
        gates: [{ name: 'g', run: 'true', when: ['x'] }],
        scopes: { x: ['a'] },
        full: ['f'],
      }),
    );
    const c = loadConfig(dir);
    expect(c.loadMax).toBe(10);
    expect(c.remote).toBe('up');
    expect(c.bootstrap).toEqual({ run: 'x', when: ['ts'] });
    expect(c.checks[0]?.cwd).toBe('source');
    expect(c.inheritUnaffectedEvidence).toBe(true);
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
    [{ checks: [{ name: 'a', run: 'x', cwd: 'z' }] }, /cwd/],
    [{ bootstrap: 1 }, /bootstrap needs/],
    [{ env: { a: 1 } }, /env must be/],
    [{ env: [] }, /env must be/],
    [{ inheritUnaffectedEvidence: 'y' }, /boolean/],
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

describe('engine helpers', () => {
  test('passedJobs reads the lefthook summary', () => {
    const out = '✔️ cov-ts (1.2 seconds)\n🥊 cov-rust\n  ✓ docs (0.1)\n✔ a-b (1)';
    expect([...passedJobs(out)].sort()).toEqual(['a-b', 'cov-ts', 'docs']);
    expect(passedJobs('✔️')).toEqual(new Set());
  });
  test('repoId is stable and path-sensitive', () => {
    expect(repoId('/a/.git', '/a')).toBe(repoId('/a/.git', '/a'));
    expect(repoId('/a/.git', '/a')).not.toBe(repoId('/b/.git', '/a'));
    expect(repoId('/a/.git', '/x/a')).toMatch(/^a-[0-9a-f]{10}$/);
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
      options: { ref: 'feat', mode: 'auto', message: null, dryRun: true, bootstrap: false },
    });
    expect(parseArgs(['x', '--mode', 'merge', '--message', 'hi'])).toMatchObject({ ok: true });
    expect(parseArgs(['--help'])).toEqual({ ok: false, message: USAGE, exitCode: 0 });
    expect(parseArgs(['-h'])).toMatchObject({ exitCode: 0 });
    for (const argv of [
      [],
      ['x', '--mode'],
      ['x', '--mode', '--dry-run'],
      ['x', '--mode', 'bogus'],
      ['x', '--nope'],
      ['x', 'y'],
      ['x', '--message', 'm'],
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
