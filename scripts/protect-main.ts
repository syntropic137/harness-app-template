import type { SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';
import { spawnSync as nodeSpawnSync } from 'node:child_process';
import { isMainEntry } from './lib/entrypoint';

// The full set of PR-time status check contexts that MUST pass before a PR
// can merge into `main`. Names are verbatim from `gh pr view <n> --json
// statusCheckRollup` so a fork that copies the workflows verbatim gets the
// same set of names. See ADR-0022-merge-gating.md for the rationale.
//
// `release` is intentionally absent: it runs only on `push` to `main` and on
// `workflow_dispatch`, so it shows up as SKIPPED on PR check rollups and
// would never be reportable as a required PR gate.
export const REQUIRED_PR_CONTEXTS: readonly string[] = Object.freeze([
  'check',
  'workspace qa (ubuntu-latest)',
  'workspace qa (macos-latest)',
  'scripts',
  'rust-coverage',
  'python-coverage',
  'documentation',
  'fitness',
  'fork-check',
  'dep-audit',
]);

export interface ProtectionBody {
  required_status_checks: {
    strict: boolean;
    contexts: string[];
  };
  enforce_admins: boolean;
  required_pull_request_reviews: null;
  restrictions: null;
  allow_force_pushes: boolean;
  allow_deletions: boolean;
  required_linear_history: boolean;
  required_conversation_resolution: boolean;
  block_creations: boolean;
  lock_branch: boolean;
  allow_fork_syncing: boolean;
}

// Build the PUT body for the branch-protection endpoint. The shape is the
// "compose every field" form so that re-applying overwrites operator drift
// rather than silently inheriting the prior value.
//
// Why these specific flags:
// - `strict: true` — the PR branch must be up to date with `main` at merge
//   time, so a passing check on a stale base does not unblock a merge.
// - `enforce_admins: false` — never lock the operator out of a hotfix path.
// - `required_pull_request_reviews: null` — the autonomous loop has no human
//   reviewer; requiring approvals would deadlock auto-merge. The required
//   status checks gate the merge instead.
// - `allow_force_pushes` / `allow_deletions: false` — main's history is
//   load-bearing; never let either side destroy it.
// - `required_linear_history` / `block_creations` / `lock_branch` / etc. left
//   off because they introduce constraints the workflow does not need.
export function buildProtectionBody(
  contexts: readonly string[] = REQUIRED_PR_CONTEXTS,
): ProtectionBody {
  return {
    required_status_checks: {
      strict: true,
      contexts: [...contexts],
    },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
    required_linear_history: false,
    required_conversation_resolution: false,
    block_creations: false,
    lock_branch: false,
    allow_fork_syncing: true,
  };
}

// Parse `owner/repo` from a `git remote get-url origin` URL. Accepts both
// the SSH (`git@github.com:owner/repo.git`) and HTTPS
// (`https://github.com/owner/repo.git`) forms. Returns null when the URL
// is not a GitHub remote; callers fall back to an explicit `--repo` arg.
export function parseGitHubRepo(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }
  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }
  return null;
}

export interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type SpawnFn = (command: string, args: string[], input?: string) => SpawnResult;

export interface ProtectMainDeps {
  spawn: SpawnFn;
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  exit: (code: number) => never;
  argv?: readonly string[];
  contexts?: readonly string[];
}

export interface ProtectMainResolved {
  repo: string;
  branch: string;
}

export function resolveTarget(
  argv: readonly string[],
  spawn: SpawnFn,
): ProtectMainResolved | { error: string } {
  let repo: string | null = null;
  let branch = 'main';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo' && i + 1 < argv.length) {
      repo = argv[i + 1] as string;
      i += 1;
    } else if (arg === '--branch' && i + 1 < argv.length) {
      branch = argv[i + 1] as string;
      i += 1;
    }
  }
  if (!repo) {
    const remote = spawn('git', ['remote', 'get-url', 'origin']);
    if (remote.status !== 0) {
      return {
        error: 'protect-main: --repo not provided and `git remote get-url origin` failed',
      };
    }
    repo = parseGitHubRepo(remote.stdout);
    if (!repo) {
      return {
        error: `protect-main: could not parse owner/repo from origin URL: ${remote.stdout.trim()}`,
      };
    }
  }
  return { repo, branch };
}

export function main(deps: ProtectMainDeps): void {
  const argv = deps.argv ?? [];
  const resolved = resolveTarget(argv, deps.spawn);
  if ('error' in resolved) {
    deps.stderr.error(resolved.error);
    deps.exit(1);
    return;
  }
  const { repo, branch } = resolved;
  const body = buildProtectionBody(deps.contexts ?? REQUIRED_PR_CONTEXTS);
  const payload = JSON.stringify(body);
  deps.stdout.log(
    `protect-main: applying branch protection to ${repo}@${branch} (${body.required_status_checks.contexts.length} required checks)`,
  );
  const result = deps.spawn(
    'gh',
    ['api', '-X', 'PUT', `repos/${repo}/branches/${branch}/protection`, '--input', '-'],
    payload,
  );
  if (result.status !== 0) {
    deps.stderr.error(`protect-main: gh api failed (status=${result.status})`);
    if (result.stderr) {
      deps.stderr.error(result.stderr.trimEnd());
    }
    deps.exit(result.status ?? 1);
    return;
  }
  deps.stdout.log(`protect-main: ok — ${body.required_status_checks.contexts.join(', ')}`);
}

/* v8 ignore start */
function defaultSpawn(command: string, args: string[], input?: string): SpawnResult {
  const options: SpawnSyncOptionsWithStringEncoding = {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  };
  const result: SpawnSyncReturns<string> = nodeSpawnSync(command, args, options);
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

if (isMainEntry(import.meta.url)) {
  main({
    spawn: defaultSpawn,
    stdout: console,
    stderr: console,
    exit: (code: number): never => process.exit(code),
    argv: process.argv.slice(2),
  });
}
/* v8 ignore stop */
