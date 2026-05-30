import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { captureSync } from './exec.js';

export interface IsolationInputs {
  worktreePath: string;
  branch: string;
}
export interface Isolation {
  worktreePath: string;
  branch: string;
  slug: string;
  isoKey: string;
  project: string;
  gitSha: string | null;
}

function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function computeIsolation(inputs: IsolationInputs, gitSha: string | null = null): Isolation {
  const slug = sanitize(`${basename(inputs.worktreePath)}--${inputs.branch}`);
  const isoKey = createHash('sha256')
    .update(`${inputs.worktreePath}::${inputs.branch}`)
    .digest('hex')
    .slice(0, 8);
  return {
    ...inputs,
    slug,
    isoKey,
    project: `harness_${slug}_${isoKey}`,
    gitSha,
  };
}

export function detectIsolation(cwd: string = process.cwd()): Isolation {
  const worktreePath = captureSync('git', ['rev-parse', '--show-toplevel'], cwd);
  const branch = captureSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  let gitSha: string | null = null;
  try {
    gitSha = captureSync('git', ['rev-parse', 'HEAD'], cwd);
    /* c8 ignore start -- defensive: in a totally-empty repo the prior
       `git rev-parse --abbrev-ref HEAD` already throws, so this catch is
       only reachable in rare corrupted-HEAD states. Phase E audit. */
  } catch {
    /* empty repo */
  }
  /* c8 ignore stop */
  return computeIsolation({ worktreePath, branch }, gitSha);
}
