import { execFileSync, spawnSync } from 'node:child_process';

/**
 * Git does not take its target repository from the process's cwd alone. It also
 * reads it out of the environment -- GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE,
 * GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY, GIT_ALTERNATE_OBJECT_DIRECTORIES,
 * GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, GIT_NAMESPACE, GIT_CEILING_DIRECTORIES,
 * ... -- and any one of them silently overrides `cwd`. That is not a fixed set:
 * git adds to it between releases.
 *
 * So the rule is default-deny over the whole `GIT_*` family, with an explicit
 * keep-list, rather than a blocklist of the names we happen to know today. An
 * enumerated blocklist encodes the last incident and is structurally blind to
 * the variable that causes the next one: downstream bead dreamship-v0-2uzf was exactly that
 * shape -- git exports an absolute GIT_DIR into pre-commit/pre-push hook
 * environments *only* in a linked worktree, lefthook passes it through to
 * vitest, and from there every fixture's carefully-scoped `cwd` stopped
 * deciding which repository git touched.
 */
const AMBIENT_GIT_ENV_PREFIX = 'GIT_';

/**
 * The only `GIT_*` variables a repo-scoped call keeps. Each says either HOW git
 * reaches a remote or WHO it commits as; none of them can re-target WHICH
 * repository git operates on, so passing them through cannot undermine `cwd`.
 * Anything not listed here -- including variables git has not shipped yet -- is
 * dropped. Callers that want total hermeticity pass an empty keep-set.
 */
const TRANSPORT_AND_IDENTITY_GIT_ENV = new Set([
  'GIT_ASKPASS',
  'GIT_AUTHOR_DATE',
  'GIT_AUTHOR_EMAIL',
  'GIT_AUTHOR_NAME',
  'GIT_COMMITTER_DATE',
  'GIT_COMMITTER_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_TERMINAL_PROMPT',
]);

export interface RunOptions {
  cwd?: string;
  allowFailure?: boolean;
}

/**
 * Strip the ambient git environment, keeping only what `keep` names.
 * The default keeps nothing: the caller's `cwd` becomes the single thing that
 * decides which repository git touches.
 */
export function withoutAmbientGitEnv(
  env: NodeJS.ProcessEnv = process.env,
  keep: ReadonlySet<string> = new Set<string>(),
): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(AMBIENT_GIT_ENV_PREFIX) && !keep.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * The repo-scoped variant used by this repo's own tooling: no inherited
 * variable may choose the repository, but transport and authorship still come
 * from the environment the operator (or CI) set up.
 */
export function withoutLocalGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return withoutAmbientGitEnv(env, TRANSPORT_AND_IDENTITY_GIT_ENV);
}

// `-c core.hooksPath=/dev/null` silences any host-installed hooks (e.g. apss's
// managed global pre-commit) so this helper's programmatic commits do not
// trigger interactive-grade host validation against directories the script
// is not responsible for. The Rust harness-versioning sibling does the same;
// callers that genuinely want host hooks should shell out to `git` directly.
const SUPPRESS_HOST_HOOKS_ARGS = ['-c', 'core.hooksPath=/dev/null'];

export function git(args: string[], options: RunOptions = {}): string {
  try {
    return execFileSync('git', [...SUPPRESS_HOST_HOOKS_ARGS, ...args], {
      cwd: options.cwd,
      env: withoutLocalGitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch (error) {
    if (options.allowFailure) {
      return '';
    }
    throw error;
  }
}

export function run(command: string, args: string[], options: RunOptions = {}): string {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch (error) {
    if (options.allowFailure) {
      return '';
    }
    throw error;
  }
}

export function runInherit(command: string, args: string[], cwd = process.cwd()): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
}

export function isGitRepo(cwd = process.cwd()): boolean {
  return git(['rev-parse', '--is-inside-work-tree'], { cwd, allowFailure: true }) === 'true';
}

export function shortSha(sha: string): string {
  return sha.slice(0, 12);
}
