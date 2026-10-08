import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROTECTED_REF, type PushRefLine, parsePushStdin, ZERO_SHA } from './guard-main-push';
import { isMainEntry } from './lib/entrypoint';
import { loadConfig } from './lib/land/config';

// Pre-push guard (bead ADR-0033): refuse a push on which lefthook has
// silently skipped every other pre-push job.
//
// THE MECHANISM (read from lefthook 1.13.6 -- the version bun.lock pins -- in
// internal/git/repository.go PushFiles and internal/run/controller/command/
// build_command.go, cross-checked against 2.1.10's internal/git/repo.go, then
// reproduced on a scratch repo + bare remote -- docs/agent-flywheel/push-scope-guard-proof.md):
//
//   For a pre-push `commands:` job, lefthook computes a push-file set and, if the set
//   is empty, skips the job with "(skip) no matching push files". This applies to
//   EVERY command, including ones that declare no files/glob filter at all, which is
//   how guard-main-push and vsa-validate get skipped. The set is
//       git diff --name-only HEAD @{push}
//   or, when @{push} does not resolve (detached HEAD, no upstream), `git diff
//   --name-only HEAD <X>` where X is the `origin/HEAD -> X` target from `git branch
//   --remotes` (the empty tree if there is none; 2.1.10 reads the same target from
//   refs/remotes/origin/HEAD and falls back to `ls-tree -r HEAD`, the same file list) -- in all cases with every path that
//   does not exist ON DISK dropped. It is computed from the LOCAL checkout. The refs git
//   is actually pushing (the stdin ref lines) never enter into it.
//
//   So the set is empty -- and all 15 jobs skip in seconds, exit 0 -- whenever
//   tree(HEAD) matches the comparison ref, whatever is being sent. Reproduced shapes:
//     - on main, `git push origin feat:main`: remote main updated, guard-main-push skipped
//     - detached at origin/main, pushing any other commit to any ref
//     - a commit whose only change is a deletion (the path fails the existence filter)
//     - a message-only amend, force-pushed (identical tree; harmless, see below)
//   "force-push" and "detached HEAD" are neither necessary nor sufficient.
//
// WHY THIS IS A `scripts:` ENTRY AND NOT A `commands:` ENTRY. lefthook's push-file skip
// is applied in buildCommand only; buildScript has no such check (in 2.1.10 a script
// skips only on an empty `{files}`-style placeholder, and this entry has none). A `commands:` guard
// would be skipped by the very defect it exists to catch. The lefthook.yml entry is
// `.lefthook/pre-push/push-scope-guard.sh`, a one-line shim onto this file.
//
// THE RULE. Replicate lefthook's set. If it is non-empty, the other jobs were armed:
// pass. If it is empty, pass ONLY if the push genuinely sends nothing the remote lacks
// (same tree as the remote tip, a new ref at a commit the remote already has, or a
// non-main branch deletion). Anything else -- including anything we cannot determine --
// is refused. Unknown scope is the unsafe case, the same shape as
// scripts/affected-task-scope.sh and scripts/measured.sh.
//
// WHAT THIS IS NOT. It does not make lefthook's jobs check the pushed ref instead of
// HEAD; when the set is non-empty the jobs run against HEAD as they always have. And,
// like guard-main-push, it is a default-closer: `--no-verify` still skips it.

export const BEAD = 'ADR-0033';

/** git's well-known empty tree; lefthook diffs against it when there is no origin/HEAD. */
export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** lefthook's own regex for the default-branch line of `git branch --remotes`. */
const HEAD_BRANCH_RE = /HEAD -> (.*)$/;

export type GitRunner = (args: string[]) => { status: number; stdout: string };

export interface ScopeDeps {
  /** Ref the land flow protects; defaults to PROTECTED_REF. */
  protectedRef?: string;
  /** lefthook's push-file set, or null when it cannot be computed. */
  lefthookPushFiles: () => string[] | null;
  /** Whether a ref line sends content the remote lacks; null when unknown. */
  carriesContent: (ref: PushRefLine, remote: string) => boolean | null;
}

export interface ScopeResult {
  ok: boolean;
  message: string;
}

/** Paths from `git diff -z`: NUL-separated and never C-quoted, so a non-ASCII or
 * otherwise unusual path comes back exactly as lefthook's strconv.Unquote yields it. */
function nulPaths(stdout: string): string[] {
  return stdout.split('\0').filter((p) => p !== '');
}

/** Replica of lefthook 1.13 `Repository.PushFiles`: the set whose emptiness makes
 * lefthook skip every pre-push command. Returns null where lefthook itself would error
 * (it fails the job in that case rather than skipping, so null is never "empty"). */
export function lefthookPushFiles(
  git: GitRunner,
  isFile: (repoRelativePath: string) => boolean,
): string[] | null {
  let diff = git(['diff', '--name-only', '-z', 'HEAD', '@{push}']);
  if (diff.status !== 0) {
    const remotes = git(['branch', '--remotes']);
    if (remotes.status !== 0) {
      return null;
    }
    let base = EMPTY_TREE_SHA;
    for (const line of remotes.stdout.split('\n')) {
      const match = line.match(HEAD_BRANCH_RE);
      if (match) {
        base = match[1] as string;
        break;
      }
    }
    diff = git(['diff', '--name-only', '-z', 'HEAD', base]);
    if (diff.status !== 0) {
      return null;
    }
  }
  return nulPaths(diff.stdout).filter(isFile);
}

/** Does this pushed ref send anything the remote does not already have?
 *  true = yes, false = genuinely nothing, null = cannot tell (treated as yes). */
export function refCarriesContent(
  git: GitRunner,
  ref: PushRefLine,
  remote: string,
  protectedRef: string = PROTECTED_REF,
): boolean | null {
  if (ref.localSha === ZERO_SHA) {
    // A deletion sends no content. Deleting main is still something guard-main-push
    // exists to refuse, and it did not run -- so it counts.
    return ref.remoteRef === protectedRef;
  }
  if (ref.remoteSha !== ZERO_SHA) {
    if (git(['cat-file', '-e', `${ref.remoteSha}^{commit}`]).status !== 0) {
      return null;
    }
    // Tree-to-tree: a message-only rewrite sends identical content and is not gated
    // content; a rewind or a divergent force-push lists what it changes.
    const diff = git(['diff', '--quiet', ref.remoteSha, ref.localSha]);
    return diff.status === 0 ? false : diff.status === 1 ? true : null;
  }
  // A new ref: does it reach commits the remote's tracking refs do not? A remote given
  // as a URL has no tracking refs, so everything counts -- fail closed.
  const count = git(['rev-list', '--count', ref.localSha, '--not', `--remotes=${remote}`]);
  if (count.status !== 0) {
    return null;
  }
  return Number.parseInt(count.stdout.trim(), 10) > 0;
}

function describeRef(ref: PushRefLine): string {
  return `${ref.localRef} (${ref.localSha.slice(0, 12)}) -> ${ref.remoteRef}`;
}

const REMEDY = `  lefthook computes its pre-push file set from HEAD vs @{push} (or origin/HEAD when
  HEAD is detached), never from what is being pushed. When that set is empty it
  skips EVERY other pre-push job -- guard-main-push and vsa-validate included -- with
  "(skip) no matching push files", and exits 0.

  To push with the gates armed, make HEAD the commit you are sending:
      git switch --detach <commit> && git push <remote> HEAD:<ref>
  (lefthook then diffs it against origin's default branch). For main, use
      just land <branch-or-ref>
  Bead ${BEAD}. A conscious bypass (--no-verify) still skips this guard.`;

/** lefthook skipped everything: allowed only if the push sends nothing the remote lacks. */
function emptySetVerdict(refs: PushRefLine[], remote: string, deps: ScopeDeps): ScopeResult {
  const carrying: string[] = [];
  const unknown: string[] = [];
  for (const ref of refs) {
    const carries = deps.carriesContent(ref, remote);
    if (carries === null) unknown.push(describeRef(ref));
    else if (carries) carrying.push(describeRef(ref));
  }
  if (carrying.length === 0 && unknown.length === 0) {
    return {
      ok: true,
      message:
        `push-scope-guard: lefthook push-file set is EMPTY, so every other pre-push job skipped; ` +
        `allowed because this push sends nothing the remote lacks (${refs.length} ref(s)).`,
    };
  }
  const detail = [
    ...carrying.map((r) => `    sends content the remote lacks: ${r}`),
    ...unknown.map((r) => `    could not determine what this sends: ${r}`),
  ].join('\n');
  return {
    ok: false,
    message:
      'push-scope-guard: REFUSING. lefthook reported "no matching push files" for every ' +
      'pre-push job, but this push is not empty:\n' +
      `${detail}\n${REMEDY}`,
  };
}

/** Decide whether a push may proceed. Pure: all IO is injected via deps. */
export function evaluatePushScope(
  refs: PushRefLine[],
  remote: string,
  deps: ScopeDeps,
): ScopeResult {
  if (refs.length === 0) {
    return {
      ok: false,
      message:
        'push-scope-guard: no parseable push refs on stdin; failing closed. ' +
        'If the lefthook `use_stdin` wiring is broken, fix it.',
    };
  }
  const files = deps.lefthookPushFiles();
  if (files === null) {
    return {
      ok: false,
      message: `push-scope-guard: REFUSING. could not compute lefthook's push-file set, so it is unknown whether the other pre-push jobs ran.\n${REMEDY}`,
    };
  }
  if (files.length > 0) {
    const noun = files.length === 1 ? 'file' : 'files';
    return {
      ok: true,
      message: `push-scope-guard: lefthook push-file set has ${files.length} ${noun}; the pre-push jobs were armed.`,
    };
  }
  return emptySetVerdict(refs, remote, deps);
}

export interface ScopeIoDeps extends ScopeDeps {
  stdin: string;
  /** git's pre-push arguments: <remote-name> <remote-url>. */
  argv: readonly string[];
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
}

export function runPushScopeGuard(deps: ScopeIoDeps): number {
  const result = evaluatePushScope(parsePushStdin(deps.stdin), deps.argv[0] ?? '', deps);
  if (result.ok) {
    deps.stdout.log(result.message);
    return 0;
  }
  deps.stderr.error(`✗ ${result.message}`);
  return 1;
}

/* v8 ignore start */
function realGit(args: string[]): { status: number; stdout: string } {
  const r = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return { status: r.status ?? 1, stdout: r.stdout ?? '' };
}

function realIsFile(rel: string): boolean {
  try {
    return statSync(join(process.cwd(), rel)).isFile();
  } catch {
    return false;
  }
}

function readStdinSync(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

if (isMainEntry(import.meta.url)) {
  const config = loadConfig(process.cwd());
  const protectedRef = `refs/heads/${config.targetBranch}`;
  process.exit(
    runPushScopeGuard({
      stdin: readStdinSync(),
      argv: process.argv.slice(2),
      lefthookPushFiles: () => lefthookPushFiles(realGit, realIsFile),
      carriesContent: (ref, remote) => refCarriesContent(realGit, ref, remote, protectedRef),
      protectedRef,
      stdout: console,
      stderr: console,
    }),
  );
}
/* v8 ignore stop */
