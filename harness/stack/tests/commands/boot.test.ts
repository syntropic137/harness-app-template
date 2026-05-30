import { beforeEach, describe, expect, test, vi } from 'vitest';

const runSpy = vi.fn<(...args: unknown[]) => Promise<number>>(async () => 0);
const writeEnvSpy = vi.fn<(...args: unknown[]) => void>();
const mkdirSyncSpy = vi.fn<(...args: unknown[]) => void>();
const writeFileSyncSpy = vi.fn<(...args: unknown[]) => void>();
const existsSyncSpy = vi.fn<(...args: unknown[]) => boolean>(() => true);

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: (...args: unknown[]) => existsSyncSpy(...args),
    mkdirSync: (...args: unknown[]) => mkdirSyncSpy(...args),
    writeFileSync: (...args: unknown[]) => writeFileSyncSpy(...args),
  };
});
vi.mock('../../src/runtime/isolation.js', () => ({
  detectIsolation: () => ({
    worktreePath: '/wt',
    branch: 'feat/x',
    slug: 'feat-x',
    isoKey: 'iso',
    project: 'app-feat-x',
    gitSha: 'abc1234',
  }),
}));
vi.mock('../../src/topology/ports.js', () => ({
  allocatePorts: () => ({ WEB_PORT: 5173, API_PORT: 3000, PG_PORT: 5432 }),
}));
vi.mock('../../src/runtime/exec.js', () => ({
  run: (...args: unknown[]) => runSpy(...args),
  captureSync: vi.fn(),
}));
vi.mock('../../src/topology/env.js', () => ({
  writeEnvFile: (...args: unknown[]) => writeEnvSpy(...args),
}));
vi.mock('../../src/topology/compose.js', () => ({
  buildComposeYaml: () => 'services: {}\n',
}));
vi.mock('../../src/topology/config.js', () => ({
  defaultHarnessConfig: () => ({
    services: {},
    bugToggles: [],
  }),
  loadConfig: async () => ({
    services: {},
    database: { kind: 'postgres', name: 'mydb' },
  }),
}));

const { boot } = await import('../../src/commands/boot.js');

describe('boot command', () => {
  beforeEach(() => {
    runSpy.mockClear();
    writeEnvSpy.mockClear();
    mkdirSyncSpy.mockClear();
    writeFileSyncSpy.mockClear();
    existsSyncSpy.mockReset();
    existsSyncSpy.mockReturnValue(true);
  });

  test('writes env+compose files and shells out to docker compose up', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await boot([]);

    expect(code).toBe(0);
    expect(writeEnvSpy).toHaveBeenCalledTimes(1);
    const envVars = writeEnvSpy.mock.calls[0]?.[2] as Record<string, string | number>;
    expect(envVars['HARNESS_BRANCH']).toBe('feat/x');
    expect(envVars['HARNESS_ISO_KEY']).toBe('iso');
    expect(envVars['HARNESS_GIT_SHA']).toBe('abc1234');
    expect(envVars['DATABASE_URL']).toBe('postgres://harness:harness@postgres:5432/mydb');
    expect(envVars['WEB_PORT']).toBe(5173);

    expect(writeFileSyncSpy).toHaveBeenCalledWith(
      '/wt/.harness/iso.compose.yml',
      'services: {}\n',
      'utf8',
    );

    expect(runSpy).toHaveBeenCalledWith(
      'docker',
      [
        'compose',
        '-p',
        'app-feat-x',
        '-f',
        '/wt/.harness/iso.compose.yml',
        '--env-file',
        '/wt/.harness/iso.env',
        'up',
        '-d',
        '--build',
      ],
      { cwd: '/wt' },
    );
    log.mockRestore();
  });

  test('injects each --bug toggle as a `true` env var', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await boot(['--bug', 'BUG_COMPLETE_TASK_500', '--bug', 'BUG_DB_TIMEOUT']);

    const envVars = writeEnvSpy.mock.calls[0]?.[2] as Record<string, string | number>;
    expect(envVars['BUG_COMPLETE_TASK_500']).toBe('true');
    expect(envVars['BUG_DB_TIMEOUT']).toBe('true');
    log.mockRestore();
  });

  test('handles --bug with no value as a no-op', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await boot(['--bug']);

    const envVars = writeEnvSpy.mock.calls[0]?.[2] as Record<string, string | number>;
    // No bug toggles added — only the base env vars
    expect(Object.keys(envVars).filter((k) => k.startsWith('BUG_'))).toEqual([]);
    log.mockRestore();
  });

  test('uses "app" as DB name when config has no database', async () => {
    vi.resetModules();
    vi.doMock('../../src/topology/config.js', () => ({
      defaultHarnessConfig: () => ({ services: {}, bugToggles: [] }),
      loadConfig: async () => ({ services: {} }),
    }));
    const { boot: bootNoDb } = await import('../../src/commands/boot.js');
    writeEnvSpy.mockClear();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await bootNoDb([]);

    const envVars = writeEnvSpy.mock.calls[0]?.[2] as Record<string, string | number>;
    expect(envVars['DATABASE_URL']).toBe('postgres://harness:harness@postgres:5432/app');
    log.mockRestore();
  });

  test('boots from default config when harness.config.ts is absent', async () => {
    existsSyncSpy.mockReturnValue(false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await boot([]);

    const envVars = writeEnvSpy.mock.calls[0]?.[2] as Record<string, string | number>;
    expect(envVars['DATABASE_URL']).toBe('postgres://harness:harness@postgres:5432/app');
    log.mockRestore();
  });

  test('falls back to "unknown" git sha when isolation reports null', async () => {
    vi.resetModules();
    vi.doMock('../../src/runtime/isolation.js', () => ({
      detectIsolation: () => ({
        worktreePath: '/wt',
        branch: 'main',
        slug: 'main',
        isoKey: 'iso',
        project: 'app-main',
        gitSha: null,
      }),
    }));
    const { boot: bootNoSha } = await import('../../src/commands/boot.js');
    writeEnvSpy.mockClear();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await bootNoSha([]);

    const envVars = writeEnvSpy.mock.calls[0]?.[2] as Record<string, string | number>;
    expect(envVars['HARNESS_GIT_SHA']).toBe('unknown');
    log.mockRestore();
  });
});
