// Contract tests for the dep-audit orchestrator (ADR-0023-dependency-audit.md).
//
// The orchestrator is pure-functional: it takes a spawn fn + filesystem
// adapter and returns lane-by-lane results, so every lane is tested by
// feeding canned exit codes through a recording spawn — no real pnpm /
// cargo / uv shells out. The contracts we lock down:
//
//   1. Each lane runs the documented command shape (so a future rename or
//      flag-change is caught by the test, not by a silent semantics drift).
//   2. PASS / FAIL / SKIP semantics: missing tooling fails CLOSED; missing
//      manifest is SKIP and does not contribute to the failure count.
//   3. The exit code is 1 iff any lane FAILed (SKIP does not block).
//   4. --only narrows execution to a single lane.
//   5. Rust + Python lanes iterate across the documented manifest list, so
//      adding a fourth manifest is a single-line change.

import { describe, expect, test, vi } from 'vitest';
import type { DepAuditDeps, FsLike, LaneResult, SpawnFn, SpawnResult } from '../dep-audit';
import {
  CARGO_MANIFESTS,
  main,
  PNPM_AUDIT_LEVEL,
  PYTHON_PROJECTS,
  parseArgs,
  runDepAudit,
  summarize,
} from '../dep-audit';

interface SpawnCall {
  cmd: string;
  args: string[];
  cwd?: string;
}

interface SpawnResponse extends SpawnResult {}

function mkSpawn(
  responses: Record<string, SpawnResponse>,
  calls: SpawnCall[],
  defaultResponse: SpawnResponse = { status: 0, stdout: '', stderr: '' },
): SpawnFn {
  return (cmd, args, options) => {
    calls.push({ cmd, args: [...args], cwd: options?.cwd });
    const key = `${cmd} ${[...args].join(' ')}`;
    if (key in responses) {
      return responses[key] as SpawnResponse;
    }
    const prefix = Object.keys(responses).find((k) => key.startsWith(k));
    if (prefix) return responses[prefix] as SpawnResponse;
    return defaultResponse;
  };
}

const TEST_CWD = '/repo';

function mkFs(present: readonly string[]): FsLike {
  const fullPaths = new Set(present.map((p) => (p.startsWith('/') ? p : `${TEST_CWD}/${p}`)));
  return {
    exists: (p: string): boolean => fullPaths.has(p),
    mkdirp: vi.fn(),
    rm: vi.fn(),
  };
}

function mkDeps(
  spawn: SpawnFn,
  fs: FsLike,
  argv: readonly string[] = [],
): {
  deps: DepAuditDeps;
  logs: string[];
  errors: string[];
  exitCode: number | null;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  let exitCode: number | null = null;
  const deps: DepAuditDeps = {
    spawn,
    fs,
    stdout: { log: (m: string) => logs.push(m) },
    stderr: { error: (m: string) => errors.push(m) },
    exit: vi.fn((code: number) => {
      exitCode = code;
      return undefined as never;
    }),
    cwd: '/repo',
    argv,
  };
  return {
    deps,
    logs,
    errors,
    get exitCode() {
      return exitCode;
    },
  };
}

describe('parseArgs', () => {
  test('returns only=null when --only is absent', () => {
    expect(parseArgs([])).toEqual({ only: null });
    expect(parseArgs(['--something-else'])).toEqual({ only: null });
  });

  test('parses --only js / rust / python', () => {
    expect(parseArgs(['--only', 'js']).only).toBe('js');
    expect(parseArgs(['--only', 'rust']).only).toBe('rust');
    expect(parseArgs(['--only', 'python']).only).toBe('python');
  });

  test('rejects unknown --only values silently (treated as no filter)', () => {
    expect(parseArgs(['--only', 'go']).only).toBeNull();
  });
});

describe('summarize', () => {
  test('counts pass/fail/skip across lane results', () => {
    const r: LaneResult[] = [
      { lane: 'a', status: 'pass', reason: '' },
      { lane: 'b', status: 'fail', reason: '' },
      { lane: 'c', status: 'skip', reason: '' },
      { lane: 'd', status: 'pass', reason: '' },
    ];
    expect(summarize(r)).toEqual({ passed: 2, failed: 1, skipped: 1 });
  });
});

describe('CARGO_MANIFESTS / PYTHON_PROJECTS', () => {
  test('cover both root workspaces and slot workspaces', () => {
    expect(CARGO_MANIFESTS).toContain('Cargo.toml');
    expect(CARGO_MANIFESTS).toContain('harness/doc-validator/Cargo.toml');
    expect(CARGO_MANIFESTS).toContain('harness/versioning/Cargo.toml');
  });

  test('python projects target the seed example', () => {
    expect(PYTHON_PROJECTS).toContain('ws_apps/example-python');
  });
});

describe('JS lane', () => {
  test('SKIPs when no package.json at repo root', () => {
    const calls: SpawnCall[] = [];
    const spawn = mkSpawn({}, calls);
    const fs = mkFs([]);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'js' },
      () => undefined,
      () => undefined,
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ lane: 'js', status: 'skip' });
    expect(calls.some((c) => c.cmd === 'pnpm')).toBe(false);
  });

  test('fails CLOSED when pnpm is not on PATH', () => {
    const calls: SpawnCall[] = [];
    const spawn = mkSpawn(
      {
        'sh -c command -v pnpm': { status: 1, stdout: '', stderr: '' },
      },
      calls,
    );
    const fs = mkFs(['package.json']);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'js' },
      () => undefined,
      () => undefined,
    );
    expect(results[0]).toMatchObject({ lane: 'js', status: 'fail', reason: 'pnpm missing' });
  });

  test('runs the documented pnpm audit command and PASSes on exit 0 (relays stdout/stderr)', () => {
    const calls: SpawnCall[] = [];
    const logs: string[] = [];
    const errs: string[] = [];
    const spawn = mkSpawn(
      {
        'sh -c command -v pnpm': { status: 0, stdout: '', stderr: '' },
        [`pnpm audit --audit-level=${PNPM_AUDIT_LEVEL} --prod`]: {
          status: 0,
          stdout: 'No known vulnerabilities found',
          stderr: 'audit notice on stderr',
        },
      },
      calls,
    );
    const fs = mkFs(['package.json']);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'js' },
      (m) => logs.push(m),
      (m) => errs.push(m),
    );
    expect(results[0]).toMatchObject({ lane: 'js', status: 'pass' });
    const pnpm = calls.find((c) => c.cmd === 'pnpm');
    expect(pnpm?.args).toEqual(['audit', `--audit-level=${PNPM_AUDIT_LEVEL}`, '--prod']);
    expect(pnpm?.cwd).toBe('/repo');
    expect(logs.some((l) => l.includes('No known vulnerabilities'))).toBe(true);
    expect(errs.some((l) => l.includes('audit notice on stderr'))).toBe(true);
  });

  test('FAILs on non-zero pnpm audit exit', () => {
    const calls: SpawnCall[] = [];
    const spawn = mkSpawn(
      {
        'sh -c command -v pnpm': { status: 0, stdout: '', stderr: '' },
        [`pnpm audit --audit-level=${PNPM_AUDIT_LEVEL} --prod`]: {
          status: 1,
          stdout: '1 vulnerability found',
          stderr: '',
        },
      },
      calls,
    );
    const fs = mkFs(['package.json']);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'js' },
      () => undefined,
      () => undefined,
    );
    expect(results[0]).toMatchObject({ lane: 'js', status: 'fail' });
  });
});

describe('Rust lane', () => {
  test('SKIPs when no Cargo.toml at root', () => {
    const calls: SpawnCall[] = [];
    const spawn = mkSpawn({}, calls);
    const fs = mkFs([]);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'rust' },
      () => undefined,
      () => undefined,
    );
    expect(results).toEqual([
      { lane: 'rust', status: 'skip', reason: 'no Cargo.toml at repo root' },
    ]);
  });

  test('fails CLOSED when cargo is not on PATH', () => {
    const calls: SpawnCall[] = [];
    const spawn = mkSpawn(
      {
        'sh -c command -v cargo': { status: 1, stdout: '', stderr: '' },
      },
      calls,
    );
    const fs = mkFs(['Cargo.toml']);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'rust' },
      () => undefined,
      () => undefined,
    );
    expect(results[0]).toMatchObject({ status: 'fail', reason: 'cargo missing' });
  });

  test('FAILs the manifest when cargo generate-lockfile errors', () => {
    const calls: SpawnCall[] = [];
    const spawn: SpawnFn = (cmd, args, options) => {
      calls.push({ cmd, args: [...args], cwd: options?.cwd });
      const key = `${cmd} ${[...args].join(' ')}`;
      if (key === 'sh -c command -v cargo' || key === 'sh -c command -v cargo-audit') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (cmd === 'cargo' && args[0] === 'generate-lockfile') {
        return { status: 101, stdout: '', stderr: 'manifest parse error' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const fs = mkFs([...CARGO_MANIFESTS]);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'rust' },
      () => undefined,
      () => undefined,
    );
    expect(results.every((r) => r.status === 'fail')).toBe(true);
    expect(results[0]?.reason).toMatch(/cargo generate-lockfile exited/);
    // cargo audit must NOT be invoked when generate-lockfile failed.
    expect(calls.find((c) => c.cmd === 'cargo' && c.args[0] === 'audit')).toBeUndefined();
  });

  test('fails CLOSED when cargo-audit is not on PATH', () => {
    const calls: SpawnCall[] = [];
    const spawn = mkSpawn(
      {
        'sh -c command -v cargo': { status: 0, stdout: '', stderr: '' },
        'sh -c command -v cargo-audit': { status: 1, stdout: '', stderr: '' },
      },
      calls,
    );
    const fs = mkFs(['Cargo.toml']);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'rust' },
      () => undefined,
      () => undefined,
    );
    expect(results[0]).toMatchObject({ status: 'fail', reason: 'cargo-audit missing' });
  });

  test('runs cargo audit per manifest and PASSes when all are clean (relays output)', () => {
    const calls: SpawnCall[] = [];
    const logs: string[] = [];
    const errs: string[] = [];
    const spawn: SpawnFn = (cmd, args, options) => {
      calls.push({ cmd, args: [...args], cwd: options?.cwd });
      const key = `${cmd} ${[...args].join(' ')}`;
      if (key === 'sh -c command -v cargo' || key === 'sh -c command -v cargo-audit') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (cmd === 'cargo' && args[0] === 'audit') {
        return { status: 0, stdout: 'no advisories', stderr: 'fetching db' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const fs = mkFs([...CARGO_MANIFESTS]);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'rust' },
      (m) => logs.push(m),
      (m) => errs.push(m),
    );
    expect(results).toHaveLength(CARGO_MANIFESTS.length);
    for (const r of results) {
      expect(r.status).toBe('pass');
    }
    // Verify we called both generate-lockfile and audit for the root manifest.
    expect(
      calls.some(
        (c) =>
          c.cmd === 'cargo' && c.args[0] === 'generate-lockfile' && c.args.includes('Cargo.toml'),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (c) =>
          c.cmd === 'cargo' &&
          c.args[0] === 'audit' &&
          c.args[1] === '--file' &&
          c.args[2] === 'Cargo.lock',
      ),
    ).toBe(true);
    expect(logs.some((l) => l.includes('no advisories'))).toBe(true);
    expect(errs.some((l) => l.includes('fetching db'))).toBe(true);
  });

  test('FAILs the offending manifest when cargo audit exits non-zero', () => {
    const calls: SpawnCall[] = [];
    const spawn: SpawnFn = (cmd, args, options) => {
      calls.push({ cmd, args: [...args], cwd: options?.cwd });
      const key = `${cmd} ${[...args].join(' ')}`;
      if (key === 'sh -c command -v cargo' || key === 'sh -c command -v cargo-audit') {
        return { status: 0, stdout: '', stderr: '' };
      }
      if (cmd === 'cargo' && args[0] === 'audit') {
        return { status: 1, stdout: 'advisory found', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const fs = mkFs([...CARGO_MANIFESTS]);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'rust' },
      () => undefined,
      () => undefined,
    );
    expect(results.every((r) => r.status === 'fail')).toBe(true);
  });

  test('SKIPs an individual manifest when its file is absent', () => {
    const calls: SpawnCall[] = [];
    const spawn = mkSpawn(
      {
        'sh -c command -v cargo': { status: 0, stdout: '', stderr: '' },
        'sh -c command -v cargo-audit': { status: 0, stdout: '', stderr: '' },
      },
      calls,
    );
    // Only the root manifest is present.
    const fs = mkFs(['Cargo.toml']);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'rust' },
      () => undefined,
      () => undefined,
    );
    const skipped = results.filter((r) => r.status === 'skip');
    const passed = results.filter((r) => r.status === 'pass');
    expect(skipped).toHaveLength(CARGO_MANIFESTS.length - 1);
    expect(passed).toHaveLength(1);
  });
});

describe('Python lane', () => {
  test('SKIPs when no pyproject.toml is found for any project', () => {
    const calls: SpawnCall[] = [];
    const spawn = mkSpawn({}, calls);
    const fs = mkFs([]);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'python' },
      () => undefined,
      () => undefined,
    );
    expect(results).toEqual([
      { lane: 'python', status: 'skip', reason: 'no Python projects found' },
    ]);
  });

  test('fails CLOSED when uv is not on PATH', () => {
    const calls: SpawnCall[] = [];
    const spawn = mkSpawn(
      {
        'sh -c command -v uv': { status: 1, stdout: '', stderr: '' },
      },
      calls,
    );
    const fs = mkFs(['ws_apps/example-python/pyproject.toml']);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'python' },
      () => undefined,
      () => undefined,
    );
    expect(results[0]).toMatchObject({ status: 'fail', reason: 'uv missing' });
  });

  test('exports requirements with uv and audits with uvx pip-audit (relays output)', () => {
    const calls: SpawnCall[] = [];
    const logs: string[] = [];
    const errs: string[] = [];
    const spawn: SpawnFn = (cmd, args, options) => {
      calls.push({ cmd, args: [...args], cwd: options?.cwd });
      const key = `${cmd} ${[...args].join(' ')}`;
      if (key === 'sh -c command -v uv') return { status: 0, stdout: '', stderr: '' };
      if (cmd === 'uvx') {
        return { status: 0, stdout: 'no vulnerabilities', stderr: 'pip-audit progress' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const fs = mkFs(['ws_apps/example-python/pyproject.toml']);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'python' },
      (m) => logs.push(m),
      (m) => errs.push(m),
    );
    expect(results.every((r) => r.status === 'pass')).toBe(true);
    const exportCall = calls.find((c) => c.cmd === 'uv' && c.args[0] === 'export');
    expect(exportCall?.args).toContain('--project');
    expect(exportCall?.args).toContain('ws_apps/example-python');
    expect(exportCall?.args).toContain('--no-dev');
    const auditCall = calls.find((c) => c.cmd === 'uvx');
    expect(auditCall?.args[0]).toBe('pip-audit');
    expect(auditCall?.args).toContain('-r');
    expect(logs.some((l) => l.includes('no vulnerabilities'))).toBe(true);
    expect(errs.some((l) => l.includes('pip-audit progress'))).toBe(true);
  });

  test('FAILs the project when pip-audit exits non-zero', () => {
    const calls: SpawnCall[] = [];
    const spawn: SpawnFn = (cmd, args, options) => {
      calls.push({ cmd, args: [...args], cwd: options?.cwd });
      const key = `${cmd} ${[...args].join(' ')}`;
      if (key === 'sh -c command -v uv') return { status: 0, stdout: '', stderr: '' };
      if (cmd === 'uvx') return { status: 1, stdout: 'vuln found', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    const fs = mkFs(['ws_apps/example-python/pyproject.toml']);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'python' },
      () => undefined,
      () => undefined,
    );
    expect(results[0]).toMatchObject({ status: 'fail' });
  });

  test('FAILs the project when uv export fails before pip-audit can run', () => {
    const calls: SpawnCall[] = [];
    const spawn: SpawnFn = (cmd, args, options) => {
      calls.push({ cmd, args: [...args], cwd: options?.cwd });
      const key = `${cmd} ${[...args].join(' ')}`;
      if (key === 'sh -c command -v uv') return { status: 0, stdout: '', stderr: '' };
      if (cmd === 'uv' && args[0] === 'export') {
        return { status: 2, stdout: '', stderr: 'export failed' };
      }
      return { status: 0, stdout: '', stderr: '' };
    };
    const fs = mkFs(['ws_apps/example-python/pyproject.toml']);
    const results = runDepAudit(
      { spawn, fs, cwd: '/repo' },
      { only: 'python' },
      () => undefined,
      () => undefined,
    );
    expect(results[0]).toMatchObject({ status: 'fail' });
    // pip-audit must NOT be invoked if the export failed.
    expect(calls.find((c) => c.cmd === 'uvx')).toBeUndefined();
  });
});

describe('main', () => {
  test('exits 0 when all lanes pass and no failures are reported', () => {
    const calls: SpawnCall[] = [];
    const spawn = mkSpawn(
      {
        'sh -c command -v pnpm': { status: 0, stdout: '', stderr: '' },
      },
      calls,
    );
    const fs = mkFs(['package.json']);
    const harness = mkDeps(spawn, fs, ['--only', 'js']);
    main(harness.deps);
    expect(harness.exitCode).toBe(0);
  });

  test('exits 1 when any lane fails', () => {
    const calls: SpawnCall[] = [];
    const spawn = mkSpawn(
      {
        'sh -c command -v pnpm': { status: 1, stdout: '', stderr: '' },
      },
      calls,
    );
    const fs = mkFs(['package.json']);
    const harness = mkDeps(spawn, fs, ['--only', 'js']);
    main(harness.deps);
    expect(harness.exitCode).toBe(1);
  });

  test('SKIP-only result still exits 0 (no manifest = no failure)', () => {
    const calls: SpawnCall[] = [];
    const spawn = mkSpawn({}, calls);
    const fs = mkFs([]);
    const harness = mkDeps(spawn, fs, ['--only', 'js']);
    main(harness.deps);
    expect(harness.exitCode).toBe(0);
  });

  test('defaults argv to [] when omitted', () => {
    const calls: SpawnCall[] = [];
    const spawn = mkSpawn({}, calls);
    const fs = mkFs([]);
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: number | null = null;
    const deps: DepAuditDeps = {
      spawn,
      fs,
      stdout: { log: (m: string) => logs.push(m) },
      stderr: { error: (m: string) => errors.push(m) },
      exit: vi.fn((code: number) => {
        exitCode = code;
        return undefined as never;
      }),
      cwd: '/repo',
      // argv intentionally omitted
    };
    main(deps);
    expect(exitCode).toBe(0);
    // With argv omitted, the orchestrator should run ALL lanes (and skip
    // them all because the temp fs has no manifests).
    expect(logs.some((l) => l.includes('js+rust+python'))).toBe(true);
  });
});
