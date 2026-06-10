import { execFileSync, spawnSync } from 'node:child_process';

const LOCAL_GIT_ENV_KEYS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_WORK_TREE',
];

export interface RunOptions {
  cwd?: string;
  allowFailure?: boolean;
}

export function withoutLocalGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean = { ...env };
  for (const key of LOCAL_GIT_ENV_KEYS) {
    delete clean[key];
  }
  return clean;
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
