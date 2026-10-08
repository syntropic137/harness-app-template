// Proves the lefthook `beads-export` pre-commit job cannot clobber the tracked
// `.beads/issues.jsonl`, in either the tree being committed or any other tree.
//
// The regression (bd 1.0.4, observed twice): committing from a LINKED worktree
// whose bd database was empty (it existed, but held nothing) emptied the
// worktree's tracked export in the commit AND deleted the main checkout's copy.
// Two bd behaviours combined:
//   1. bd resolves its database through the git common dir, so in a linked
//      worktree it uses the MAIN checkout's `.beads/`, and its auto-export
//      (export.auto, default on) rewrites the main checkout's
//      `.beads/issues.jsonl` - deleting it when there are zero issues.
//   2. `bd export` of an empty-but-present database succeeds with 0 issues, and
//      the hook copied that over the tracked file and staged it.
//
// We extract the hook body from lefthook.yml (same technique as
// secret-scan.test.ts) and run it against a stub `bd` that reproduces exactly
// those two behaviours. The stub is fault injection: an uninitialised-but-present
// Dolt store cannot be built without `bd init`, whose side effects (a commit,
// core.hooksPath, .claude/settings.json) make it unfit for a unit test. It
// refuses to run unless APP_ENV=test (docs/development/mocks.md).

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url).pathname;
const TRACKED = '{"id":"t-1","title":"one"}\n{"id":"t-2","title":"two"}\n';

// Stub bd. DB lives in <main checkout>/.beads/fake-db (resolved via the git
// common dir, like the real bd). Absent file => "no beads database found".
const STUB_BD = `#!/bin/sh
[ "\${APP_ENV:-}" = "test" ] || { echo "stub bd refused: APP_ENV is not test" >&2; exit 97; }
common=$(git rev-parse --path-format=absolute --git-common-dir)
main=$(dirname "$common")
db="$main/.beads/fake-db"
if [ ! -f "$db" ]; then
  [ "$1" = "config" ] && { echo "Error: no beads database found" >&2; exit 1; }
  echo "Error: no beads database found" >&2
  exit 1
fi
if [ "$1" = "config" ] && [ "$2" = "get" ] && [ "$3" = "issue_prefix" ]; then
  if [ -f "$main/.beads/fake-uninit" ]; then echo "issue_prefix (not set)"; else echo "tst"; fi
  exit 0
fi
if [ -f "$main/.beads/fake-uninit" ] && [ "$1" = "export" ]; then
  : > "$3"
  echo "Exported 0 issues to $3"
  exit 0
fi
case "\${BD_EXPORT_AUTO:-true}" in
  false) ;;
  *) if grep -q . "$db"; then cp "$db" "$main/.beads/issues.jsonl"; else rm -f "$main/.beads/issues.jsonl"; fi ;;
esac
if [ "$1" = "export" ] && [ "$2" = "-o" ]; then
  cat "$db" > "$3"
  echo "Exported $(grep -c . "$db") issues to $3"
fi
exit 0
`;

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !k.startsWith('BD_') && !k.startsWith('BEADS_')) env[k] = v;
  }
  return env;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env: cleanEnv(), encoding: 'utf8' });
}

/** The whole beads-export job, exactly as lefthook.yml declares it (wrapper, quoting and all). */
function extractJob(): string {
  const yaml = readFileSync(join(ROOT, 'lefthook.yml'), 'utf8');
  const start = yaml.indexOf('    beads-export:');
  if (start < 0) throw new Error('beads-export hook not found in lefthook.yml');
  const end = yaml.indexOf('\n\n', start);
  return yaml.slice(start, end < 0 ? undefined : end);
}

const LEFTHOOK = join(ROOT, 'node_modules', '.bin', 'lefthook');

interface Fixture {
  base: string;
  main: string;
  worktree: string;
  stubDir: string;
}

const fixtures: string[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) rmSync(f, { recursive: true, force: true });
});

function makeFixture(): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'beads-export-hook-')));
  fixtures.push(base);
  const main = join(base, 'main');
  execFileSync('git', ['init', '-q', '-b', 'main', main], { env: cleanEnv() });
  git(main, ['config', 'core.hooksPath', '/dev/null']);
  git(main, ['config', 'user.email', 'test@test']);
  git(main, ['config', 'user.name', 'test']);
  mkdirSync(join(main, '.beads'));
  writeFileSync(join(main, '.beads', '.gitignore'), 'fake-db\nfake-uninit\n');
  writeFileSync(join(main, '.beads', 'issues.jsonl'), TRACKED);
  writeFileSync(join(main, 'lefthook.yml'), `pre-commit:\n  commands:\n${extractJob()}\n`);
  git(main, ['add', '.beads', 'lefthook.yml']);
  git(main, ['commit', '-q', '-m', 'init']);
  const worktree = join(base, 'wt');
  git(main, ['worktree', 'add', '-q', worktree, '-b', 'feature']);
  const stubDir = join(base, 'bin');
  mkdirSync(stubDir);
  writeFileSync(join(stubDir, 'bd'), STUB_BD);
  chmodSync(join(stubDir, 'bd'), 0o755);
  return { base, main, worktree, stubDir };
}

/** Run the job through the real lefthook, as `git commit` would. */
function runHook(fx: Fixture, cwd: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return spawnSync(
    LEFTHOOK,
    ['run', 'pre-commit', '--force', '--commands', 'beads-export', '--no-auto-install', '--no-tty'],
    {
      cwd,
      env: {
        ...cleanEnv(),
        APP_ENV: 'test',
        PATH: `${fx.stubDir}:${process.env.PATH}`,
        ...extraEnv,
      },
      encoding: 'utf8',
    },
  );
}

const jsonl = (tree: string) => join(tree, '.beads', 'issues.jsonl');
const staged = (tree: string) => git(tree, ['diff', '--cached', '--name-only']).trim();

describe('beads-export pre-commit hook', () => {
  it('refuses, and touches neither tree, when a linked worktree resolves to an empty db', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.main, '.beads', 'fake-db'), '');

    const r = runHook(fx, fx.worktree);

    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('REFUSING');
    expect(readFileSync(jsonl(fx.worktree), 'utf8')).toBe(TRACKED);
    expect(staged(fx.worktree)).toBe('');
    expect(existsSync(jsonl(fx.main))).toBe(true);
    expect(readFileSync(jsonl(fx.main), 'utf8')).toBe(TRACKED);
  });

  it('refuses the same shrink-to-empty in the main checkout', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.main, '.beads', 'fake-db'), '');

    const r = runHook(fx, fx.main);

    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('REFUSING');
    expect(readFileSync(jsonl(fx.main), 'utf8')).toBe(TRACKED);
    expect(staged(fx.main)).toBe('');
  });

  it('exports a populated db into the worktree only, and stages it there', () => {
    const fx = makeFixture();
    const updated = `${TRACKED}{"id":"t-3","title":"three"}\n`;
    writeFileSync(join(fx.main, '.beads', 'fake-db'), updated);

    const r = runHook(fx, fx.worktree);

    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(readFileSync(jsonl(fx.worktree), 'utf8')).toBe(updated);
    expect(staged(fx.worktree)).toBe('.beads/issues.jsonl');
    expect(readFileSync(jsonl(fx.main), 'utf8')).toBe(TRACKED);
    expect(staged(fx.main)).toBe('');
  });

  it('stages the export even when the working file already matches it', () => {
    const fx = makeFixture();
    const updated = `${TRACKED}{"id":"t-3","title":"three"}\n`;
    writeFileSync(join(fx.main, '.beads', 'fake-db'), updated);
    writeFileSync(jsonl(fx.worktree), updated);

    const r = runHook(fx, fx.worktree);

    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(staged(fx.worktree)).toBe('.beads/issues.jsonl');
  });

  it('allows an empty export once the user has staged an empty file', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.main, '.beads', 'fake-db'), '');
    writeFileSync(jsonl(fx.main), '');
    git(fx.main, ['add', '.beads/issues.jsonl']);

    const r = runHook(fx, fx.main);

    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
  });

  it('leaves no temp files behind', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.main, '.beads', 'fake-db'), '');

    runHook(fx, fx.worktree);

    expect(git(fx.worktree, ['status', '--porcelain', '--untracked-files=all']).trim()).toBe('');
  });

  it('still tolerates a fresh clone with no beads database (#78)', () => {
    const fx = makeFixture();

    const r = runHook(fx, fx.worktree);

    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(readFileSync(jsonl(fx.worktree), 'utf8')).toBe(TRACKED);
    expect(staged(fx.worktree)).toBe('');
  });

  it('allows an empty export when the tracked file is empty too', () => {
    const fx = makeFixture();
    writeFileSync(jsonl(fx.main), '');
    git(fx.main, ['commit', '-q', '-am', 'empty store']);
    writeFileSync(join(fx.main, '.beads', 'fake-db'), '');

    const r = runHook(fx, fx.main);

    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
  });

  it('fails other bd errors loudly', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.stubDir, 'bd'), '#!/bin/sh\necho "Error: dolt exploded" >&2\nexit 2\n');

    const r = runHook(fx, fx.worktree);

    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('dolt exploded');
    expect(readFileSync(jsonl(fx.worktree), 'utf8')).toBe(TRACKED);
  });

  it('skips, naming the way to enable it, when the db is uninitialised (no issue_prefix)', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.main, '.beads', 'fake-db'), '');
    writeFileSync(join(fx.main, '.beads', 'fake-uninit'), '');

    const r = runHook(fx, fx.worktree);

    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('bd init --prefix <prefix> && bd import');
    expect(readFileSync(jsonl(fx.worktree), 'utf8')).toBe(TRACKED);
    expect(staged(fx.worktree)).toBe('');
  });

  it('still refuses an INITIALISED db that returns 0 issues over a populated tracked file', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.main, '.beads', 'fake-db'), '');

    const r = runHook(fx, fx.worktree);

    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('REFUSING');
  });

  it('refuses to write through a symlinked .beads', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.main, '.beads', 'fake-db'), `${TRACKED}{"id":"t-3","title":"three"}\n`);
    const elsewhere = join(fx.base, 'elsewhere');
    mkdirSync(elsewhere);
    git(fx.worktree, ['rm', '-rq', '--cached', '.beads']);
    rmSync(join(fx.worktree, '.beads'), { recursive: true, force: true });
    symlinkSync(elsewhere, join(fx.worktree, '.beads'));

    const r = runHook(fx, fx.worktree);

    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('symlink');
    expect(existsSync(join(elsewhere, 'issues.jsonl'))).toBe(false);
  });

  it('refuses a symlinked issues.jsonl destination', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.main, '.beads', 'fake-db'), `${TRACKED}{"id":"t-3","title":"three"}\n`);
    rmSync(jsonl(fx.worktree));
    symlinkSync(jsonl(fx.main), jsonl(fx.worktree));

    const r = runHook(fx, fx.worktree);

    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('symlink');
    expect(readFileSync(jsonl(fx.main), 'utf8')).toBe(TRACKED);
  });

  it('stages an export that is new to the index', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.main, '.beads', 'fake-db'), TRACKED);
    git(fx.worktree, ['rm', '-q', '--cached', '.beads/issues.jsonl']);
    git(fx.worktree, ['commit', '-q', '-m', 'untrack export']);

    const r = runHook(fx, fx.worktree);

    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(staged(fx.worktree)).toBe('.beads/issues.jsonl');
  });

  it('does not stage a gitignored export', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.main, '.beads', 'fake-db'), TRACKED);
    git(fx.worktree, ['rm', '-q', '--cached', '.beads/issues.jsonl']);
    writeFileSync(join(fx.worktree, '.gitignore'), '.beads/issues.jsonl\n');
    git(fx.worktree, ['add', '.gitignore']);
    git(fx.worktree, ['commit', '-q', '-m', 'ignore export']);

    const r = runHook(fx, fx.worktree);

    expect(r.status, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(0);
    expect(staged(fx.worktree)).toBe('');
  });

  it('removes its temp file when terminated', () => {
    const fx = makeFixture();
    writeFileSync(join(fx.main, '.beads', 'fake-db'), `${TRACKED}{"id":"t-3","title":"three"}\n`);
    writeFileSync(
      join(fx.stubDir, 'bd'),
      `#!/bin/sh\n[ "$1" = config ] && { echo tst; exit 0; }\nkill -TERM $PPID 2>/dev/null\nsleep 5\n`,
    );

    runHook(fx, fx.worktree);

    expect(git(fx.worktree, ['status', '--porcelain', '--untracked-files=all']).trim()).toBe('');
  });
});
