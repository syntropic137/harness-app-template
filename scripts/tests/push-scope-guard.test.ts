import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { PushRefLine } from '../guard-main-push';
import {
  EMPTY_TREE_SHA,
  evaluatePushScope,
  type GitRunner,
  lefthookPushFiles,
  refCarriesContent,
  runPushScopeGuard,
} from '../push-scope-guard';
import { fixtureGit, hermeticGitEnv } from './helpers/land-git-env';

// ADR-0033. lefthook 1.13 skips EVERY pre-push `commands:` job --
// filtered or not, guard-main-push included -- when its push-file set is empty,
// and it computes that set from the LOCAL checkout (`git diff --name-only HEAD
// @{push}`, falling back to origin/HEAD), never from the refs actually being
// pushed. These tests pin the replica of that computation against real git, and
// the refusal the guard makes when the set is empty but the push is not.

const ZERO = '0'.repeat(40);
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function ref(overrides: Partial<PushRefLine> = {}): PushRefLine {
  return {
    localRef: 'refs/heads/feat',
    localSha: SHA_B,
    remoteRef: 'refs/heads/feat',
    remoteSha: SHA_A,
    ...overrides,
  };
}

function sink() {
  const lines: string[] = [];
  return { lines, io: { error: (m: string) => lines.push(m), log: (m: string) => lines.push(m) } };
}

describe('evaluatePushScope (pure decision)', () => {
  test('a non-empty lefthook file set passes: the jobs were armed', () => {
    const result = evaluatePushScope([ref()], 'origin', {
      lefthookPushFiles: () => ['a.txt'],
      carriesContent: () => true,
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('1 file;');
    const two = evaluatePushScope([ref()], 'origin', {
      lefthookPushFiles: () => ['a.txt', 'b.txt'],
      carriesContent: () => true,
    });
    expect(two.message).toContain('2 files;');
  });

  test('empty set + a ref carrying content the remote lacks is REFUSED', () => {
    const result = evaluatePushScope([ref({ remoteRef: 'refs/heads/main' })], 'origin', {
      lefthookPushFiles: () => [],
      carriesContent: () => true,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('no matching push files');
    expect(result.message).toContain('refs/heads/main');
    expect(result.message).toContain('ADR-0033');
  });

  test('empty set + a genuinely empty push passes, and says so', () => {
    const result = evaluatePushScope([ref()], 'origin', {
      lefthookPushFiles: () => [],
      carriesContent: () => false,
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('nothing the remote lacks');
  });

  test('empty set + UNKNOWN content fails closed', () => {
    const result = evaluatePushScope([ref()], 'origin', {
      lefthookPushFiles: () => [],
      carriesContent: () => null,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('could not determine');
  });

  test('an uncomputable lefthook file set fails closed', () => {
    const result = evaluatePushScope([ref()], 'origin', {
      lefthookPushFiles: () => null,
      carriesContent: () => false,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('could not compute');
  });

  test('no ref lines fails closed', () => {
    const result = evaluatePushScope([], 'origin', {
      lefthookPushFiles: () => ['a.txt'],
      carriesContent: () => true,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('no parseable push refs');
  });
});

describe('runPushScopeGuard (IO wiring)', () => {
  test('exit 1 and stderr on refusal, exit 0 and stdout on pass', () => {
    const err = sink();
    const out = sink();
    const refused = runPushScopeGuard({
      stdin: `refs/heads/feat ${SHA_B} refs/heads/main ${SHA_A}\n`,
      argv: ['origin', 'git@example:repo.git'],
      lefthookPushFiles: () => [],
      carriesContent: (r, remote) => r.remoteRef === 'refs/heads/main' && remote === 'origin',
      stdout: out.io,
      stderr: err.io,
    });
    expect(refused).toBe(1);
    expect(err.lines.join('\n')).toContain('REFUSING');

    const passed = runPushScopeGuard({
      stdin: `refs/heads/feat ${SHA_B} refs/heads/feat ${SHA_A}\n`,
      argv: [],
      lefthookPushFiles: () => ['x'],
      carriesContent: () => true,
      stdout: out.io,
      stderr: err.io,
    });
    expect(passed).toBe(0);
    expect(out.lines.join('\n')).toContain('push-scope-guard');
  });
});

// ---------------------------------------------------------------------------
// Real git. Each case is one of the shapes reproduced against real lefthook
// 1.13.6 on a scratch repo + local bare remote (see
// docs/agent-flywheel/push-scope-guard-proof.md for the lefthook transcripts).

let root: string;
let work: string;
let remote: string;

function git(...args: string[]): string {
  return fixtureGit(args, { cwd: work });
}

const runner: () => GitRunner = () => (args) => {
  const r = spawnSync('git', args, { cwd: work, env: hermeticGitEnv(), encoding: 'utf8' });
  return { status: r.status ?? 1, stdout: r.stdout ?? '' };
};

const isFile = (rel: string) => {
  const abs = join(work, rel);
  return existsSync(abs) && statSync(abs).isFile();
};

function commitFile(name: string, body: string, message: string): string {
  writeFileSync(join(work, name), body);
  git('add', '-A');
  git('commit', '-qm', message, '--no-gpg-sign');
  return git('rev-parse', 'HEAD').trim();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'push-scope-guard-'));
  remote = join(root, 'remote.git');
  work = join(root, 'work');
  fixtureGit(['init', '-q', '--bare', remote]);
  fixtureGit(['init', '-q', '-b', 'main', work]);
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  git('remote', 'add', 'origin', remote);
  commitFile('a.txt', 'a\n', 'feat: init');
  commitFile('b.txt', 'b\n', 'feat: b');
  git('push', '-q', '-u', 'origin', 'main');
  // A real clone has origin/HEAD; lefthook's detached-HEAD fallback reads it.
  git('remote', 'set-head', 'origin', 'main');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('lefthookPushFiles (replica of lefthook 1.13 Repository.PushFiles)', () => {
  test('HEAD ahead of @{push} with a change: non-empty', () => {
    commitFile('a.txt', 'a2\n', 'feat: change a');
    expect(lefthookPushFiles(runner(), isFile)).toEqual(['a.txt']);
  });

  test('a non-ASCII path comes back unquoted (git would C-quote it without -z)', () => {
    commitFile('caf\u00e9 "x".txt', 'c\n', 'feat: unusual name');
    expect(lefthookPushFiles(runner(), isFile)).toEqual(['caf\u00e9 "x".txt']);
  });

  test('message-only amend: tree(HEAD) equals tree(@{push}) -> EMPTY', () => {
    git('commit', '-q', '--amend', '-m', 'feat: reworded', '--no-gpg-sign');
    expect(lefthookPushFiles(runner(), isFile)).toEqual([]);
  });

  test('deletion-only change: the deleted path fails the existence filter -> EMPTY', () => {
    git('rm', '-q', 'b.txt');
    git('commit', '-qm', 'chore: drop b', '--no-gpg-sign');
    expect(lefthookPushFiles(runner(), isFile)).toEqual([]);
  });

  test('detached HEAD at origin/main: @{push} fails, falls back to origin/HEAD -> EMPTY', () => {
    git('checkout', '-q', '--detach', 'origin/main');
    expect(lefthookPushFiles(runner(), isFile)).toEqual([]);
  });

  test('detached HEAD with no origin/HEAD falls back to the empty tree (every file)', () => {
    git('remote', 'set-head', 'origin', '-d');
    git('checkout', '-q', '--detach', 'HEAD');
    expect(lefthookPushFiles(runner(), isFile)).toEqual(['a.txt', 'b.txt']);
  });

  test('an unresolvable fallback base is UNKNOWN, not empty', () => {
    git('checkout', '-q', '--detach', 'HEAD');
    const broken: GitRunner = (args) =>
      args[0] === 'branch'
        ? { status: 0, stdout: '  origin/HEAD -> origin/nope\n' }
        : runner()(args);
    expect(lefthookPushFiles(broken, isFile)).toBeNull();
    const noBranches: GitRunner = (args) =>
      args[0] === 'branch' ? { status: 128, stdout: '' } : runner()(args);
    expect(lefthookPushFiles(noBranches, isFile)).toBeNull();
  });

  test('EMPTY_TREE_SHA is git’s empty tree', () => {
    expect(git('hash-object', '-t', 'tree', '/dev/null').trim()).toBe(EMPTY_TREE_SHA);
  });
});

describe('refCarriesContent (what the push actually sends)', () => {
  test('existing ref, tree differs: carries', () => {
    const before = git('rev-parse', 'HEAD').trim();
    const after = commitFile('a.txt', 'a2\n', 'feat: change a');
    expect(refCarriesContent(runner(), ref({ localSha: after, remoteSha: before }), 'origin')).toBe(
      true,
    );
  });

  test('existing ref, identical tree (message-only rewrite): carries nothing', () => {
    const before = git('rev-parse', 'HEAD').trim();
    git('commit', '-q', '--amend', '-m', 'feat: reworded', '--no-gpg-sign');
    const after = git('rev-parse', 'HEAD').trim();
    expect(refCarriesContent(runner(), ref({ localSha: after, remoteSha: before }), 'origin')).toBe(
      false,
    );
  });

  test('existing ref whose remote tip is unknown locally: UNKNOWN', () => {
    const head = git('rev-parse', 'HEAD').trim();
    expect(refCarriesContent(runner(), ref({ localSha: head, remoteSha: SHA_A }), 'origin')).toBe(
      null,
    );
  });

  test('new ref at a commit the remote already has: carries nothing', () => {
    const head = git('rev-parse', 'origin/main').trim();
    expect(
      refCarriesContent(
        runner(),
        ref({ localSha: head, remoteSha: ZERO, remoteRef: 'refs/heads/newb' }),
        'origin',
      ),
    ).toBe(false);
  });

  test('new ref with commits the remote lacks: carries', () => {
    const head = commitFile('c.txt', 'c\n', 'feat: c');
    expect(
      refCarriesContent(
        runner(),
        ref({ localSha: head, remoteSha: ZERO, remoteRef: 'refs/heads/newb' }),
        'origin',
      ),
    ).toBe(true);
  });

  test('new ref pushed to a bare URL (no remote-tracking refs): fails closed as carrying', () => {
    const head = git('rev-parse', 'origin/main').trim();
    expect(
      refCarriesContent(
        runner(),
        ref({ localSha: head, remoteSha: ZERO, remoteRef: 'refs/heads/newb' }),
        remote,
      ),
    ).toBe(true);
  });

  test('deleting a branch carries nothing; deleting main is treated as carrying', () => {
    const head = git('rev-parse', 'HEAD').trim();
    expect(refCarriesContent(runner(), ref({ localSha: ZERO, remoteSha: head }), 'origin')).toBe(
      false,
    );
    expect(
      refCarriesContent(
        runner(),
        ref({ localSha: ZERO, remoteSha: head, remoteRef: 'refs/heads/main' }),
        'origin',
      ),
    ).toBe(true);
  });

  test('git failing outright is UNKNOWN', () => {
    const failing: GitRunner = () => ({ status: 128, stdout: '' });
    expect(refCarriesContent(failing, ref({ remoteSha: ZERO }), 'origin')).toBeNull();
    const catOk: GitRunner = (args) =>
      args[0] === 'cat-file' ? { status: 0, stdout: '' } : { status: 128, stdout: '' };
    expect(refCarriesContent(catOk, ref(), 'origin')).toBeNull();
  });
});

describe('end to end: the reproduced skip shapes, decided with real git', () => {
  function decide(line: PushRefLine) {
    return evaluatePushScope([line], 'origin', {
      lefthookPushFiles: () => lefthookPushFiles(runner(), isFile),
      carriesContent: (r, rem) => refCarriesContent(runner(), r, rem),
    });
  }

  test('on main at @{push}, `git push origin feat:main` -> REFUSED (the ungated main push)', () => {
    const mainTip = git('rev-parse', 'HEAD').trim();
    git('checkout', '-q', '-b', 'feat');
    const feat = commitFile('a.txt', 'evil\n', 'feat: unreviewed');
    git('checkout', '-q', 'main');
    const result = decide(
      ref({ localSha: feat, remoteSha: mainTip, remoteRef: 'refs/heads/main' }),
    );
    expect(result.ok).toBe(false);
  });

  test('detached at origin/main pushing a content-carrying commit to a new ref -> REFUSED', () => {
    git('checkout', '-q', '-b', 'feat');
    const feat = commitFile('c.txt', 'c\n', 'feat: c');
    git('checkout', '-q', '--detach', 'origin/main');
    const result = decide(ref({ localSha: feat, remoteSha: ZERO, remoteRef: 'refs/heads/other' }));
    expect(result.ok).toBe(false);
  });

  test('deletion-only commit on the current branch -> REFUSED (jobs skipped, content sent)', () => {
    const before = git('rev-parse', 'HEAD').trim();
    git('rm', '-q', 'b.txt');
    git('commit', '-qm', 'chore: drop b', '--no-gpg-sign');
    const after = git('rev-parse', 'HEAD').trim();
    expect(
      decide(ref({ localSha: after, remoteSha: before, remoteRef: 'refs/heads/main' })).ok,
    ).toBe(false);
  });

  test('message-only force-push -> allowed: identical tree, nothing to gate', () => {
    const before = git('rev-parse', 'HEAD').trim();
    git('commit', '-q', '--amend', '-m', 'feat: reworded', '--no-gpg-sign');
    const after = git('rev-parse', 'HEAD').trim();
    expect(decide(ref({ localSha: after, remoteSha: before })).ok).toBe(true);
  });

  test('`just land` shape: detached at the validated commit, HEAD:refs/heads/main -> passes', () => {
    const mainTip = git('rev-parse', 'origin/main').trim();
    git('checkout', '-q', '--detach', 'origin/main');
    const landed = commitFile('a.txt', 'landed\n', 'feat: landed');
    expect(
      decide(
        ref({
          localRef: 'HEAD',
          localSha: landed,
          remoteSha: mainTip,
          remoteRef: 'refs/heads/main',
        }),
      ).ok,
    ).toBe(true);
  });

  test('ordinary branch push with a change -> passes', () => {
    const before = git('rev-parse', 'HEAD').trim();
    const after = commitFile('a.txt', 'a3\n', 'feat: a3');
    expect(
      decide(ref({ localSha: after, remoteSha: before, remoteRef: 'refs/heads/main' })).ok,
    ).toBe(true);
  });

  test('a working-tree deletion also empties lefthook’s set (existence is checked on disk)', () => {
    const before = git('rev-parse', 'HEAD').trim();
    const after = commitFile('a.txt', 'a4\n', 'feat: a4');
    unlinkSync(join(work, 'a.txt'));
    expect(lefthookPushFiles(runner(), isFile)).toEqual([]);
    expect(decide(ref({ localSha: after, remoteSha: before })).ok).toBe(false);
  });
});

describe('configured protected ref (ADR-0033)', () => {
  test('deleting the configured protected ref counts as content', () => {
    const del: PushRefLine = {
      localRef: '(delete)',
      localSha: ZERO,
      remoteRef: 'refs/heads/trunk',
      remoteSha: SHA_A,
    };
    const git: GitRunner = () => ({ status: 0, stdout: '' });
    expect(refCarriesContent(git, del, 'origin', 'refs/heads/trunk')).toBe(true);
    expect(refCarriesContent(git, del, 'origin')).toBe(false);
  });
});
