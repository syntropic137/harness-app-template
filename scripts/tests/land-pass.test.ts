import { describe, expect, test } from 'vitest';

import { parseConfig } from '../lib/land/config';
import type { RunResult } from '../lib/land/exec';
import {
  CONFIG_KEY_PATHS,
  configKeyFromLsTree,
  effectiveHooks,
  hooksKey,
  judgePass,
  LEFTHOOK_LOCAL_PATHS,
  LOCAL_PASSES,
  PASS_FORMAT,
  type PassFacts,
  type PassRecord,
  parsePass,
  passFetchRefspecs,
  remotePasses,
  requiredEvidence,
  summariseGates,
} from '../lib/land/pass';
import { porcelainOutcome } from '../lib/land/verified';

const sha = (c: string): string => c.repeat(40);

const CONFIG = parseConfig({
  scopes: { rust: ['**/*.rs'], docs: ['**/*.md'] },
  gates: [
    { name: 'cov-rust', when: ['rust'] },
    { name: 'doc-validator', when: ['docs'] },
    { name: 'adr' },
    { name: 'sensors', run: 'true', when: ['rust'] },
  ],
  earlyChecks: [{ name: 'host', run: 'true' }],
  checks: [{ name: 'baseline-drift', run: 'true' }],
});

const PASS: PassRecord = {
  format: PASS_FORMAT,
  ref_sha: sha('a'),
  C: sha('c'),
  B: sha('b'),
  mode: 'auto',
  message: null,
  config_key: 'k1',
  gates: [{ name: 'lefthook', seconds: 3, retried: false }],
  passed: ['adr', 'baseline-drift', 'cov-rust', 'host', 'sensors'],
  started: '2026-10-13T00:00:00.000Z',
  seconds: 12,
  host: 'h',
  engine_version: 'k1',
  hooks_key: 'h1',
};

const facts = (over: Partial<PassFacts> = {}): PassFacts => ({
  refSha: sha('a'),
  pass: PASS,
  main: sha('b'),
  mainConfigKey: 'k1',
  cConfigKey: 'k1',
  mainConfig: CONFIG,
  changed: ['crates/x.rs'],
  cExists: true,
  cOnMain: false,
  requested: { mode: 'auto', message: null },
  ...over,
});

const stale = (reason: RegExp) => ({ kind: 'stale', reason: expect.stringMatching(reason) });

describe('judgePass: when a pass lets land push without gates', () => {
  test('current, with exclusions derived from main config and the evidence, never the record', () => {
    expect(judgePass(facts())).toEqual({
      kind: 'current',
      pass: PASS,
      // adr and cov-rust: evidence on C; cov-ts absent, doc-validator inapplicable to a rust diff.
      exclude: ['adr', 'cov-rust', 'doc-validator'],
      config: CONFIG, // the fast path runs under main's validated config
    });
  });

  test('no record, a record for another ref, a missing C', () => {
    expect(judgePass(facts({ pass: null }))).toMatchObject(stale(/^no pass record for aaaa/));
    expect(judgePass(facts({ refSha: sha('d') }))).toMatchObject(stale(/pass record is for aaaa/));
    expect(judgePass(facts({ cExists: false }))).toMatchObject(stale(/missing from this repo/));
  });

  test('main moved since verify (B is not M) is stale', () => {
    expect(judgePass(facts({ main: sha('e') }))).toMatchObject(
      stale(/main moved since verify \(verified on bbbb.*main is eeee/),
    );
  });

  test('a land config change since verify is stale', () => {
    expect(judgePass(facts({ mainConfigKey: 'k2', cConfigKey: 'k2' }))).toMatchObject(
      stale(/^land config changed since verify$/),
    );
  });

  test('a pass verified by an engine or config that is not main is stale', () => {
    expect(judgePass(facts({ pass: { ...PASS, engine_version: 'weakened' } }))).toMatchObject(
      stale(/engine and config that ran the verification are not main's/),
    );
  });

  test('a land that asks for another --mode or --message than verify applied is stale', () => {
    expect(judgePass(facts({ requested: { mode: 'ff-only', message: null } }))).toMatchObject(
      stale(/verified with --mode auto; this land asks for --mode ff-only$/),
    );
    const merge = { ...PASS, mode: 'merge' as const, message: 'm1' };
    expect(
      judgePass(facts({ pass: merge, requested: { mode: 'merge', message: 'm2' } })),
    ).toMatchObject(
      stale(
        /verified with --mode merge and --message "m1"; this land asks for --mode merge and --message "m2"/,
      ),
    );
    expect(
      judgePass(facts({ pass: merge, requested: { mode: 'merge', message: 'm1' } })),
    ).toMatchObject({ kind: 'current' });
  });

  test("effectiveHooks keys lefthook's merged view and refuses remotes and non-JSON", () => {
    const a = effectiveHooks('{"pre-push":{"commands":{"a":{"run":"x"}}}}');
    const b = effectiveHooks('{\n  "pre-push": {"commands": {"a": {"run": "x"}}}\n}');
    const c = effectiveHooks('{"pre-push":{"commands":{"a":{"run":"true"}}}}');
    expect(a).toEqual(b); // the same config, however it is printed
    expect(a).not.toEqual(c);
    expect(effectiveHooks('{"extends":["x.yml"],"remotes":[]}')).toHaveProperty('config');
    // Script dirs: defaults, custom ones (trailing slash dropped), and ones outside the tree.
    expect(effectiveHooks('{}')).toMatchObject({
      sourceDir: '.lefthook',
      sourceDirLocal: '.lefthook-local',
    });
    expect(
      effectiveHooks('{"source_dir":"hook-scripts/","source_dir_local":"local/"}'),
    ).toMatchObject({ sourceDir: 'hook-scripts', sourceDirLocal: 'local' });
    for (const outside of ['/tmp/x', '../x', 'a/../../x', '/']) {
      for (const key of ['source_dir', 'source_dir_local']) {
        expect(effectiveHooks(JSON.stringify({ [key]: outside }))).toEqual({
          problem: 'a lefthook source_dir lies outside the repository, so a pass cannot bind it',
        });
      }
    }
    // The key changes with the config and with either script dir's tree.
    const base = effectiveHooks('{}') as Parameters<typeof hooksKey>[0];
    expect(hooksKey(base, 't1', 'absent')).toBe(hooksKey(base, 't1', 'absent'));
    expect(hooksKey(base, 't1', 'absent')).not.toBe(hooksKey(base, 't2', 'absent'));
    expect(hooksKey(base, 't1', 'absent')).not.toBe(hooksKey(base, 't1', 'l1'));
    expect(effectiveHooks('{"remotes":[{"git_url":"u"}]}')).toEqual({
      problem: 'the lefthook config uses remotes, whose fetched rules a pass cannot bind',
    });
    expect(effectiveHooks('pre-push:\n')).toEqual({ problem: 'lefthook dump did not print JSON' });
    for (const notObject of ['[]', 'null', '7']) {
      expect(effectiveHooks(notObject)).toEqual({
        problem: 'lefthook dump did not print a config object',
      });
    }
  });

  test('the config key covers every lefthook config and local override', () => {
    for (const path of [
      'lefthook.yml',
      'lefthook-local.yml',
      '.lefthook-local.toml',
      '.config/lefthook.json',
      '.lefthook',
      '.lefthook-local',
      'land.config.json',
    ]) {
      expect(CONFIG_KEY_PATHS).toContain(path);
    }
    expect(LEFTHOOK_LOCAL_PATHS).toContain('lefthook-local.yml');
    expect(LEFTHOOK_LOCAL_PATHS).toContain('.config/.lefthook-local.toml');
    expect(LEFTHOOK_LOCAL_PATHS).toContain('.lefthook-local');
    expect(LEFTHOOK_LOCAL_PATHS).not.toContain('lefthook.yml');
  });

  test('a ref that changes the land config itself never lands from a pass', () => {
    expect(judgePass(facts({ cConfigKey: 'k3' }))).toMatchObject(
      stale(/the ref changes the land config or engine/),
    );
  });

  test('an unreadable main config is stale', () => {
    expect(judgePass(facts({ mainConfig: 'not valid JSON' }))).toMatchObject(
      stale(/main's land config is unreadable: not valid JSON/),
    );
  });

  test('missing evidence for any applicable gate, early check or check is stale', () => {
    for (const name of ['cov-rust', 'adr', 'sensors', 'host', 'baseline-drift']) {
      const pass = { ...PASS, passed: PASS.passed.filter((p) => p !== name) };
      expect(judgePass(facts({ pass }))).toMatchObject(
        stale(new RegExp(`no evidence for: ${name}$`)),
      );
    }
    // An unreadable diff means every gate applies.
    expect(judgePass(facts({ changed: null }))).toMatchObject(
      stale(/no evidence for: doc-validator$/),
    );
  });

  test('C already on main is "landed", even though main has moved past B', () => {
    expect(judgePass(facts({ cOnMain: true, main: sha('c') }))).toEqual({
      kind: 'landed',
      pass: PASS,
    });
  });
});

describe('pass record helpers', () => {
  test('parsePass accepts a complete record and rejects absent, torn, foreign or incomplete ones', () => {
    expect(parsePass(JSON.stringify(PASS))).toEqual(PASS);
    expect(parsePass(null)).toBeNull();
    expect(parsePass('{"format":1,')).toBeNull();
    expect(parsePass('[]')).toBeNull();
    expect(parsePass('null')).toBeNull();
    expect(parsePass('42')).toBeNull();
    const broken: Record<string, unknown>[] = [
      { format: 99 },
      { C: 'not-a-sha' },
      { config_key: 7 },
      { passed: 'adr' },
      { passed: [1] },
      { gates: [{ name: 'x', seconds: -1, retried: false }] },
      { gates: [{ name: 'x', seconds: 1 }] },
      { gates: [null] },
      { engine_version: '' },
      { mode: 'rebase' },
      { message: 7 },
      { host: undefined },
    ];
    for (const change of broken) {
      expect(parsePass(JSON.stringify({ ...PASS, ...change }))).toBeNull();
    }
    for (const field of Object.keys(PASS)) {
      const { [field]: _dropped, ...rest } = PASS as unknown as Record<string, unknown>;
      expect(parsePass(JSON.stringify(rest))).toBeNull();
    }
  });

  test('requiredEvidence is the selected gates plus every early check and check', () => {
    expect(requiredEvidence(CONFIG, CONFIG.gates.slice(0, 1))).toEqual([
      'baseline-drift',
      'cov-rust',
      'host',
    ]);
  });

  test('summariseGates folds a -retry step into its gate', () => {
    expect(
      summariseGates([
        { name: 'lefthook', seconds: 3 },
        { name: 'test', seconds: 100 },
        { name: 'test-retry', seconds: 90 },
      ]),
    ).toEqual([
      { name: 'lefthook', seconds: 3, retried: false },
      { name: 'test', seconds: 190, retried: true },
    ]);
  });

  test('configKeyFromLsTree is order-insensitive and changes with any tree id', () => {
    const a = '100644 blob 111\tland.config.json\n040000 tree 222\tscripts/lib/land\n';
    const b = '040000 tree 222\tscripts/lib/land\n100644 blob 111\tland.config.json\n';
    expect(configKeyFromLsTree(a)).toBe(configKeyFromLsTree(b));
    expect(configKeyFromLsTree(a)).not.toBe(configKeyFromLsTree(a.replace('222', '333')));
  });

  test('a remote pass is fetched beside, never over, the local records', () => {
    expect(remotePasses('tower')).toEqual({
      verified: 'refs/land/pass-from/tower/verified/',
      notes: 'refs/notes/land-pass-from/tower',
    });
    expect(passFetchRefspecs('tower')).toEqual([
      '+refs/land/verified/*:refs/land/pass-from/tower/verified/*',
      '+refs/notes/land-pass:refs/notes/land-pass-from/tower',
    ]);
    expect(LOCAL_PASSES.notes).toBe('refs/notes/land-pass');
  });
});

describe('porcelainOutcome: when the push report is trusted without a confirm fetch', () => {
  const C = sha('c');
  const ok = (body: string, over: Partial<RunResult> = {}): RunResult => ({
    status: 0,
    signal: null,
    output: `To /remote.git\n${body}\nDone`,
    ...over,
  });
  const line = (flag: string, src = C): string =>
    `${flag}\t${src}:refs/heads/main\t${sha('b').slice(0, 7)}..${C.slice(0, 7)}`;

  test('a clean fast-forward, forced or new-ref report is "pushed"; "=" is "up-to-date"', () => {
    for (const flag of [' ', '+', '*'])
      expect(porcelainOutcome(ok(line(flag)), C, 'main')).toBe('pushed');
    expect(porcelainOutcome(ok(`=\t${C}:refs/heads/main\t[up to date]`), C, 'main')).toBe(
      'up-to-date',
    );
  });

  test('anything less than unambiguous is "unclear" and must be fetched', () => {
    const cases: RunResult[] = [
      ok(line(' '), { status: 1 }),
      ok(line(' '), { signal: 'SIGKILL', status: null }),
      { status: 0, signal: null, output: line(' ') }, // no Done
      ok(line('!')),
      ok(line(' ', sha('d'))), // another commit
      ok(`${line(' ')}\n${line(' ')}`), // two reports for the target
      ok('garbage'),
      ok(line(' ').replace('refs/heads/main', 'refs/heads/other')),
    ];
    for (const result of cases) expect(porcelainOutcome(result, C, 'main')).toBe('unclear');
  });
});
