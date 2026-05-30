import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { removeIfExists, renameIfExists, replaceInTree, walkTextFiles, writeText } from '../lib/fs';
import { git, isGitRepo, run, runInherit, shortSha } from '../lib/git';

describe('script fs helpers', () => {
  test('write/remove/rename helpers handle existing, missing, and conflicting paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-fs-'));
    try {
      const source = join(root, 'a/source.txt');
      const dest = join(root, 'b/dest.txt');
      writeText(source, 'hello');
      renameIfExists(source, dest);
      expect(readFileSync(dest, 'utf8')).toBe('hello');
      renameIfExists(join(root, 'missing.txt'), join(root, 'still-missing.txt'));
      writeText(source, 'again');
      expect(() => renameIfExists(source, dest)).toThrow(/destination exists/);
      removeIfExists(source);
      removeIfExists(source);
      expect(existsSync(source)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('walkTextFiles skips known generated dirs, symlinks, and binary extensions', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-walk-'));
    try {
      writeText(join(root, 'keep.md'), 'keep');
      writeText(join(root, 'LICENSE'), 'keep');
      writeText(join(root, 'nested/keep.ts'), 'keep');
      writeText(join(root, 'node_modules/skip.ts'), 'skip');
      writeFileSync(join(root, 'image.png'), 'not text');
      symlinkSync(join(root, 'keep.md'), join(root, 'linked.md'));
      expect(walkTextFiles(join(root, 'missing'))).toEqual([]);
      const relative = walkTextFiles(root).map((path) => path.slice(root.length + 1)).sort();
      expect(relative).toEqual(['LICENSE', 'keep.md', 'nested/keep.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('replaceInTree returns changed files only', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-replace-'));
    try {
      writeText(join(root, 'a.txt'), 'hello example-rust');
      writeText(join(root, 'b.txt'), 'untouched');
      expect(replaceInTree(root, [['example-rust', 'acme-rust']])).toEqual(['a.txt']);
      expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('hello acme-rust');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('script git helpers', () => {
  test('run and git helpers return output or empty string on allowed failure', () => {
    expect(run(process.execPath, ['-e', 'console.log("ok")'])).toBe('ok');
    expect(run(process.execPath, ['-e', 'process.exit(3)'], { allowFailure: true })).toBe('');
    expect(() => run(process.execPath, ['-e', 'process.exit(3)'])).toThrow();
    expect(git(['--version'])).toMatch(/^git version /);
    expect(git(['definitely-not-a-git-command'], { allowFailure: true })).toBe('');
    expect(() => git(['definitely-not-a-git-command'])).toThrow();
    expect(shortSha('1234567890abcdef')).toBe('1234567890ab');
  });

  test('runInherit throws on nonzero status and isGitRepo detects repo roots', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-git-'));
    try {
      expect(isGitRepo(root)).toBe(false);
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
      expect(isGitRepo(root)).toBe(true);
      runInherit(process.execPath, ['-e', 'process.exit(0)'], root);
      expect(() => runInherit(process.execPath, ['-e', 'process.exit(9)'], root)).toThrow(/failed with 9/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
