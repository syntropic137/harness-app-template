// Real-subprocess tests for scripts/lib/exec-capture.ts. This module exists so
// scripts/test-coverage.ts can inspect what vitest actually printed (to run the
// starved-runner predicate) without losing live stdio for a human watching the
// gate -- so it is tested against real child processes, not mocks.
import { describe, expect, test } from 'vitest';
import { execCapture } from '../lib/exec-capture';

describe('execCapture', () => {
  test('captures combined stdout and stderr and reports the real exit code', async () => {
    const result = await execCapture('node', [
      '-e',
      "process.stdout.write('out-line\\n'); process.stderr.write('err-line\\n'); process.exit(7);",
    ]);
    expect(result.status).toBe(7);
    expect(result.output).toContain('out-line');
    expect(result.output).toContain('err-line');
  });

  test('a zero-status process is reported as status 0', async () => {
    const result = await execCapture('node', ['-e', "console.log('fine')"]);
    expect(result.status).toBe(0);
    expect(result.output).toContain('fine');
  });

  test('respects an explicit cwd', async () => {
    const result = await execCapture('node', ['-e', 'console.log(process.cwd())'], '/tmp');
    // macOS resolves /tmp through a symlink to /private/tmp; accept either.
    expect(result.output.trim()).toMatch(/\/tmp$/);
  });

  test('rejects when the command itself cannot be spawned', async () => {
    await expect(execCapture('definitely-not-a-real-binary-xyz', [])).rejects.toThrow();
  });

  test('a process killed by signal (null exit code) is reported as status 1', async () => {
    const result = await execCapture('node', ['-e', "process.kill(process.pid, 'SIGKILL');"]);
    expect(result.status).toBe(1);
  });
});
