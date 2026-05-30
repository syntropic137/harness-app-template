import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { updateProject } from '../update';

function run(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
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

function setupCanonicalAndFork(root: string): { canonical: string; fork: string } {
  const canonical = join(root, 'canonical');
  const fork = join(root, 'fork');
  mkdirSync(canonical);
  initRepo(canonical);
  write(join(canonical, 'harness/file.txt'), 'v1\n');
  write(join(canonical, 'ws_apps/app.txt'), 'seed\n');
  commitAll(canonical, 'initial template');

  execFileSync('git', ['clone', canonical, fork], { stdio: 'ignore' });
  run(fork, ['config', 'user.email', 'test@example.invalid']);
  run(fork, ['config', 'user.name', 'Template Test']);
  run(fork, ['config', 'commit.gpgsign', 'false']);
  run(fork, ['remote', 'add', 'upstream', canonical]);
  return { canonical, fork };
}

describe('updateProject', () => {
  test('preview leaves working tree intact; merge applies harness paths only', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-'));
    try {
      const { canonical, fork } = setupCanonicalAndFork(root);

      // Consumer edits ws_apps and commits — this must survive the update.
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

  test('refuses without upstream remote', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-update-no-up-'));
    try {
      mkdirSync(join(root, 'repo'));
      initRepo(join(root, 'repo'));
      write(join(root, 'repo/harness/file.txt'), 'v1\n');
      commitAll(join(root, 'repo'), 'init');
      expect(() => updateProject({ cwd: join(root, 'repo') })).toThrow(/no `upstream` remote configured/);
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
      expect(() => updateProject({ cwd: fork, strategy: 'merge' })).toThrow(/dirty harness-owned paths/);
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
      expect(thrown).not.toBeNull();
      expect(thrown!.message).toContain('1 commit(s) ahead');
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
            canonical_repo: 'https://github.com/syntropic137/create-harness-app',
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
});
