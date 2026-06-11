import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { type CoverageDeps, main } from '../coverage';
import {
  COVERAGE_LANES,
  type CoverageCommand,
  commandsForLane,
  coverageTargetDir,
  isCoverageLane,
  SENSORS_COVERAGE_FLOOR,
} from '../lib/coverage';

const ROOT = '/repo';

function deps(overrides: Partial<CoverageDeps> = {}): CoverageDeps & {
  spawn: ReturnType<typeof vi.fn>;
  logs: string[];
  errors: string[];
} {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    spawn: vi.fn(() => ({ status: 0 })),
    stdout: { log: (line: string) => logs.push(line) },
    stderr: { error: (line: string) => errors.push(line) },
    exit: (code: number): never => {
      throw new Error(`exit ${code}`);
    },
    cwd: ROOT,
    logs,
    errors,
    ...overrides,
  } as never;
}

describe('lib/coverage lane definitions', () => {
  test('isCoverageLane accepts every declared lane and rejects others', () => {
    for (const lane of COVERAGE_LANES) {
      expect(isCoverageLane(lane)).toBe(true);
    }
    expect(isCoverageLane('go')).toBe(false);
    expect(isCoverageLane('')).toBe(false);
  });

  test('coverageTargetDir pins inside the repo root for worktree isolation', () => {
    expect(coverageTargetDir(ROOT)).toBe(join(ROOT, 'target', 'coverage-isolated'));
  });

  test('rust umbrella lane is the three per-crate lanes in order', () => {
    const rust = commandsForLane('rust', ROOT);
    expect(rust).toEqual([
      ...commandsForLane('example-rust', ROOT),
      ...commandsForLane('doc-validator', ROOT),
      ...commandsForLane('versioning', ROOT),
    ]);
  });

  test('example-rust enforces 100/100/100 with an isolated CARGO_TARGET_DIR', () => {
    const commands = commandsForLane('example-rust', ROOT);
    expect(commands).toHaveLength(1);
    const [cov] = commands as [CoverageCommand];
    expect(cov.command).toBe('cargo');
    expect(cov.args).toEqual([
      'llvm-cov',
      '--manifest-path',
      'ws_apps/example-rust/Cargo.toml',
      '--package',
      'example-rust',
      '--fail-under-lines',
      '100',
      '--fail-under-functions',
      '100',
      '--fail-under-regions',
      '100',
    ]);
    expect(cov.env).toEqual({ CARGO_TARGET_DIR: coverageTargetDir(ROOT) });
    expect(cov.cwd).toBeUndefined();
  });

  test.each([
    ['doc-validator', 'harness/doc-validator/Cargo.toml', 'harness-doc-validator'],
    ['versioning', 'harness/versioning/Cargo.toml', 'harness-versioning'],
  ] as const)('%s prebuilds its CLI shell then gates the library at 100', (lane, manifest, pkg) => {
    const commands = commandsForLane(lane, ROOT);
    expect(commands).toHaveLength(2);
    const [build, cov] = commands as [CoverageCommand, CoverageCommand];
    expect(build.command).toBe('cargo');
    expect(build.args).toEqual(['build', '--manifest-path', manifest, '--bin', pkg]);
    expect(build.env).toEqual({ CARGO_TARGET_DIR: coverageTargetDir(ROOT) });
    expect(cov.args).toEqual([
      'llvm-cov',
      '--manifest-path',
      manifest,
      '--package',
      pkg,
      '--lib',
      '--ignore-filename-regex',
      'main\\.rs',
      '--fail-under-lines',
      '100',
      '--fail-under-functions',
      '100',
    ]);
    expect(cov.env).toEqual({ CARGO_TARGET_DIR: coverageTargetDir(ROOT) });
  });

  test('py lane dispatches pytest through with-uv.sh from the app directory', () => {
    expect(commandsForLane('py', ROOT)).toEqual([
      {
        command: 'sh',
        args: ['scripts/with-uv.sh', 'uv', 'run', 'pytest'],
        cwd: 'ws_apps/example-python',
      },
    ]);
  });

  test('sensors lane gates the node:test suite at the measured floor', () => {
    const commands = commandsForLane('sensors', ROOT);
    expect(commands).toHaveLength(1);
    const [cov] = commands as [CoverageCommand];
    expect(cov.command).toBe('node');
    expect(cov.cwd).toBe('harness/sensors');
    expect(cov.env).toBeUndefined();
    expect(cov.args).toContain('--experimental-test-coverage');
    expect(cov.args).toContain(`--test-coverage-lines=${SENSORS_COVERAGE_FLOOR.lines}`);
    expect(cov.args).toContain(`--test-coverage-branches=${SENSORS_COVERAGE_FLOOR.branches}`);
    expect(cov.args).toContain(`--test-coverage-functions=${SENSORS_COVERAGE_FLOOR.functions}`);
    expect(cov.args).toContain('--test-coverage-exclude=tests/**');
    expect(cov.args).toContain('--test-coverage-exclude=fixtures/**');
    expect(cov.args.at(-1)).toBe('tests/*.test.mjs');
  });
});

describe('coverage entrypoint', () => {
  test('rejects a missing lane with usage and exit 64', () => {
    const d = deps();
    expect(() => main([], d)).toThrow('exit 64');
    expect(d.errors[0]).toContain('usage: coverage.ts');
    expect(d.spawn).not.toHaveBeenCalled();
  });

  test('rejects an unknown lane with usage and exit 64', () => {
    const d = deps();
    expect(() => main(['go'], d)).toThrow('exit 64');
    expect(d.spawn).not.toHaveBeenCalled();
  });

  test('runs every command of the lane from the repo root and logs each', () => {
    const d = deps();
    main(['rust'], d);
    const expected = commandsForLane('rust', ROOT);
    expect(d.spawn).toHaveBeenCalledTimes(expected.length);
    expected.forEach((cmd, index) => {
      const [command, args, options] = d.spawn.mock.calls[index] as [
        string,
        string[],
        { cwd: string; env: NodeJS.ProcessEnv; stdio: string },
      ];
      expect(command).toBe(cmd.command);
      expect(args).toEqual(cmd.args);
      expect(options.cwd).toBe(ROOT);
      expect(options.stdio).toBe('inherit');
      expect(options.env['CARGO_TARGET_DIR']).toBe(coverageTargetDir(ROOT));
      expect(d.logs[index]).toContain(`[cov:rust] ${cmd.command}`);
    });
  });

  test('resolves a lane cwd relative to the repo root and keeps process env', () => {
    const d = deps();
    main(['py'], d);
    const [, , options] = d.spawn.mock.calls[0] as [
      string,
      string[],
      { cwd: string; env: NodeJS.ProcessEnv },
    ];
    expect(options.cwd).toBe(join(ROOT, 'ws_apps/example-python'));
    expect(options.env).toBe(process.env);
  });

  test('defaults the repo root to process.cwd() when deps.cwd is absent', () => {
    const d = deps({ cwd: undefined });
    main(['sensors'], d);
    const [, , options] = d.spawn.mock.calls[0] as [string, string[], { cwd: string }];
    expect(options.cwd).toBe(join(process.cwd(), 'harness/sensors'));
  });

  test('stops at the first failing command and exits with its status', () => {
    const spawn = vi.fn().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 3 });
    const d = deps({ spawn: spawn as never });
    expect(() => main(['doc-validator'], d)).toThrow('exit 3');
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(d.errors[0]).toContain('[cov:doc-validator] FAIL');
  });

  test('treats a signal-killed command (null status) as exit 1', () => {
    const d = deps({ spawn: vi.fn(() => ({ status: null })) as never });
    expect(() => main(['sensors'], d)).toThrow('exit 1');
    expect(d.errors[0]).toContain('exited with signal');
  });

  test('reports the spawn error when the command cannot be executed at all', () => {
    const d = deps({
      spawn: vi.fn(() => ({ status: null, error: new Error('spawnSync node ENOENT') })) as never,
    });
    expect(() => main(['sensors'], d)).toThrow('exit 1');
    expect(d.errors[0]).toContain('failed to run (spawnSync node ENOENT)');
  });
});
