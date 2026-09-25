import { execFileSync } from 'node:child_process';
import { withoutAmbientGitEnv } from '../../lib/git';

/**
 * Git environment isolation for test fixtures (downstream bead dreamship-v0-2uzf).
 *
 * THE PROPERTY: a test fixture that runs git must not inherit the ambient git
 * environment. `cwd` is the only thing that decides which repository git
 * touches.
 *
 * Why this exists at all: git exports an absolute `GIT_DIR` into the
 * environment of `pre-commit`/`pre-push` hooks when -- and only when -- the
 * hook fires in a LINKED WORKTREE. lefthook passes it through to vitest, and
 * fixtures that shell out with `execFileSync('git', ..., { cwd })` inherit
 * `process.env`, so `GIT_DIR` silently overrode their `cwd` and every call --
 * `init`, `config`, `add`, `commit` -- ran against the real repository instead
 * of the temp dir. That is why it only ever happened during a gate run, only in
 * linked worktrees, why `mkdtempSync` looked correct, and why the worktree's
 * `user.email` kept flipping to a fixture value.
 *
 * The isolation is default-deny over the whole `GIT_*` family (see
 * `withoutAmbientGitEnv`), not a list of the names from that incident: a
 * named-variable fix would be blind to GIT_WORK_TREE, GIT_INDEX_FILE,
 * GIT_COMMON_DIR, GIT_CONFIG_GLOBAL, GIT_NAMESPACE and to whatever git adds
 * next. Fixtures keep NOTHING -- unlike the repo's own tooling they need no
 * ambient transport or authorship, because they only ever talk to local temp
 * repos whose identity they configure themselves.
 */
export function hermeticGitEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...(withoutAmbientGitEnv(process.env) as Record<string, string>),
    ...overrides,
  };
}

export interface FixtureGitOptions {
  /** The repository this call operates on. Omit only for path-positional
   *  commands such as `init --bare <path>` that name their target directly. */
  cwd?: string;
}

/**
 * Run one git command for a fixture: hermetic environment, and
 * `core.hooksPath=/dev/null` so a host-installed hook (lefthook, apss) never
 * fires inside a throwaway temp repo. Returns stdout.
 */
export function fixtureGit(args: string[], options: FixtureGitOptions = {}): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: options.cwd,
    env: hermeticGitEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * `fixtureGit`, but the exit status is the answer instead of an exception.
 * Needed to observe what a fixture's OWN git can see: some ambient leaks
 * (notably GIT_ALTERNATE_OBJECT_DIRECTORIES) grant read access without writing
 * anything, so they are invisible to any observer that does not share the
 * fixture's environment.
 */
export function fixtureGitSucceeds(args: string[], options: FixtureGitOptions = {}): boolean {
  try {
    fixtureGit(args, options);
    return true;
  } catch {
    return false;
  }
}
