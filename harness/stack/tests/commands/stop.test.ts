import { describe, expect, test, vi } from 'vitest';

const runSpy = vi.fn<(...args: unknown[]) => Promise<number>>(async () => 0);

vi.mock('../../src/runtime/isolation.js', () => ({
  detectIsolation: () => ({
    worktreePath: '/wt',
    branch: 'main',
    slug: 'main',
    isoKey: 'iso',
    project: 'app-main',
    gitSha: null,
  }),
}));
vi.mock('../../src/runtime/exec.js', () => ({
  run: (...args: unknown[]) => runSpy(...args),
  captureSync: vi.fn(),
}));

const { stop } = await import('../../src/commands/stop.js');

describe('stop command', () => {
  test('invokes docker compose stop with project+compose-file', async () => {
    const code = await stop([]);
    expect(code).toBe(0);
    expect(runSpy).toHaveBeenCalledWith(
      'docker',
      ['compose', '-p', 'app-main', '-f', '/wt/.harness/iso.compose.yml', 'stop'],
      { cwd: '/wt' },
    );
  });
});
