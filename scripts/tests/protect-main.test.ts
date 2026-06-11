import { describe, expect, test, vi } from 'vitest';
import type { ProtectMainDeps, SpawnFn, SpawnResult } from '../protect-main';
import {
  buildProtectionBody,
  main,
  parseGitHubRepo,
  REQUIRED_PR_CONTEXTS,
  resolveTarget,
} from '../protect-main';

function mkSpawn(
  responses: Record<string, SpawnResult>,
  capture: { calls: { cmd: string; args: string[]; input?: string }[] },
): SpawnFn {
  return (cmd, args, input) => {
    capture.calls.push({ cmd, args, input });
    const key = `${cmd} ${args.join(' ')}`;
    const exact = responses[key];
    if (exact) {
      return exact;
    }
    const prefixMatch = Object.keys(responses).find((k) => key.startsWith(k));
    if (prefixMatch) {
      return responses[prefixMatch] as SpawnResult;
    }
    return { status: 0, stdout: '', stderr: '' };
  };
}

function mkDeps(
  spawn: SpawnFn,
  argv: readonly string[] = [],
  contexts?: readonly string[],
): {
  deps: ProtectMainDeps;
  logs: string[];
  errors: string[];
  exitCode: number | null;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  let exitCode: number | null = null;
  const deps: ProtectMainDeps = {
    spawn,
    stdout: { log: (msg: string) => logs.push(msg) },
    stderr: { error: (msg: string) => errors.push(msg) },
    exit: vi.fn((code: number) => {
      exitCode = code;
      return undefined as never;
    }),
    argv,
    contexts,
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

describe('REQUIRED_PR_CONTEXTS', () => {
  test('contains the eleven PR-time check contexts and excludes release', () => {
    const set = new Set(REQUIRED_PR_CONTEXTS);
    expect(REQUIRED_PR_CONTEXTS.length).toBe(11);
    expect(set.has('check')).toBe(true);
    expect(set.has('workspace qa (ubuntu-latest)')).toBe(true);
    expect(set.has('workspace qa (macos-latest)')).toBe(true);
    expect(set.has('scripts')).toBe(true);
    expect(set.has('rust-coverage')).toBe(true);
    expect(set.has('python-coverage')).toBe(true);
    expect(set.has('sensors-coverage')).toBe(true);
    expect(set.has('documentation')).toBe(true);
    expect(set.has('fitness')).toBe(true);
    expect(set.has('fork-check')).toBe(true);
    expect(set.has('dep-audit')).toBe(true);
    expect(set.has('release')).toBe(false);
  });
});

describe('buildProtectionBody', () => {
  test('returns a body that never requires approvals or locks the operator out', () => {
    const body = buildProtectionBody();
    expect(body.required_status_checks.strict).toBe(true);
    expect(body.required_status_checks.contexts).toEqual([...REQUIRED_PR_CONTEXTS]);
    expect(body.enforce_admins).toBe(false);
    expect(body.required_pull_request_reviews).toBeNull();
    expect(body.restrictions).toBeNull();
    expect(body.allow_force_pushes).toBe(false);
    expect(body.allow_deletions).toBe(false);
  });

  test('clones the context list so callers cannot mutate the input', () => {
    const input = ['only-check'];
    const body = buildProtectionBody(input);
    body.required_status_checks.contexts.push('mutated');
    expect(input).toEqual(['only-check']);
  });
});

describe('parseGitHubRepo', () => {
  test('parses SSH and HTTPS GitHub remote URLs and returns null otherwise', () => {
    expect(parseGitHubRepo('git@github.com:syntropic137/harness-app-template.git')).toBe(
      'syntropic137/harness-app-template',
    );
    expect(parseGitHubRepo('git@github.com:syntropic137/harness-app-template')).toBe(
      'syntropic137/harness-app-template',
    );
    expect(parseGitHubRepo('https://github.com/syntropic137/harness-app-template.git')).toBe(
      'syntropic137/harness-app-template',
    );
    expect(parseGitHubRepo('https://github.com/syntropic137/harness-app-template')).toBe(
      'syntropic137/harness-app-template',
    );
    expect(parseGitHubRepo('  https://github.com/owner/repo/  ')).toBe('owner/repo');
    expect(parseGitHubRepo('git@gitlab.com:owner/repo.git')).toBeNull();
    expect(parseGitHubRepo('not a url')).toBeNull();
  });
});

describe('resolveTarget', () => {
  test('uses --repo and --branch when provided without invoking git', () => {
    const calls: { cmd: string; args: string[]; input?: string }[] = [];
    const spawn = mkSpawn({}, { calls });
    const resolved = resolveTarget(['--repo', 'owner/x', '--branch', 'release'], spawn);
    expect(resolved).toEqual({ repo: 'owner/x', branch: 'release' });
    expect(calls).toHaveLength(0);
  });

  test('falls back to `git remote get-url origin` when --repo is absent', () => {
    const calls: { cmd: string; args: string[]; input?: string }[] = [];
    const spawn = mkSpawn(
      {
        'git remote get-url origin': {
          status: 0,
          stdout: 'git@github.com:owner/repo.git\n',
          stderr: '',
        },
      },
      { calls },
    );
    const resolved = resolveTarget([], spawn);
    expect(resolved).toEqual({ repo: 'owner/repo', branch: 'main' });
  });

  test('returns an error when git remote lookup fails', () => {
    const calls: { cmd: string; args: string[]; input?: string }[] = [];
    const spawn = mkSpawn(
      {
        'git remote get-url origin': { status: 128, stdout: '', stderr: 'no remote' },
      },
      { calls },
    );
    const resolved = resolveTarget([], spawn);
    expect(resolved).toHaveProperty('error');
  });

  test('returns an error when the remote URL is not a GitHub remote', () => {
    const calls: { cmd: string; args: string[]; input?: string }[] = [];
    const spawn = mkSpawn(
      {
        'git remote get-url origin': {
          status: 0,
          stdout: 'git@gitlab.com:owner/repo.git\n',
          stderr: '',
        },
      },
      { calls },
    );
    const resolved = resolveTarget([], spawn);
    expect(resolved).toHaveProperty('error');
  });
});

describe('main', () => {
  test('PUTs the protection body to the correct endpoint and exits 0 on success', () => {
    const calls: { cmd: string; args: string[]; input?: string }[] = [];
    const spawn = mkSpawn(
      {
        'gh api -X PUT repos/owner/repo/branches/main/protection --input -': {
          status: 0,
          stdout: '{"url":"..."}',
          stderr: '',
        },
      },
      { calls },
    );
    const harness = mkDeps(spawn, ['--repo', 'owner/repo']);
    main(harness.deps);
    expect(harness.exitCode).toBeNull();
    expect(harness.errors).toEqual([]);
    const ghCall = calls.find((c) => c.cmd === 'gh');
    expect(ghCall).toBeDefined();
    expect(ghCall?.args).toEqual([
      'api',
      '-X',
      'PUT',
      'repos/owner/repo/branches/main/protection',
      '--input',
      '-',
    ]);
    expect(ghCall?.input).toBe(JSON.stringify(buildProtectionBody()));
    expect(harness.logs.at(-1)).toContain('protect-main: ok');
  });

  test('honors a custom context override and a non-main branch', () => {
    const calls: { cmd: string; args: string[]; input?: string }[] = [];
    const spawn = mkSpawn(
      {
        'gh api -X PUT repos/owner/repo/branches/release/protection --input -': {
          status: 0,
          stdout: '{}',
          stderr: '',
        },
      },
      { calls },
    );
    const harness = mkDeps(spawn, ['--repo', 'owner/repo', '--branch', 'release'], ['only-one']);
    main(harness.deps);
    const ghCall = calls.find((c) => c.cmd === 'gh');
    expect(ghCall?.input).toBe(JSON.stringify(buildProtectionBody(['only-one'])));
  });

  test('reports the error and propagates the exit code when gh api fails', () => {
    const calls: { cmd: string; args: string[]; input?: string }[] = [];
    const spawn = mkSpawn(
      {
        'gh api -X PUT repos/owner/repo/branches/main/protection --input -': {
          status: 22,
          stdout: '',
          stderr: 'HTTP 401\n',
        },
      },
      { calls },
    );
    const harness = mkDeps(spawn, ['--repo', 'owner/repo']);
    main(harness.deps);
    expect(harness.exitCode).toBe(22);
    expect(harness.errors.some((m) => m.includes('protect-main: gh api failed'))).toBe(true);
    expect(harness.errors.some((m) => m.includes('HTTP 401'))).toBe(true);
  });

  test('uses exit code 1 when gh api returns a null status', () => {
    const calls: { cmd: string; args: string[]; input?: string }[] = [];
    const spawn = mkSpawn(
      {
        'gh api -X PUT repos/owner/repo/branches/main/protection --input -': {
          status: null,
          stdout: '',
          stderr: '',
        },
      },
      { calls },
    );
    const harness = mkDeps(spawn, ['--repo', 'owner/repo']);
    main(harness.deps);
    expect(harness.exitCode).toBe(1);
  });

  test('exits 1 when the target cannot be resolved', () => {
    const calls: { cmd: string; args: string[]; input?: string }[] = [];
    const spawn = mkSpawn(
      {
        'git remote get-url origin': { status: 128, stdout: '', stderr: 'no remote' },
      },
      { calls },
    );
    const harness = mkDeps(spawn, []);
    main(harness.deps);
    expect(harness.exitCode).toBe(1);
    expect(harness.errors[0]).toContain('protect-main:');
  });

  test('defaults argv to [] when not provided', () => {
    const calls: { cmd: string; args: string[]; input?: string }[] = [];
    const spawn = mkSpawn(
      {
        'git remote get-url origin': { status: 128, stdout: '', stderr: '' },
      },
      { calls },
    );
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: number | null = null;
    main({
      spawn,
      stdout: { log: (msg: string) => logs.push(msg) },
      stderr: { error: (msg: string) => errors.push(msg) },
      exit: (code: number) => {
        exitCode = code;
        return undefined as never;
      },
    });
    expect(exitCode).toBe(1);
  });
});
