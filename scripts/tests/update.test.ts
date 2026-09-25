import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chdir, cwd as processCwd } from 'node:process';
import { describe, expect, test } from 'vitest';
import { withoutLocalGitEnv } from '../lib/git';
import { parseCli, updateProject } from '../update';

function run(cwd: string, args: string[]): string {
  // `-c core.hooksPath=/dev/null` silences any host-installed hooks
  // (e.g. apss's managed global pre-commit) so temp git repos created
  // by these tests can commit without inheriting unrelated host
  // validation against a directory that has no project structure.
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    env: withoutLocalGitEnv(),
    encoding: 'utf8',
  }).trim();
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function commitAll(cwd: string, message: string): string {
  run(cwd, ['add', '.']);
  run(cwd, ['commit', '-m', message]);
  return run(cwd, ['rev-parse', 'HEAD']);
}

function initRepo(path: string): void {
  run(path, ['init']);
  run(path, ['checkout', '-b', 'main']);
  run(path, ['config', 'user.email', 'test@example.invalid']);
  run(path, ['config', 'user.name', 'Template Test']);
  run(path, ['config', 'commit.gpgsign', 'false']);
}

const LINES = 'a\nb\nc\nd\ne\nf\ng\nh\ni\n';

function setupCanonicalAndFork(
  root: string,
  harnessFile = 'v1\n',
  extraFiles: Record<string, string> = {},
): { canonical: string; fork: string } {
  const canonical = join(root, 'canonical');
  const fork = join(root, 'fork');
  mkdirSync(canonical);
  initRepo(canonical);
  write(join(canonical, 'harness/file.txt'), harnessFile);
  for (const [path, content] of Object.entries(extraFiles)) {
    write(join(canonical, path), content);
  }
  write(join(canonical, 'ws_apps/app.txt'), 'seed\n');
  commitAll(canonical, 'initial template');

  execFileSync('git', ['clone', canonical, fork], { env: withoutLocalGitEnv(), stdio: 'ignore' });
  run(fork, ['config', 'user.email', 'test@example.invalid']);
  run(fork, ['config', 'user.name', 'Template Test']);
  run(fork, ['config', 'commit.gpgsign', 'false']);
  run(fork, ['remote', 'add', 'upstream', canonical]);
  return { canonical, fork };
}

describe('updateProject', () => {
  test('parses CLI update flags', () => {
    expect(parseCli(['--check', '--write', '--force', '--strategy=preview'])).toEqual({
      check: true,
      strategy: 'preview',
      force: true,
    });
    expect(() => parseCli(['--strategy=bad'])).toThrow(/--strategy/);
    expect(() => parseCli(['--bogus'])).toThrow(/unknown argument/);
  });

  test('parseCli --help prints usage and exits', () => {
    const originalLog = console.log;
    const originalExit = process.exit;
    const logs: string[] = [];
    console.log = (message?: unknown) => {
      logs.push(String(message));
    };
    process.exit = ((code?: string | number | null | undefined): never => {
      throw new Error(`exit ${code}`);
    }) as typeof process.exit;
    try {
      expect(() => parseCli(['--help'])).toThrow('exit 0');
      expect(logs[0]).toContain('usage: bun run scripts/update.ts');
    } finally {
      console.log = originalLog;
      process.exit = originalExit;
    }
  });

  // History: `just update` used to overwrite harness-owned paths wholesale, then
  // (#78) refused whenever a committed local edit would be overwritten. Both
  // forced a choice between "don't update" and "lose your edits". It now does
  // a per-file three-way merge; these tests pin each outcome.
  test('three-way: local and upstream edits to different parts of one file both survive', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-3way-clean-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root, LINES);
      write(join(fork, 'harness/file.txt'), LINES.replace('a\n', 'A-local\n'));
      commitAll(fork, 'consumer customizes the top of a harness file');
      expect(run(fork, ['status', '--porcelain'])).toBe('');
      write(join(canonical, 'harness/file.txt'), LINES.replace('i\n', 'I-upstream\n'));
      commitAll(canonical, 'template edits the bottom of the same file');

      const result = updateProject({ cwd: fork, strategy: 'merge' });
      expect(result).toContain('merged cleanly: harness/file.txt');
      const merged = readFileSync(join(fork, 'harness/file.txt'), 'utf8');
      expect(merged).toContain('A-local\n');
      expect(merged).toContain('I-upstream\n');
      // Committed with the existing message format, working tree clean.
      expect(run(fork, ['log', '-1', '--format=%s'])).toMatch(
        /^update: harness sync from upstream@[0-9a-f]{12}$/,
      );
      expect(run(fork, ['status', '--porcelain'])).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('three-way: overlapping edits leave conflict markers, commit nothing, and throw', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-3way-conflict-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root, LINES);
      write(join(canonical, 'harness/other.txt'), 'new upstream file\n');
      write(join(fork, 'harness/file.txt'), LINES.replace('e\n', 'E-local\n'));
      const head = commitAll(fork, 'consumer edits line e');
      write(join(canonical, 'harness/file.txt'), LINES.replace('e\n', 'E-upstream\n'));
      commitAll(canonical, 'template edits line e');

      let message = '';
      try {
        updateProject({ cwd: fork, strategy: 'merge' });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('NOTHING was committed');
      expect(message).toContain('harness/file.txt (both modified)');
      expect(message).toContain('Harness-Upstream');
      expect(run(fork, ['rev-parse', 'HEAD'])).toBe(head);
      const onDisk = readFileSync(join(fork, 'harness/file.txt'), 'utf8');
      expect(onDisk).toMatch(/<<<<<<< HEAD\nE-local\n=======\nE-upstream\n>>>>>>> upstream\/main/);
      // The conflicted file is unstaged; non-conflicting changes are staged.
      expect(run(fork, ['diff', '--name-only', '--cached'])).toBe('harness/other.txt');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('three-way: --force on a conflict takes upstream', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-3way-force-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root, LINES);
      write(join(fork, 'harness/file.txt'), LINES.replace('e\n', 'E-local\n'));
      commitAll(fork, 'consumer edits line e');
      write(join(canonical, 'harness/file.txt'), LINES.replace('e\n', 'E-upstream\n'));
      commitAll(canonical, 'template edits line e');

      const result = updateProject({ cwd: fork, strategy: 'merge', force: true });
      expect(result).toContain('--force took upstream for: harness/file.txt');
      expect(readFileSync(join(fork, 'harness/file.txt'), 'utf8')).toBe(
        LINES.replace('e\n', 'E-upstream\n'),
      );
      expect(run(fork, ['status', '--porcelain'])).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('three-way: local-only edit is preserved while upstream-only change applies', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-3way-keep-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      write(join(canonical, 'harness/skill.md'), 'upstream skill v1\n');
      commitAll(canonical, 'add skill');
      run(fork, ['pull', '-q', 'origin', 'main']);
      write(join(fork, 'harness/skill.md'), 'consumer-customized skill\n');
      commitAll(fork, 'customize skill');
      write(join(canonical, 'harness/file.txt'), 'v2\n');
      commitAll(canonical, 'template bumps a different file');

      const result = updateProject({ cwd: fork, strategy: 'merge' });
      expect(result).toContain('kept local: harness/skill.md');
      expect(readFileSync(join(fork, 'harness/skill.md'), 'utf8')).toBe(
        'consumer-customized skill\n',
      );
      expect(readFileSync(join(fork, 'harness/file.txt'), 'utf8')).toBe('v2\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function setupAddsAndDeletes(root: string): string {
    const { canonical, fork } = setupCanonicalAndFork(root, 'v1\n', {
      'harness/drop-clean.txt': 'x\n',
      'harness/drop-edited.txt': 'x\n',
      'harness/local-gone.txt': 'x\n',
    });
    write(join(fork, 'harness/drop-edited.txt'), 'consumer edit\n');
    rmSync(join(fork, 'harness/local-gone.txt'));
    commitAll(fork, 'consumer edits and deletes');
    rmSync(join(canonical, 'harness/drop-clean.txt'));
    rmSync(join(canonical, 'harness/drop-edited.txt'));
    write(join(canonical, 'harness/local-gone.txt'), 'upstream improved\n');
    write(join(canonical, 'harness/added.txt'), 'brand new\n');
    commitAll(canonical, 'template adds, deletes, edits');
    return fork;
  }

  // Regression for the #78 guard's false refusal (found reviewing the
  // dream-ship port): upstream DELETING a harness file the consumer edited
  // must not block the update. The edit is kept and reported.
  test('three-way: adds and deletes on each side, none of which block the update', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-3way-adddel-'));
    try {
      const fork = setupAddsAndDeletes(root);
      const preview = updateProject({ cwd: fork, strategy: 'preview' });
      expect(preview).toContain('fast-forward (take upstream): 2');
      expect(preview).toContain(
        'kept-modified (deleted upstream, modified locally): 1\n  harness/drop-edited.txt',
      );
      expect(preview).toContain(
        'kept-deleted (deleted locally, changed upstream): 1\n  harness/local-gone.txt',
      );
      expect(preview).not.toContain('conflict');

      const result = updateProject({ cwd: fork, strategy: 'merge' });
      expect(result).toContain('harness file(s) refreshed');
      expect(result).toContain(
        'kept yours (deleted upstream; --force deletes): harness/drop-edited.txt',
      );
      expect(result).toContain(
        'kept deleted (changed upstream; --force restores): harness/local-gone.txt',
      );
      expect(readFileSync(join(fork, 'harness/added.txt'), 'utf8')).toBe('brand new\n');
      expect(existsSync(join(fork, 'harness/drop-clean.txt'))).toBe(false);
      expect(readFileSync(join(fork, 'harness/drop-edited.txt'), 'utf8')).toBe('consumer edit\n');
      expect(existsSync(join(fork, 'harness/local-gone.txt'))).toBe(false);
      expect(run(fork, ['status', '--porcelain'])).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('three-way: --force deletes upstream-deleted edits and restores local deletions', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-3way-adddel-force-'));
    try {
      const fork = setupAddsAndDeletes(root);
      const forced = updateProject({ cwd: fork, strategy: 'merge', force: true });
      expect(forced).toContain(
        '--force took upstream for: harness/drop-edited.txt, harness/local-gone.txt',
      );
      expect(forced).not.toContain('kept yours');
      expect(existsSync(join(fork, 'harness/drop-edited.txt'))).toBe(false);
      expect(readFileSync(join(fork, 'harness/local-gone.txt'), 'utf8')).toBe(
        'upstream improved\n',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('three-way: a locally deleted file changed upstream stays deleted without --force', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-3way-keptdel-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root, 'v1\n', {
        'harness/gone.txt': 'x\n',
      });
      rmSync(join(fork, 'harness/gone.txt'));
      commitAll(fork, 'consumer drops a harness file');
      write(join(canonical, 'harness/gone.txt'), 'y\n');
      write(join(canonical, 'harness/file.txt'), 'v2\n');
      commitAll(canonical, 'template edits both');

      const result = updateProject({ cwd: fork, strategy: 'merge' });
      expect(result).toContain(
        'kept deleted (changed upstream; --force restores): harness/gone.txt',
      );
      expect(existsSync(join(fork, 'harness/gone.txt'))).toBe(false);
      expect(readFileSync(join(fork, 'harness/file.txt'), 'utf8')).toBe('v2\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('three-way: binary changed on both sides is a conflict, not a text merge', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-3way-bin-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root, 'v1\n', {
        'harness/logo.bin': 'bin\0base\n',
      });
      write(join(fork, 'harness/logo.bin'), 'bin\0local\n');
      commitAll(fork, 'consumer logo');
      write(join(canonical, 'harness/logo.bin'), 'bin\0upstream\n');
      commitAll(canonical, 'template logo');

      expect(() => updateProject({ cwd: fork, strategy: 'merge' })).toThrow(
        /harness\/logo\.bin \(binary, changed on both sides\)/,
      );
      expect(readFileSync(join(fork, 'harness/logo.bin'), 'utf8')).toBe('bin\0local\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('three-way: both sides adding the same path with different content conflicts', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-3way-bothadd-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      write(join(fork, 'harness/new.txt'), 'local\n');
      commitAll(fork, 'consumer adds');
      write(join(canonical, 'harness/new.txt'), 'upstream\n');
      commitAll(canonical, 'template adds');
      expect(() => updateProject({ cwd: fork, strategy: 'merge' })).toThrow(
        /harness\/new\.txt \(both modified\)/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('three-way: next update merges from the last synced upstream, not the stale fork point', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-3way-rebase-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root, LINES);
      write(join(fork, 'harness/file.txt'), LINES.replace('a\n', 'A-local\n'));
      commitAll(fork, 'consumer customizes line a');
      write(join(canonical, 'harness/file.txt'), LINES.replace('e\n', 'E1\n'));
      commitAll(canonical, 'template round 1');
      updateProject({ cwd: fork, strategy: 'merge' });
      expect(run(fork, ['log', '-1', '--format=%b'])).toMatch(/^Harness-Upstream: [0-9a-f]{40}$/);

      // Second round: upstream changes line e AGAIN. Against the stale fork
      // point, ours ALSO changed line e (to E1), so this would conflict.
      write(join(canonical, 'harness/file.txt'), LINES.replace('e\n', 'E2\n'));
      commitAll(canonical, 'template round 2');
      const second = updateProject({ cwd: fork, strategy: 'merge' });
      expect(second).toContain('merged cleanly: harness/file.txt');
      const merged = readFileSync(join(fork, 'harness/file.txt'), 'utf8');
      expect(merged).toContain('A-local\n');
      expect(merged).toContain('E2\n');
      expect(updateProject({ cwd: fork, strategy: 'merge' })).toContain('already up to date');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('three-way: an unusable recorded sync sha falls back to the merge base', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-3way-fallback-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root, LINES);
      // A pre-trailer sync subject naming a commit that is NOT on upstream.
      write(join(fork, 'harness/file.txt'), LINES.replace('a\n', 'A-local\n'));
      const local = commitAll(fork, 'consumer customizes line a');
      run(fork, ['commit', '--allow-empty', '-m', `update: harness sync from upstream@${local}`]);
      write(join(canonical, 'harness/file.txt'), LINES.replace('i\n', 'I-upstream\n'));
      commitAll(canonical, 'template edits line i');

      const result = updateProject({ cwd: fork, strategy: 'merge' });
      expect(result).toContain('merged cleanly: harness/file.txt');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('three-way: a symlink retargeted on both sides is a conflict', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-3way-link-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      symlinkSync('file.txt', join(canonical, 'harness/link'));
      commitAll(canonical, 'add link');
      run(fork, ['pull', '-q', 'origin', 'main']);
      rmSync(join(fork, 'harness/link'));
      symlinkSync('local-target', join(fork, 'harness/link'));
      commitAll(fork, 'consumer retargets link');
      rmSync(join(canonical, 'harness/link'));
      symlinkSync('upstream-target', join(canonical, 'harness/link'));
      commitAll(canonical, 'template retargets link');

      expect(() => updateProject({ cwd: fork, strategy: 'merge' })).toThrow(
        /harness\/link \(symlink changed on both sides\)/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--force keeps the stash and warns when restoring dirty edits conflicts', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-pop-conflict-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      write(join(fork, 'harness/file.txt'), 'uncommitted local edit\n');
      write(join(canonical, 'harness/file.txt'), 'v2\n');
      commitAll(canonical, 'template bump');

      const result = updateProject({ cwd: fork, strategy: 'merge', force: true });
      expect(result).toContain('harness file(s) refreshed');
      expect(result).toContain('`git stash pop`) conflicted');
      expect(run(fork, ['stash', 'list'])).toContain('just update harness-owned preimage');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('preview lists per-file categories and changes nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-3way-preview-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root, LINES, {
        'harness/keep.txt': 'k\n',
        'harness/ff.txt': 'f\n',
        'harness/clash.txt': 'c\n',
      });
      write(join(fork, 'harness/keep.txt'), 'k-local\n');
      write(join(fork, 'harness/file.txt'), LINES.replace('a\n', 'A-local\n'));
      write(join(fork, 'harness/clash.txt'), 'c-local\n');
      const head = commitAll(fork, 'consumer edits');
      write(join(canonical, 'harness/ff.txt'), 'f2\n');
      write(join(canonical, 'harness/file.txt'), LINES.replace('i\n', 'I-upstream\n'));
      write(join(canonical, 'harness/clash.txt'), 'c-upstream\n');
      commitAll(canonical, 'template edits');

      const preview = updateProject({ cwd: fork, strategy: 'preview' });
      expect(preview).toContain('fast-forward (take upstream): 1\n  harness/ff.txt');
      expect(preview).toContain('keep-local (unchanged upstream): 1\n  harness/keep.txt');
      expect(preview).toContain(
        'merge-clean (both changed, merges cleanly): 1\n  harness/file.txt',
      );
      expect(preview).toContain(
        'conflict (needs manual resolution): 1\n  harness/clash.txt (both modified)',
      );
      expect(run(fork, ['rev-parse', 'HEAD'])).toBe(head);
      expect(run(fork, ['status', '--porcelain'])).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('preview leaves working tree intact; merge applies harness paths only', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);

      // Consumer edits ws_apps and commits; this must survive the update.
      write(join(fork, 'ws_apps/app.txt'), 'consumer edit\n');
      commitAll(fork, 'consumer product edit');

      // Canonical ships a harness update.
      write(join(canonical, 'harness/file.txt'), 'v2\n');
      commitAll(canonical, 'template harness update');

      const preview = updateProject({ cwd: fork, strategy: 'preview' });
      expect(preview).toContain('preview only');
      expect(preview).toContain('1 commit(s) ahead');
      expect(readFileSync(join(fork, 'harness/file.txt'), 'utf8')).toBe('v1\n');

      const applied = updateProject({ cwd: fork, strategy: 'merge' });
      expect(applied).toContain('ws_apps/ws_packages untouched');
      expect(readFileSync(join(fork, 'harness/file.txt'), 'utf8')).toBe('v2\n');
      // Consumer code byte-for-byte preserved.
      expect(readFileSync(join(fork, 'ws_apps/app.txt'), 'utf8')).toBe('consumer edit\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('fast-forward case (no consumer edits) reports up-to-date after apply', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-ff-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      write(join(canonical, 'harness/file.txt'), 'v2\n');
      commitAll(canonical, 'harness bump');

      updateProject({ cwd: fork, strategy: 'merge' });
      // Second call should detect no work.
      const second = updateProject({ cwd: fork, strategy: 'merge' });
      expect(second).toContain('already up to date');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('defaults to merge in an interactive cwd run', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-defaults-'));
    const originalCwd = processCwd();
    const originalIsTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      write(join(canonical, 'harness/file.txt'), 'v2\n');
      commitAll(canonical, 'harness bump');

      chdir(fork);
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
      const result = updateProject();
      expect(result).toContain('harness file(s) refreshed');
      expect(readFileSync(join(fork, 'harness/file.txt'), 'utf8')).toBe('v2\n');
    } finally {
      chdir(originalCwd);
      if (originalIsTty) {
        Object.defineProperty(process.stdout, 'isTTY', originalIsTty);
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('defaults to preview in a non-interactive cwd run', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-default-preview-'));
    const originalCwd = processCwd();
    const originalIsTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      write(join(canonical, 'harness/file.txt'), 'v2\n');
      commitAll(canonical, 'harness bump');

      chdir(fork);
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
      const result = updateProject();
      expect(result).toContain('preview only');
      expect(readFileSync(join(fork, 'harness/file.txt'), 'utf8')).toBe('v1\n');
    } finally {
      chdir(originalCwd);
      if (originalIsTty) {
        Object.defineProperty(process.stdout, 'isTTY', originalIsTty);
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports already up to date when upstream HEAD is the merge base', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-current-'));
    try {
      const { fork } = setupCanonicalAndFork(root);
      const result = updateProject({ cwd: fork, strategy: 'merge' });
      expect(result).toContain('already up to date');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns no harness-owned paths when upstream changed only consumer paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-no-harness-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      write(join(canonical, 'ws_apps/app.txt'), 'upstream seed edit\n');
      commitAll(canonical, 'consumer seed update');
      const result = updateProject({ cwd: fork, strategy: 'merge' });
      expect(result).toContain('already up to date');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports no harness-owned paths when upstream has none', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-no-paths-'));
    try {
      const canonical = join(root, 'canonical');
      const fork = join(root, 'fork');
      mkdirSync(canonical);
      initRepo(canonical);
      write(join(canonical, 'docs-consumer/readme.md'), 'v1\n');
      commitAll(canonical, 'initial non-harness template');

      execFileSync('git', ['clone', canonical, fork], {
        env: withoutLocalGitEnv(),
        stdio: 'ignore',
      });
      run(fork, ['config', 'user.email', 'test@example.invalid']);
      run(fork, ['config', 'user.name', 'Template Test']);
      run(fork, ['config', 'commit.gpgsign', 'false']);
      run(fork, ['remote', 'add', 'upstream', canonical]);

      write(join(canonical, 'docs-consumer/readme.md'), 'v2\n');
      commitAll(canonical, 'consumer-only upstream update');

      const result = updateProject({ cwd: fork, strategy: 'merge' });
      expect(result).toContain('no harness-owned paths found upstream');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('refuses when provenance is dirty', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-dirty-prov-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      write(join(fork, '.harness-provenance.json'), '{}\n');
      write(join(canonical, 'harness/file.txt'), 'v2\n');
      commitAll(canonical, 'bump');
      expect(() => updateProject({ cwd: fork, strategy: 'merge' })).toThrow(/immutable after init/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // This test used to assert the file came back as 'v1' - i.e. it pinned the
  // bug: dirtyHarnessPaths trimmed porcelain lines, mangling ' M path' into a
  // wrong pathspec, so nothing was stashed and the checkout destroyed the edit.
  test('--force stashes dirty harness edits and restores them after a no-op refresh', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-force-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      write(join(canonical, 'ws_apps/app.txt'), 'upstream seed edit\n');
      commitAll(canonical, 'consumer seed update');
      write(join(fork, 'harness/file.txt'), 'local harness edit\n');
      const result = updateProject({ cwd: fork, strategy: 'merge', force: true });
      expect(result).toContain('already up to date');
      expect(readFileSync(join(fork, 'harness/file.txt'), 'utf8')).toBe('local harness edit\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('refuses without upstream remote', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-no-up-'));
    try {
      mkdirSync(join(root, 'repo'));
      initRepo(join(root, 'repo'));
      write(join(root, 'repo/harness/file.txt'), 'v1\n');
      commitAll(join(root, 'repo'), 'init');
      expect(() => updateProject({ cwd: join(root, 'repo') })).toThrow(
        /no `upstream` remote configured/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('refuses with dirty harness paths (no --force)', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-dirty-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      // Bump upstream so there's something to update.
      write(join(canonical, 'harness/file.txt'), 'v2\n');
      commitAll(canonical, 'bump');
      // Dirty the fork's harness/.
      writeFileSync(join(fork, 'harness/file.txt'), 'consumer in-flight edit\n');
      expect(() => updateProject({ cwd: fork, strategy: 'merge' })).toThrow(
        /dirty harness-owned paths/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--check throws with summary (exit code path)', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-check-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      write(join(canonical, 'harness/file.txt'), 'v2\n');
      commitAll(canonical, 'bump');
      let thrown: Error | null = null;
      try {
        updateProject({ cwd: fork, check: true, strategy: 'preview' });
      } catch (e) {
        thrown = e as Error;
      }
      if (!thrown) {
        throw new Error('expected updateProject to throw');
      }
      expect(thrown.message).toContain('1 commit(s) ahead');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('includes provenance line when .harness-provenance.json present', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-prov-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      // Write git-native provenance into the fork (post-init state).
      const canonicalHead = run(canonical, ['rev-parse', 'HEAD']);
      write(
        join(fork, '.harness-provenance.json'),
        JSON.stringify(
          {
            schemaVersion: '1.0',
            canonical_repo: 'https://github.com/syntropic137/harness-app-template',
            canonical_commit: canonicalHead,
            forked_at: '2026-05-29T22:00:00.000Z',
          },
          null,
          2,
        ),
      );
      commitAll(fork, 'stamp provenance');

      write(join(canonical, 'harness/file.txt'), 'v2\n');
      commitAll(canonical, 'bump');

      const preview = updateProject({ cwd: fork, strategy: 'preview' });
      expect(preview).toContain(`forked at ${canonicalHead.slice(0, 7)}`);
      expect(preview).toContain('2026-05-29T22:00:00.000Z');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('uses unknown date when provenance omits fork timestamp', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-prov-no-date-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      const canonicalHead = run(canonical, ['rev-parse', 'HEAD']);
      write(
        join(fork, '.harness-provenance.json'),
        JSON.stringify(
          {
            schemaVersion: '1.0',
            canonical_commit: canonicalHead,
          },
          null,
          2,
        ),
      );
      commitAll(fork, 'stamp provenance without timestamp');

      write(join(canonical, 'harness/file.txt'), 'v2\n');
      commitAll(canonical, 'bump');

      const preview = updateProject({ cwd: fork, strategy: 'preview' });
      expect(preview).toContain(`forked at ${canonicalHead.slice(0, 12)} (unknown date)`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('treats malformed committed provenance as not initialized', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-bad-prov-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);
      write(join(fork, '.harness-provenance.json'), '{bad json\n');
      commitAll(fork, 'stamp malformed provenance');

      write(join(canonical, 'harness/file.txt'), 'v2\n');
      commitAll(canonical, 'bump');

      const preview = updateProject({ cwd: fork, strategy: 'preview' });
      expect(preview).toContain('provenance: not initialized');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
