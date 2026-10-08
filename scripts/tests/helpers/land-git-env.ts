import { execFileSync } from 'node:child_process';

/**
 * Environment for git fixtures: every ambient GIT_* variable is dropped so only
 * `cwd` decides which repository git touches. git exports GIT_DIR into hooks that
 * fire in a linked worktree, and the landing flow's tests run from exactly there.
 */
export function hermeticGitEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('GIT_')) env[key] = value;
  }
  return { ...env, ...overrides };
}

/** One git command in a fixture repo, with host hooks disabled. Returns stdout. */
export function fixtureGit(args: string[], options: { cwd?: string } = {}): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: options.cwd,
    env: hermeticGitEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
