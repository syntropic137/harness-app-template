// Tests for harness/hooks/template-hygiene-gate.mjs. Lives under
// scripts/tests/ (not harness/hooks/tests/) so the gate sits in the
// ENFORCED vitest coverage path: vitest.config.ts includes the .mjs in its
// coverage list, and the 100 percent thresholds apply to it like any
// scripts/ module. The hook is dependency-injected (same pattern as
// scripts/bootstrap.ts) so every branch, including main(), the fail-closed
// git path, and the missing-tool path, is reachable without a real git
// repo or PATH mutation.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSteps,
  commandAvailable,
  determineChangedPaths,
  listHookScripts,
  main,
  parseChangedPaths,
  reportFailure,
  runStep,
  stagedTouchesHygieneSurface,
  // eslint-disable-next-line
  // @ts-expect-error plain .mjs module without type declarations
} from '../../harness/hooks/template-hygiene-gate.mjs';

interface FakeSpawnResult {
  status: number | null;
}

type SpawnFn = (cmd: string, args: string[], opts?: unknown) => FakeSpawnResult;
type ExecFileFn = (cmd: string, args: string[], opts?: unknown) => string;

interface Harness {
  deps: {
    spawn: SpawnFn;
    execFile: ExecFileFn;
    readdir: (dir: string) => string[];
    env: Record<string, string>;
    log: (msg: string) => void;
    exit: (code: number) => void;
    now: () => number;
  };
  logs: string[];
  exits: number[];
}

function makeHarness(overrides: Partial<Harness['deps']> = {}): Harness {
  const logs: string[] = [];
  const exits: number[] = [];
  let tick = 0;
  const deps: Harness['deps'] = {
    spawn: () => ({ status: 0 }),
    execFile: () => '',
    readdir: () => [],
    env: {},
    log: (msg) => {
      logs.push(msg);
    },
    exit: (code) => {
      exits.push(code);
    },
    now: () => {
      tick += 1000;
      return tick;
    },
    ...overrides,
  };
  return { deps, logs, exits };
}

describe('stagedTouchesHygieneSurface', () => {
  it('matches hygiene-critical exact files', () => {
    expect(stagedTouchesHygieneSurface(['lefthook.yml'])).toBe(true);
    expect(stagedTouchesHygieneSurface(['justfile'])).toBe(true);
    expect(stagedTouchesHygieneSurface(['scripts/init.ts'])).toBe(true);
    expect(stagedTouchesHygieneSurface(['scripts/update.ts'])).toBe(true);
    expect(stagedTouchesHygieneSurface(['scripts/bootstrap.ts'])).toBe(true);
  });

  it('matches hygiene-critical dir prefixes', () => {
    expect(stagedTouchesHygieneSurface(['harness/hooks/check-staged-size.mjs'])).toBe(true);
    expect(stagedTouchesHygieneSurface(['harness/hooks/tests/foo.test.mjs'])).toBe(true);
    expect(stagedTouchesHygieneSurface(['scripts/lib/vendor-links.ts'])).toBe(true);
  });

  it('ignores unrelated paths', () => {
    expect(stagedTouchesHygieneSurface(['README.md', 'docs/adrs/ADR-0001.md'])).toBe(false);
    expect(stagedTouchesHygieneSurface(['ws_apps/example-typescript/src/index.ts'])).toBe(false);
    expect(stagedTouchesHygieneSurface(['harness/sensors/gate.mjs'])).toBe(false);
  });

  it('treats exact files as full paths, not prefixes', () => {
    expect(stagedTouchesHygieneSurface(['scripts/inspector.ts'])).toBe(false);
    expect(stagedTouchesHygieneSurface(['scripts/tests/bootstrap.test.ts'])).toBe(false);
    expect(stagedTouchesHygieneSurface(['ws_apps/example-typescript/justfile'])).toBe(false);
  });

  it('handles empty and non-array input', () => {
    expect(stagedTouchesHygieneSurface([])).toBe(false);
    expect(stagedTouchesHygieneSurface(undefined)).toBe(false);
  });

  it('matches when at least one path is relevant', () => {
    expect(
      stagedTouchesHygieneSurface(['docs/foo.md', 'harness/hooks/track-perf.mjs', 'README.md']),
    ).toBe(true);
  });
});

describe('parseChangedPaths', () => {
  it('splits null-separated git output', () => {
    expect(parseChangedPaths('foo/bar.mjs\0baz/qux.md\0')).toEqual(['foo/bar.mjs', 'baz/qux.md']);
  });

  it('handles empty input', () => {
    expect(parseChangedPaths('')).toEqual([]);
  });

  it('filters empty trailing entries', () => {
    expect(parseChangedPaths('a\0\0b\0')).toEqual(['a', 'b']);
  });
});

describe('listHookScripts', () => {
  it('returns sorted repo-relative .mjs paths only', () => {
    const fakeReaddir = () => ['track-perf.mjs', 'README.md', 'check-staged-size.mjs', 'tests'];
    expect(listHookScripts('/repo/harness/hooks', fakeReaddir)).toEqual([
      join('harness', 'hooks', 'check-staged-size.mjs'),
      join('harness', 'hooks', 'track-perf.mjs'),
    ]);
  });

  it('reads the real hooks dir when no readdir is injected', () => {
    const scripts = listHookScripts(join(process.cwd(), 'harness', 'hooks'));
    expect(scripts).toContain(join('harness', 'hooks', 'template-hygiene-gate.mjs'));
  });
});

describe('determineChangedPaths', () => {
  it('honors the FORCE_CHANGED_PATHS override, trimming and dropping empties', () => {
    const { deps } = makeHarness({
      env: { HARNESS_HYGIENE_FORCE_CHANGED_PATHS: ' a.md , ,justfile ' },
      execFile: () => {
        throw new Error('git must not be called when the override is set');
      },
    });
    expect(determineChangedPaths('/repo', deps)).toEqual(['a.md', 'justfile']);
  });

  it('asks git for the staged set when no override is set', () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const { deps } = makeHarness({
      execFile: (cmd, args) => {
        calls.push({ cmd, args });
        return 'lefthook.yml\0docs/x.md\0';
      },
    });
    expect(determineChangedPaths('/repo', deps)).toEqual(['lefthook.yml', 'docs/x.md']);
    expect(calls).toEqual([{ cmd: 'git', args: ['diff', '--cached', '--name-only', '-z'] }]);
  });

  it('propagates a git failure instead of returning an empty list (fail closed)', () => {
    const { deps } = makeHarness({
      execFile: () => {
        throw new Error('not a git repository');
      },
    });
    expect(() => determineChangedPaths('/repo', deps)).toThrow('not a git repository');
  });
});

describe('commandAvailable', () => {
  it('is true when the version probe exits 0 and false otherwise', () => {
    expect(commandAvailable('pnpm', () => ({ status: 0 }))).toBe(true);
    expect(commandAvailable('pnpm', () => ({ status: 1 }))).toBe(false);
  });
});

describe('buildSteps', () => {
  it('builds lefthook-validate, justfile-parse, then one syntax-check per hook script', () => {
    const steps = buildSteps('/repo', () => ['b.mjs', 'a.mjs', 'README.md']);
    expect(steps.map((s: { label: string }) => s.label)).toEqual([
      'lefthook-validate',
      'justfile-parse',
      `syntax-check ${join('harness', 'hooks', 'a.mjs')}`,
      `syntax-check ${join('harness', 'hooks', 'b.mjs')}`,
    ]);
    expect(steps[0]).toMatchObject({ cmd: 'pnpm', args: ['exec', 'lefthook', 'validate'] });
    expect(steps[1]).toMatchObject({ cmd: 'just', args: ['--list'] });
    expect(steps[2]).toMatchObject({
      cmd: 'node',
      args: ['--check', join('harness', 'hooks', 'a.mjs')],
    });
  });

  it('reads the real hooks dir when no readdir is injected', () => {
    const labels = buildSteps(process.cwd()).map((s: { label: string }) => s.label);
    expect(labels).toContain(
      `syntax-check ${join('harness', 'hooks', 'template-hygiene-gate.mjs')}`,
    );
  });
});

describe('runStep', () => {
  const step = {
    label: 'justfile-parse',
    cmd: 'just',
    args: ['--list'],
    opts: { cwd: '/repo' },
  };

  it('fails closed with missingTool when the tool is not on PATH', () => {
    const { deps, logs } = makeHarness({ spawn: () => ({ status: 127 }) });
    expect(runStep(step, deps)).toMatchObject({ ok: false, missingTool: true, cmd: 'just' });
    expect(logs).toEqual([]);
  });

  it('returns ok and logs the invocation when the step passes', () => {
    const { deps, logs } = makeHarness();
    expect(runStep(step, deps)).toEqual({ ok: true });
    expect(logs).toEqual(['[hygiene] justfile-parse: just --list']);
  });

  it('propagates the exit status when the step fails', () => {
    const { deps } = makeHarness({
      spawn: (_cmd, args) => ({ status: args[0] === '--version' ? 0 : 2 }),
    });
    expect(runStep(step, deps)).toMatchObject({ ok: false, missingTool: false, status: 2 });
  });
});

describe('reportFailure', () => {
  it('emits the missing-tool block without a REPRO line', () => {
    const logs: string[] = [];
    reportFailure(
      { ok: false, missingTool: true, label: 'lefthook-validate', cmd: 'pnpm' },
      (m: string) => logs.push(m),
    );
    expect(logs.join('\n')).toContain('required tool "pnpm" is not on PATH');
    expect(logs.join('\n')).toContain('fails closed');
    expect(logs.join('\n')).not.toContain('REPRO');
    expect(logs.join('\n')).toContain('HARNESS_HYGIENE_SKIP=1');
  });

  it('emits the exit status and a REPRO line for a failed step', () => {
    const logs: string[] = [];
    reportFailure(
      {
        ok: false,
        missingTool: false,
        status: 1,
        label: 'justfile-parse',
        cmd: 'just',
        args: ['--list'],
        opts: { cwd: '/repo' },
      },
      (m: string) => logs.push(m),
    );
    expect(logs.join('\n')).toContain('FAIL at step "justfile-parse" (exit 1)');
    expect(logs.join('\n')).toContain('REPRO: cd /repo && just --list');
  });
});

describe('main', () => {
  function gitExecFile(stagedRaw: string): ExecFileFn {
    return (_cmd, args) => {
      if (args[0] === 'rev-parse') return '/repo\n';
      if (args[0] === 'diff') return stagedRaw;
      throw new Error(`unexpected execFile args: ${args.join(' ')}`);
    };
  }

  it('honors HARNESS_HYGIENE_SKIP=1 before touching git', () => {
    const { deps, logs, exits } = makeHarness({
      env: { HARNESS_HYGIENE_SKIP: '1' },
      execFile: () => {
        throw new Error('git must not be called under SKIP');
      },
    });
    main(deps);
    expect(exits).toEqual([0]);
    expect(logs.join('\n')).toContain('SKIPPED via HARNESS_HYGIENE_SKIP=1');
  });

  it('fails closed when git rev-parse errors', () => {
    const { deps, logs, exits } = makeHarness({
      execFile: () => {
        throw new Error('fatal: not a git repository');
      },
    });
    main(deps);
    expect(exits).toEqual([1]);
    expect(logs.join('\n')).toContain('cannot determine the staged path set');
    expect(logs.join('\n')).toContain('Failing closed');
  });

  it('fails closed when git diff errors after rev-parse succeeds', () => {
    const { deps, exits } = makeHarness({
      execFile: (_cmd, args) => {
        if (args[0] === 'rev-parse') return '/repo\n';
        throw new Error('index locked');
      },
    });
    main(deps);
    expect(exits).toEqual([1]);
  });

  it('short-circuits with exit 0 when no hygiene-relevant path is staged', () => {
    const { deps, logs, exits } = makeHarness({
      execFile: gitExecFile('docs/a.md\0README.md\0'),
      spawn: () => {
        throw new Error('no step may run on an irrelevant commit');
      },
    });
    main(deps);
    expect(exits).toEqual([0]);
    expect(logs.join('\n')).toContain('no hygiene-relevant changes staged (2 path(s) seen)');
  });

  it('runs every step and exits 0 under HARNESS_HYGIENE_FORCE=1', () => {
    const { deps, logs, exits } = makeHarness({
      env: { HARNESS_HYGIENE_FORCE: '1' },
      execFile: gitExecFile(''),
    });
    main(deps);
    expect(exits).toEqual([0]);
    const joined = logs.join('\n');
    expect(joined).toContain('structural validation (0 path(s))');
    expect(joined).toContain('lefthook-validate');
    expect(joined).toContain('justfile-parse');
    expect(joined).toContain('[hygiene] OK (1.00 s)');
  });

  it('exits 1 with a REPRO line when a step fails on a relevant commit', () => {
    const { deps, logs, exits } = makeHarness({
      execFile: gitExecFile('lefthook.yml\0'),
      spawn: (cmd, args) => {
        if (args[0] === '--version') return { status: 0 };
        return { status: cmd === 'pnpm' ? 3 : 0 };
      },
    });
    main(deps);
    expect(exits).toEqual([1]);
    expect(logs.join('\n')).toContain('FAIL at step "lefthook-validate" (exit 3)');
    expect(logs.join('\n')).toContain('REPRO: cd /repo && pnpm exec lefthook validate');
  });

  it('exits 1 when a required tool is missing on a relevant commit', () => {
    const { deps, logs, exits } = makeHarness({
      execFile: gitExecFile('justfile\0'),
      readdir: () => ['x.mjs'],
      spawn: (cmd) => ({ status: cmd === 'pnpm' ? 127 : 0 }),
    });
    main(deps);
    expect(exits).toEqual([1]);
    expect(logs.join('\n')).toContain('required tool "pnpm" is not on PATH');
  });
});
