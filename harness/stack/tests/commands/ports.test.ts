import { describe, expect, test, vi } from 'vitest';

vi.mock('../../src/runtime/isolation.js', () => ({
  detectIsolation: () => ({
    worktreePath: '/wt',
    branch: 'main',
    slug: 'main',
    isoKey: 'abc12345',
    project: 'app-main',
    gitSha: null,
  }),
}));

vi.mock('../../src/topology/ports.js', () => ({
  PORT_SERVICES: ['WEB_PORT', 'API_PORT', 'PG_PORT'] as const,
  allocatePorts: () => ({ WEB_PORT: 5173, API_PORT: 3000, PG_PORT: 5432 }),
}));

// `ports` was collapsed into `inspect.ts` per the 2026-05-15 stack-runtime-
// topology-split refactor — same function, new home.
const { ports } = await import('../../src/commands/inspect.js');

describe('ports command', () => {
  test('prints KEY=VAL lines from allocatePorts and returns 0', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await ports([]);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith('WEB_PORT=5173');
    expect(log).toHaveBeenCalledWith('API_PORT=3000');
    expect(log).toHaveBeenCalledWith('PG_PORT=5432');
    log.mockRestore();
  });
});
