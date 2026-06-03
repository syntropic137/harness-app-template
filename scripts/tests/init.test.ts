import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chdir, cwd as processCwd } from 'node:process';
import { describe, expect, test } from 'vitest';
import { initProject, parseCli, validateProjectName } from '../init';
import { withoutLocalGitEnv } from '../lib/git';

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env: withoutLocalGitEnv(), encoding: 'utf8' }).trim();
}

function initRepo(cwd: string): void {
  git(cwd, ['init']);
  git(cwd, ['checkout', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'test@example.invalid']);
  git(cwd, ['config', 'user.name', 'Template Test']);
  git(cwd, ['config', 'commit.gpgsign', 'false']);
}

function commitAll(cwd: string, message: string): string {
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

describe('initProject', () => {
  test('validates CLI args and project names', () => {
    expect(parseCli(['acme', '--force', '--no-verify'])).toEqual({
      projectName: 'acme',
      force: true,
      verify: false,
    });
    expect(parseCli(['acme'])).toEqual({ projectName: 'acme', force: false, verify: true });
    expect(() => parseCli(['--force'])).toThrow(/usage:/);
    expect(() => validateProjectName('Bad_Name')).toThrow(/project name/);
  });

  test('refuses a dirty git tree unless forced', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-init-dirty-'));
    try {
      write(
        join(root, 'harness.manifest.json'),
        '{"name":"polyglot-monorepo","version":"0.4.0","standard":"0.2"}\n',
      );
      initRepo(root);
      commitAll(root, 'seed');
      write(join(root, 'dirty.txt'), 'dirty');
      expect(() => initProject('acme', { cwd: root, verify: false })).toThrow(
        /working tree is not clean/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('renames seed apps, removes template markers, and writes git-native provenance', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-init-'));
    try {
      mkdirSync(join(root, 'ws_apps/example-typescript'), { recursive: true });
      mkdirSync(join(root, 'ws_apps/example-python'), { recursive: true });
      mkdirSync(join(root, 'ws_apps/example-rust'), { recursive: true });
      write(
        join(root, 'ws_apps/example-typescript/package.json'),
        '{"name":"@example/typescript"}\n',
      );
      write(join(root, 'ws_apps/example-python/package.json'), '{"name":"@example/python"}\n');
      write(
        join(root, 'ws_apps/example-python/pyproject.toml'),
        '[project]\nname = "example-python"\n',
      );
      write(join(root, 'ws_apps/example-rust/package.json'), '{"name":"@example/rust"}\n');
      write(join(root, 'ws_apps/example-rust/Cargo.toml'), '[package]\nname = "example-rust"\n');
      write(join(root, 'pyproject.toml'), '[project]\nname = "agentic-harness-monorepo"\n');
      write(
        join(root, 'harness/observability/compose.harness.yml'),
        'name: agentic-harness-monorepo\n',
      );
      write(
        join(root, 'README.md'),
        'before\n<!-- TEMPLATE-DOC-START -->\ntemplate-only\n<!-- TEMPLATE-DOC-END -->\nafter\n',
      );
      write(join(root, 'TEMPLATE.md'), 'remove me\n');
      write(
        join(root, 'harness.manifest.json'),
        '{"name":"polyglot-monorepo","version":"0.4.0","standard":"0.2"}\n',
      );

      // Seed a git repo so initProject can resolve `origin` + HEAD for
      // the new git-native provenance.
      initRepo(root);
      git(root, [
        'remote',
        'add',
        'origin',
        'https://github.com/syntropic137/harness-app-template',
      ]);
      const headSha = commitAll(root, 'seed');

      initProject('acme', {
        cwd: root,
        force: true,
        verify: false,
        now: new Date('2026-05-30T00:00:00.000Z'),
      });

      expect(readFileSync(join(root, 'ws_apps/acme-typescript/package.json'), 'utf8')).toContain(
        '"@acme/typescript"',
      );
      expect(readFileSync(join(root, 'ws_apps/acme-python/pyproject.toml'), 'utf8')).toContain(
        'name = "acme-python"',
      );
      expect(readFileSync(join(root, 'ws_apps/acme-python/package.json'), 'utf8')).toContain(
        '"@acme/python"',
      );
      expect(readFileSync(join(root, 'ws_apps/acme-rust/Cargo.toml'), 'utf8')).toContain(
        'name = "acme-rust"',
      );
      expect(readFileSync(join(root, 'ws_apps/acme-rust/package.json'), 'utf8')).toContain(
        '"@acme/rust"',
      );
      expect(readFileSync(join(root, 'pyproject.toml'), 'utf8')).toContain('name = "acme-python"');
      expect(
        readFileSync(join(root, 'harness/observability/compose.harness.yml'), 'utf8'),
      ).toContain('name: acme');
      expect(readFileSync(join(root, 'README.md'), 'utf8')).not.toContain('template-only');
      const provenance = JSON.parse(readFileSync(join(root, '.harness-provenance.json'), 'utf8'));
      expect(provenance).toEqual({
        schemaVersion: '1.0',
        mode: 'fresh',
        template: 'polyglot-monorepo',
        templateVersion: '0.4.0',
        standardVersion: '0.2',
        canonical_repo: 'https://github.com/syntropic137/harness-app-template',
        canonical_commit: headSha,
        forked_at: '2026-05-30T00:00:00.000Z',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('falls back to default canonical repo URL when no git remote is set', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-init-noremote-'));
    try {
      mkdirSync(join(root, 'ws_apps/example-typescript'), { recursive: true });
      mkdirSync(join(root, 'ws_apps/example-python'), { recursive: true });
      mkdirSync(join(root, 'ws_apps/example-rust'), { recursive: true });
      write(
        join(root, 'ws_apps/example-typescript/package.json'),
        '{"name":"@example/typescript"}\n',
      );
      write(join(root, 'ws_apps/example-python/package.json'), '{"name":"@example/python"}\n');
      write(
        join(root, 'ws_apps/example-python/pyproject.toml'),
        '[project]\nname = "example-python"\n',
      );
      write(join(root, 'ws_apps/example-rust/package.json'), '{"name":"@example/rust"}\n');
      write(join(root, 'ws_apps/example-rust/Cargo.toml'), '[package]\nname = "example-rust"\n');
      write(join(root, 'pyproject.toml'), '[project]\nname = "agentic-harness-monorepo"\n');
      write(
        join(root, 'harness.manifest.json'),
        '{"name":"polyglot-monorepo","version":"0.4.0","standard":"0.2"}\n',
      );

      initRepo(root);
      commitAll(root, 'seed');

      initProject('acme', {
        cwd: root,
        force: true,
        verify: false,
        now: new Date('2026-05-30T00:00:00.000Z'),
      });

      const provenance = JSON.parse(readFileSync(join(root, '.harness-provenance.json'), 'utf8'));
      expect(provenance.canonical_repo).toBe(
        'https://github.com/syntropic137/harness-app-template',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('uses upstream remote when present and handles minimal non-git template copies', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-init-upstream-'));
    const minimal = mkdtempSync(join(tmpdir(), 'cha-init-minimal-'));
    const originalCwd = processCwd();
    try {
      mkdirSync(join(root, 'ws_apps/example-typescript'), { recursive: true });
      write(
        join(root, 'ws_apps/example-typescript/package.json'),
        '{"name":"@example/typescript"}\n',
      );
      write(
        join(root, 'harness.manifest.json'),
        '{"name":"polyglot-monorepo","version":"0.4.0","standard":"0.2"}\n',
      );
      initRepo(root);
      git(root, ['remote', 'add', 'upstream', 'https://github.com/example/canonical-template']);
      commitAll(root, 'seed');

      initProject('acme', {
        cwd: root,
        force: true,
        verify: false,
        now: new Date('2026-05-30T00:00:00.000Z'),
      });
      const upstreamProvenance = JSON.parse(
        readFileSync(join(root, '.harness-provenance.json'), 'utf8'),
      );
      expect(upstreamProvenance.canonical_repo).toBe(
        'https://github.com/example/canonical-template',
      );

      write(
        join(minimal, 'harness.manifest.json'),
        '{"name":"polyglot-monorepo","version":"0.4.0","standard":"0.2"}\n',
      );
      chdir(minimal);
      initProject('tiny', {
        force: true,
        verify: false,
        now: new Date('2026-05-30T00:00:00.000Z'),
      });
      const minimalProvenance = JSON.parse(
        readFileSync(join(minimal, '.harness-provenance.json'), 'utf8'),
      );
      expect(minimalProvenance.canonical_commit).toBe('unknown');
    } finally {
      chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
      rmSync(minimal, { recursive: true, force: true });
    }
  });
});
