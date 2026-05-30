import { execFileSync, spawnSync } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  allowFailure?: boolean;
}

export function git(args: string[], options: RunOptions = {}): string {
  try {
    return execFileSync('git', args, {
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
