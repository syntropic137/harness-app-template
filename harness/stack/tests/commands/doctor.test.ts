import { beforeEach, describe, expect, test, vi } from 'vitest';

const tryCaptureSpy =
  vi.fn<(...args: unknown[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>>();
const existsSyncSpy = vi.fn<(...args: unknown[]) => boolean>(() => true);
const readdirSyncSpy = vi.fn<(...args: unknown[]) => string[]>();
const readFileSyncSpy = vi.fn<(...args: unknown[]) => string>();

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: (...args: unknown[]) => existsSyncSpy(...args),
    readdirSync: (...args: unknown[]) => readdirSyncSpy(...args),
    readFileSync: (...args: unknown[]) => readFileSyncSpy(...args),
  };
});

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
  run: vi.fn(),
  captureSync: vi.fn(),
  tryCapture: (...args: unknown[]) => tryCaptureSpy(...args),
}));

const { doctor, loadProbes, runCheck } = await import('../../src/commands/doctor.js');

function probeYaml(name: string, checks: Array<Record<string, unknown>>): string {
  const lines: string[] = [`name: ${name}`, `description: ${name} probe`, 'checks:'];
  for (const c of checks) {
    lines.push(`  - id: ${c['id']}`);
    lines.push(`    description: ${c['description'] ?? c['id']}`);
    lines.push(`    command: ${JSON.stringify(c['command'])}`);
    if (c['expect_stdout_contains'])
      lines.push(`    expect_stdout_contains: "${c['expect_stdout_contains']}"`);
    if (c['expect_stdout_match'])
      lines.push(`    expect_stdout_match: "${c['expect_stdout_match']}"`);
    if (c['platform']) lines.push(`    platform: ${c['platform']}`);
    if (c['expect_exit'] !== undefined) lines.push(`    expect_exit: ${c['expect_exit']}`);
    lines.push(`    remediation: "${c['remediation'] ?? 'fix it'}"`);
  }
  return lines.join('\n');
}

describe('doctor command', () => {
  beforeEach(() => {
    tryCaptureSpy.mockReset();
    existsSyncSpy.mockReset();
    existsSyncSpy.mockReturnValue(true);
    readdirSyncSpy.mockReset();
    readFileSyncSpy.mockReset();
  });

  test('runs a passing probe and exits 0', async () => {
    readdirSyncSpy.mockReturnValueOnce(['ok.yaml']);
    readFileSyncSpy.mockReturnValueOnce(
      probeYaml('ok', [{ id: 'c1', command: ['echo', 'hello'], expect_stdout_contains: 'hello' }]),
    );
    tryCaptureSpy.mockResolvedValueOnce({ exitCode: 0, stdout: 'hello\n', stderr: '' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await doctor([]);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  test('reports failing probe with remediation and exits 1', async () => {
    readdirSyncSpy.mockReturnValueOnce(['fail.yaml']);
    readFileSyncSpy.mockReturnValueOnce(
      probeYaml('fail', [
        { id: 'missing', command: ['nope'], expect_exit: 0, remediation: 'install nope' },
      ]),
    );
    tryCaptureSpy.mockResolvedValueOnce({ exitCode: 127, stdout: '', stderr: 'not found' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await doctor([]);
    expect(code).toBe(1);
    const out = log.mock.calls.map((c) => c[0]).join('\n');
    expect(out).toContain('install nope');
    log.mockRestore();
  });

  test('--json emits structured output', async () => {
    readdirSyncSpy.mockReturnValueOnce(['j.yaml']);
    readFileSyncSpy.mockReturnValueOnce(
      probeYaml('j', [{ id: 'c', command: ['echo'], expect_exit: 0 }]),
    );
    tryCaptureSpy.mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await doctor(['--json']);
    expect(code).toBe(0);
    const out = log.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(out);
    expect(parsed.overallExit).toBe(0);
    expect(parsed.probes[0].name).toBe('j');
    log.mockRestore();
  });

  test('filters by probe name', async () => {
    readdirSyncSpy.mockReturnValueOnce(['a.yaml', 'b.yaml']);
    readFileSyncSpy
      .mockReturnValueOnce(probeYaml('a', [{ id: 'x', command: ['echo'] }]))
      .mockReturnValueOnce(probeYaml('b', [{ id: 'y', command: ['echo'] }]));
    tryCaptureSpy.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await doctor(['b']);
    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => c[0]).join('\n');
    expect(out).toContain('b — b probe');
    expect(out).not.toContain('a — a probe');
    log.mockRestore();
  });

  test('errors on unknown probe filter', async () => {
    readdirSyncSpy.mockReturnValueOnce(['known.yaml']);
    readFileSyncSpy.mockReturnValueOnce(probeYaml('known', [{ id: 'x', command: ['echo'] }]));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await doctor(['unknown']);
    expect(code).toBe(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('No probes matched'));
    err.mockRestore();
  });

  test('--explain prints remediation without running checks', async () => {
    readdirSyncSpy.mockReturnValueOnce(['e.yaml']);
    readFileSyncSpy.mockReturnValueOnce(
      probeYaml('e', [{ id: 'target', command: ['echo'], remediation: 'do the thing' }]),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await doctor(['--explain', 'target']);
    expect(code).toBe(0);
    const out = log.mock.calls[0]?.[0] as string;
    expect(out).toContain('do the thing');
    expect(out).toContain('Probe: e');
    expect(tryCaptureSpy).not.toHaveBeenCalled();
    log.mockRestore();
  });

  test('--explain prints unknown-id when no match', async () => {
    readdirSyncSpy.mockReturnValueOnce(['e.yaml']);
    readFileSyncSpy.mockReturnValueOnce(probeYaml('e', [{ id: 'target', command: ['echo'] }]));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await doctor(['--explain', 'nope']);
    expect(code).toBe(0);
    expect(log.mock.calls[0]?.[0]).toContain('Unknown check id: nope');
    log.mockRestore();
  });

  test('skips checks not matching current platform', async () => {
    const result = await runCheck({
      id: 'linux-only',
      description: 'linux',
      command: ['echo'],
      expect_exit: 0,
      remediation: 'n/a',
      platform: process.platform === 'darwin' ? 'linux' : 'mac',
    });
    expect(result.status).toBe('skip');
    expect(result.skipReason).toContain('platform');
  });

  test('fails when stdout does not contain expected substring', async () => {
    tryCaptureSpy.mockResolvedValueOnce({ exitCode: 0, stdout: 'something else', stderr: '' });
    const result = await runCheck({
      id: 'sub',
      description: 'substring test',
      command: ['echo'],
      expect_stdout_contains: 'WANTED',
      expect_exit: 0,
      remediation: 'fix',
      platform: 'any',
    });
    expect(result.status).toBe('fail');
  });

  test('fails when stdout regex does not match', async () => {
    tryCaptureSpy.mockResolvedValueOnce({ exitCode: 0, stdout: 'mismatch', stderr: '' });
    const result = await runCheck({
      id: 'rx',
      description: 'regex test',
      command: ['echo'],
      expect_stdout_match: '^expected',
      expect_exit: 0,
      remediation: 'fix',
      platform: 'any',
    });
    expect(result.status).toBe('fail');
    expect(result.remediation).toBe('fix');
  });

  test('runs and prints skip reason in human output', async () => {
    readdirSyncSpy.mockReturnValueOnce(['s.yaml']);
    readFileSyncSpy.mockReturnValueOnce(
      probeYaml('s', [
        {
          id: 'wrong-os',
          command: ['echo'],
          platform: process.platform === 'darwin' ? 'linux' : 'mac',
          remediation: 'install other OS',
        },
      ]),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await doctor([]);
    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => c[0]).join('\n');
    expect(out).toContain('⊘');
    expect(out).toContain('platform');
    log.mockRestore();
  });

  test('runCheck fails defensively when command is empty', async () => {
    const result = await runCheck({
      id: 'empty',
      description: 'no command',
      command: [] as unknown as [string, ...string[]],
      expect_exit: 0,
      remediation: 'should not happen',
      platform: 'any',
    });
    expect(result.status).toBe('fail');
    expect(result.stderr).toBe('empty command');
    expect(result.remediation).toBe('should not happen');
  });

  test('returns success when no probe directory exists', async () => {
    existsSyncSpy.mockReturnValueOnce(false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await doctor([]);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith('No doctor probes configured.');
    log.mockRestore();
  });

  test('currentPlatform handles linux/win/fallback branches', async () => {
    const original = process.platform;
    tryCaptureSpy.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const cases: Array<[NodeJS.Platform, string]> = [
      ['linux', 'linux'],
      ['win32', 'win'],
      ['freebsd' as NodeJS.Platform, 'linux'],
    ];
    for (const [plat, expected] of cases) {
      Object.defineProperty(process, 'platform', { value: plat, configurable: true });
      const result = await runCheck({
        id: 'p',
        description: 'platform branch',
        command: ['echo'],
        platform: expected as 'mac' | 'linux' | 'win',
        expect_exit: 0,
        remediation: 'n/a',
      });
      // when expected matches current (just-stubbed), it runs the command
      // (we don't care about output, only that the branch is hit)
      expect(['pass', 'fail']).toContain(result.status);
    }
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  });

  test('loadProbes ignores files prefixed with underscore', async () => {
    readdirSyncSpy.mockReturnValueOnce(['_schema.yaml', 'real.yaml']);
    readFileSyncSpy.mockReturnValueOnce(probeYaml('real', [{ id: 'x', command: ['echo'] }]));
    const probes = loadProbes('/probes');
    expect(probes).toHaveLength(1);
    expect(probes[0]?.name).toBe('real');
  });

  test('loadProbes accepts .yml extension', async () => {
    readdirSyncSpy.mockReturnValueOnce(['alt.yml', 'ignored.txt']);
    readFileSyncSpy.mockReturnValueOnce(probeYaml('alt', [{ id: 'x', command: ['echo'] }]));
    const probes = loadProbes('/probes');
    expect(probes).toHaveLength(1);
    expect(probes[0]?.name).toBe('alt');
  });

  test('reports "(none)" when no probe files exist and a filter is given', async () => {
    readdirSyncSpy.mockReturnValueOnce([]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await doctor(['anything']);
    expect(code).toBe(1);
    expect(err.mock.calls[0]?.[0]).toContain('(none)');
    err.mockRestore();
  });
});
