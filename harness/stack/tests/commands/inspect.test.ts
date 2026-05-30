import { describe, expect, test, vi } from 'vitest';

const captureSyncSpy = vi.fn();

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
vi.mock('../../src/topology/ports.js', () => ({
  // PORT_SERVICES is re-exported by ../topology/index.js's `export *`;
  // partial mocks of barreled modules must include every original symbol or
  // vitest complains "No 'X' export defined on the mock".
  PORT_SERVICES: [
    'WEB_PORT',
    'API_PORT',
    'PG_PORT',
    'VL_PORT',
    'VM_PORT',
    'VT_PORT',
    'OTEL_OTLP_PORT',
    'API_RUST_PORT',
    'API_PY_PORT',
    'API_CPP_PORT',
  ] as const,
  allocatePorts: () => ({
    WEB_PORT: 5173,
    API_PORT: 3000,
    PG_PORT: 5432,
    VL_PORT: 9428,
    VM_PORT: 8428,
    VT_PORT: 10428,
    OTEL_OTLP_PORT: 4318,
  }),
}));
vi.mock('../../src/runtime/exec.js', () => ({
  run: vi.fn(),
  captureSync: (...args: unknown[]) => captureSyncSpy(...args),
}));

const { inspect } = await import('../../src/commands/inspect.js');

describe('inspect command', () => {
  test('prints port banner and includes docker ps status on success', async () => {
    captureSyncSpy.mockReturnValueOnce('[{"Name":"web","State":"running"}]');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await inspect([]);
    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => c[0]).join('\n');
    expect(out).toContain('Branch:           main');
    expect(out).toContain('Iso key:          iso');
    expect(out).toContain('Web:              http://localhost:5173');
    expect(out).toContain('VictoriaLogs:     http://localhost:9428');
    expect(out).toContain('OTEL Collector:   http://localhost:4318');
    expect(out).toContain('[{"Name":"web","State":"running"}]');
    log.mockRestore();
  });

  test('prints empty-stack hint when docker compose ps returns empty', async () => {
    captureSyncSpy.mockReturnValueOnce('');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await inspect([]);
    const out = log.mock.calls.map((c) => c[0]).join('\n');
    expect(out).toContain('(no compose file or stack not running)');
    log.mockRestore();
  });

  test('falls back to "not running" line when captureSync throws', async () => {
    captureSyncSpy.mockImplementationOnce(() => {
      throw new Error('compose missing');
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await inspect([]);
    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => c[0]).join('\n');
    expect(out).toContain('Status:           (stack not running)');
    log.mockRestore();
  });
});
