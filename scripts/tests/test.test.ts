// Unit tests for scripts/test.ts: the two-step split (streaming turbo step vs
// captured script-coverage step) and the starved-runner retry on the latter.
import { describe, expect, test, vi } from 'vitest';
import type { ExecCaptureResult } from '../lib/exec-capture';
import { main, runScriptCoverage } from '../test';

const RETRY_MAX_WORKERS = '--maxWorkers=1';
const COVERAGE_ARGS = ['exec', 'vitest', 'run', 'scripts/tests', '--coverage'];

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

describe('runScriptCoverage', () => {
  test('a clean pass runs exactly once', async () => {
    const exec = vi.fn().mockResolvedValue(ok());
    const warn = vi.fn();
    await runScriptCoverage(COVERAGE_ARGS, { exec, warn, runInherit: vi.fn() });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test('a real failure (not the starved-runner signature) is thrown as-is, unretried', async () => {
    const exec = vi.fn().mockResolvedValue(fail(1, 'AssertionError: expected 1 to be 2'));
    const warn = vi.fn();
    await expect(
      runScriptCoverage(COVERAGE_ARGS, { exec, warn, runInherit: vi.fn() }),
    ).rejects.toThrow(/failed with exit code 1/);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test('a threshold miss plus the timeout string is a real failure, unretried', async () => {
    const output = `${STARVED_OUTPUT}\nERROR: Coverage for statements (99%) does not meet global threshold (100%)`;
    const exec = vi.fn().mockResolvedValue(fail(1, output));
    const warn = vi.fn();
    await expect(
      runScriptCoverage(COVERAGE_ARGS, { exec, warn, runInherit: vi.fn() }),
    ).rejects.toThrow();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test('the starved-runner signature retries once, serialized, and announces why', async () => {
    const exec = vi.fn().mockResolvedValueOnce(fail(1, STARVED_OUTPUT)).mockResolvedValueOnce(ok());
    const warn = vi.fn();
    await runScriptCoverage(COVERAGE_ARGS, { exec, warn, runInherit: vi.fn() });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[1][0]).toEqual([...COVERAGE_ARGS, RETRY_MAX_WORKERS]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('starved-runner');
  });

  test('an existing --maxWorkers flag is replaced rather than duplicated on the retry', async () => {
    const exec = vi.fn().mockResolvedValueOnce(fail(1, STARVED_OUTPUT)).mockResolvedValueOnce(ok());
    const warn = vi.fn();
    await runScriptCoverage([...COVERAGE_ARGS, '--maxWorkers=4'], {
      exec,
      warn,
      runInherit: vi.fn(),
    });
    expect(exec.mock.calls[1][0]).toEqual([...COVERAGE_ARGS, RETRY_MAX_WORKERS]);
  });

  test('a failing retry still fails, loudly', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(fail(1, STARVED_OUTPUT))
      .mockResolvedValueOnce(fail(1, 'still starved or something else entirely'));
    const warn = vi.fn();
    await expect(
      runScriptCoverage(COVERAGE_ARGS, { exec, warn, runInherit: vi.fn() }),
    ).rejects.toThrow(/after a starved-runner retry/);
    expect(exec).toHaveBeenCalledTimes(2);
  });
});

describe('test entrypoint', () => {
  test('the turbo step streams uncaptured and the script-coverage step is captured', async () => {
    const exec = vi.fn().mockResolvedValue(ok());
    const runInherit = vi.fn();
    await main(['--filter=...'], { exec, warn: vi.fn(), runInherit });
    expect(runInherit.mock.calls).toEqual([
      ['pnpm', ['turbo', 'run', 'test', '--concurrency=1', '--filter=...']],
    ]);
    expect(exec.mock.calls).toEqual([[COVERAGE_ARGS]]);
  });

  test('a bare invocation forwards no extra turbo argv', async () => {
    const exec = vi.fn().mockResolvedValue(ok());
    const runInherit = vi.fn();
    await main([], { exec, warn: vi.fn(), runInherit });
    expect(runInherit.mock.calls[0]?.[1]).toEqual(['turbo', 'run', 'test', '--concurrency=1']);
  });

  test('a starved-runner false red on the script-coverage step is retried, not reported red', async () => {
    const exec = vi.fn().mockResolvedValueOnce(fail(1, STARVED_OUTPUT)).mockResolvedValueOnce(ok());
    const warn = vi.fn();
    await main([], { exec, warn, runInherit: vi.fn() });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a real script-coverage failure aborts the run', async () => {
    const exec = vi.fn().mockResolvedValue(fail(1, 'Tests  1 failed | 5 passed (6)'));
    await expect(main([], { exec, warn: vi.fn(), runInherit: vi.fn() })).rejects.toThrow();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test('a failing turbo step aborts before the script-coverage step runs', async () => {
    const exec = vi.fn().mockResolvedValue(ok());
    const runInherit = vi.fn().mockImplementation(() => {
      throw new Error('pnpm turbo run test failed with 1');
    });
    await expect(main([], { exec, warn: vi.fn(), runInherit })).rejects.toThrow(/turbo/);
    expect(exec).not.toHaveBeenCalled();
  });
});
