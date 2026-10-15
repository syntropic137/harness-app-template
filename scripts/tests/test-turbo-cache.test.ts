// `just test` under a land retry: turbo replays its cache but writes nothing (ADR-0034 decision 9).
import { describe, expect, test, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[][]);
vi.mock('../lib/git', () => ({
  runInherit: (_command: string, args: string[]) => {
    calls.push(args);
  },
}));

describe('just test turbo cache mode', () => {
  test('only a land retry runs turbo read-only on its cache', async () => {
    const { turboCacheArgs } = await import('../test');
    expect(turboCacheArgs({ HARNESS_LAND_RETRY: '1' })).toEqual(['--cache=local:r']);
    expect(turboCacheArgs({})).toEqual([]);
    expect(turboCacheArgs({ HARNESS_LAND_RETRY: '0' })).toEqual([]);
  });

  test('main forwards the mode to turbo, and nothing on an ordinary run', async () => {
    const { main } = await import('../test');
    calls.length = 0;
    vi.stubEnv('HARNESS_LAND_RETRY', '1');
    main([]);
    vi.unstubAllEnvs();
    expect(calls[0]).toContain('--cache=local:r');
    calls.length = 0;
    vi.stubEnv('HARNESS_LAND_RETRY', '');
    main([]);
    vi.unstubAllEnvs();
    expect(calls[0]).not.toContain('--cache=local:r');
  });
});
