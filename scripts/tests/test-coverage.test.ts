// Unit tests for scripts/test-coverage.ts: the coverage-scoping entrypoint
// wiring, the --maxWorkers cap, and the starved-runner retry.
import { describe, expect, test, vi } from 'vitest';
import type { ExecCaptureResult } from '../lib/exec-capture';
import {
  listUntrackedFiles,
  loadConfiguredExcludes,
  main,
  runCoverageTarget,
} from '../test-coverage';

const MAX_WORKERS = '--maxWorkers=2';
const RETRY_MAX_WORKERS = '--maxWorkers=1';

function ok(output = ''): ExecCaptureResult {
  return { status: 0, output };
}

function fail(status = 1, output = ''): ExecCaptureResult {
  return { status, output };
}

const STARVED_OUTPUT = `
 Test Files  69 passed (69)
      Tests  1250 passed (1250)
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
`;

function scopeDeps(overrides: Record<string, unknown> = {}) {
  const logs: string[] = [];
  return {
    logs,
    value: {
      listUntracked: () => [],
      loadExcludes: async () => [],
      log: (m: string) => logs.push(m),
      ...overrides,
    },
  };
}

describe('runCoverageTarget', () => {
  test('a clean pass runs exactly once', async () => {
    const exec = vi.fn().mockResolvedValue(ok());
    const warn = vi.fn();
    await runCoverageTarget(['run'], { exec, warn });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test('a real failure (not the starved-runner signature) is thrown as-is, unretried', async () => {
    const exec = vi.fn().mockResolvedValue(fail(1, 'AssertionError: expected 1 to be 2'));
    const warn = vi.fn();
    await expect(runCoverageTarget(['run'], { exec, warn })).rejects.toThrow(
      /failed with exit code 1/,
    );
    expect(exec).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test('a threshold miss plus the timeout string is a real failure, unretried', async () => {
    const output = `${STARVED_OUTPUT}\nERROR: Coverage for statements (99%) does not meet global threshold (100%)`;
    const exec = vi.fn().mockResolvedValue(fail(1, output));
    const warn = vi.fn();
    await expect(runCoverageTarget(['run'], { exec, warn })).rejects.toThrow();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test('the starved-runner signature retries once, serialized, and announces why', async () => {
    const exec = vi.fn().mockResolvedValueOnce(fail(1, STARVED_OUTPUT)).mockResolvedValueOnce(ok());
    const warn = vi.fn();
    await runCoverageTarget(['run', MAX_WORKERS], { exec, warn });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1][0]).toEqual(['run', RETRY_MAX_WORKERS]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('starved-runner');
  });

  test('a starved-runner signature with no existing --maxWorkers flag appends the serialized cap', async () => {
    const exec = vi.fn().mockResolvedValueOnce(fail(1, STARVED_OUTPUT)).mockResolvedValueOnce(ok());
    const warn = vi.fn();
    await runCoverageTarget(['run', 'vitest'], { exec, warn });
    expect(exec.mock.calls[1][0]).toEqual(['run', 'vitest', RETRY_MAX_WORKERS]);
  });

  test('a failing retry still fails, loudly', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(fail(1, STARVED_OUTPUT))
      .mockResolvedValueOnce(fail(1, 'still starved or something else entirely'));
    const warn = vi.fn();
    await expect(runCoverageTarget(['run', MAX_WORKERS], { exec, warn })).rejects.toThrow(
      /after a starved-runner retry/,
    );
    expect(exec).toHaveBeenCalledTimes(2);
  });
});

describe('cov-ts entrypoint', () => {
  const RUNS = [
    { dir: '', configPath: './vitest.config.ts', args: ['exec', 'vitest', 'run', '--coverage'] },
    {
      dir: 'harness/stack',
      configPath: './harness/stack/vitest.config.ts',
      args: ['--dir', 'harness/stack', 'exec', 'vitest', 'run', '--coverage'],
    },
  ];

  test('a clean tree adds no coverage-scoping flags to any target, and caps workers', async () => {
    const exec = vi.fn().mockResolvedValue(ok());
    const d = scopeDeps();
    await main([], RUNS, { ...d.value, exec, warn: vi.fn() });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0]?.[0]).toEqual(['exec', 'vitest', 'run', '--coverage', MAX_WORKERS]);
    expect(exec.mock.calls[1]?.[0]).toEqual([
      '--dir',
      'harness/stack',
      'exec',
      'vitest',
      'run',
      '--coverage',
      MAX_WORKERS,
    ]);
  });

  test('untracked files are scoped out of the target that owns them, and only that one', async () => {
    const exec = vi.fn().mockResolvedValue(ok());
    const d = scopeDeps({
      listUntracked: () => ['scripts/zz-scratch.ts'],
      loadExcludes: async () => ['scripts/tests/**/*.ts'],
    });
    await main([], RUNS, { ...d.value, exec, warn: vi.fn() });
    expect(exec.mock.calls[0]?.[0]).toContain('--coverage.exclude=scripts/zz-scratch.ts');
    expect(exec.mock.calls[0]?.[0]).toContain('--coverage.exclude=scripts/tests/**/*.ts');
    expect(exec.mock.calls[1]?.[0]).not.toContain('--coverage.exclude=scripts/zz-scratch.ts');
  });

  test('caller argv is appended after the scoping flags', async () => {
    const exec = vi.fn().mockResolvedValue(ok());
    await main(['--reporter=basic'], RUNS, { ...scopeDeps().value, exec, warn: vi.fn() });
    expect(exec.mock.calls[0]?.[0]?.at(-1)).toBe('--reporter=basic');
  });

  test('every target caps vitest worker fan-out so the reporter RPC is not starved', async () => {
    const exec = vi.fn().mockResolvedValue(ok());
    await main([], RUNS, { ...scopeDeps().value, exec, warn: vi.fn() });
    for (const call of exec.mock.calls) {
      expect(call[0]).toContain(MAX_WORKERS);
    }
  });

  test('an explicit --maxWorkers from the caller wins over the default cap', async () => {
    const exec = vi.fn().mockResolvedValue(ok());
    await main(['--maxWorkers=1'], RUNS, { ...scopeDeps().value, exec, warn: vi.fn() });
    for (const call of exec.mock.calls) {
      expect(call[0]).not.toContain(MAX_WORKERS);
      expect(call[0]).toContain('--maxWorkers=1');
    }
  });

  test('a starved-runner false red on one target retries that target and continues to the next', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(fail(1, STARVED_OUTPUT))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok());
    const warn = vi.fn();
    await main([], RUNS, { ...scopeDeps().value, exec, warn });
    expect(exec).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a real failure on a target aborts the whole run without touching later targets', async () => {
    const exec = vi.fn().mockResolvedValueOnce(fail(1, 'boom, a real assertion failure'));
    const warn = vi.fn();
    await expect(main([], RUNS, { ...scopeDeps().value, exec, warn })).rejects.toThrow();
    expect(exec).toHaveBeenCalledTimes(1);
  });
});

describe('cov-ts real IO helpers', () => {
  test('loadConfiguredExcludes reads the live root vitest config', async () => {
    // Resolution is against the repo root, not scripts/: a bare relative
    // specifier here would import scripts/vitest.config.ts and throw.
    const excludes = await loadConfiguredExcludes('./vitest.config.ts');
    expect(Array.isArray(excludes)).toBe(true);
  });

  test('loadConfiguredExcludes returns an empty list for a config with no exclusions', async () => {
    const excludes = await loadConfiguredExcludes('./ws_apps/example-typescript/vitest.config.ts');
    expect(excludes).toEqual([]);
  });

  test('listUntrackedFiles returns repo-relative paths and never a blank entry', () => {
    const files = listUntrackedFiles();
    expect(Array.isArray(files)).toBe(true);
    for (const f of files) {
      expect(f).not.toBe('');
      expect(f.startsWith('/')).toBe(false);
    }
  });
});
