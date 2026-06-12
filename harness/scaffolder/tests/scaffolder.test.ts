import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

// The scaffolder slot ships as .mjs with no sibling .d.ts; the test
// imports it dynamically and asserts the public surface inline. Each
// destructured binding is hand-typed so the tests stay strict-mode safe
// without leaking `any` through biome's lint surface.
// @ts-expect-error plain .mjs module without type declarations
import * as scaffolderMod from '../scaffolder.mjs';

interface ScaffolderModule {
  COPY_SKIP_DIRS: Set<string>;
  HELP_TEXT: string;
  applyStripList: (dest: string, paths: string[], deps: Record<string, unknown>) => string[];
  copyTemplate: (src: string, dest: string, skip: string[], deps: Record<string, unknown>) => void;
  defaultDeps: () => Record<string, unknown> & {
    cwd: () => string;
    env: () => NodeJS.ProcessEnv;
    entryDir: () => string;
    readFile: (p: string) => string;
    existsSync: (p: string) => boolean;
    lstatSync: (p: string) => { isDirectory(): boolean; isSymbolicLink(): boolean };
    readdirSync: (p: string) => string[];
    mkdirSync: (p: string, o?: unknown) => void;
    cpSync: (from: string, to: string, opts?: unknown) => void;
    rmSync: (p: string, opts?: unknown) => void;
    symlinkSync: (target: string, dest: string) => void;
    readlinkSync: (p: string) => string;
    spawnSync: (cmd: string, args: string[], opts?: unknown) => { status: number };
    log: (msg: string) => void;
    errorLog: (msg: string) => void;
    exit: (code: number) => void;
  };
  defaultStripList: (deps: { entryDir: () => string }) => string;
  defaultTemplateRoot: (deps: { entryDir: () => string }) => string;
  gitInitCommit: (dest: string, deps: Record<string, unknown>) => void;
  main: (argv: string[], deps: Record<string, unknown>) => void;
  nextStepsBanner: (name: string, dest: string) => string;
  parseArgs: (argv: string[]) => {
    name: string | null;
    yes: boolean;
    dryRun: boolean;
    noGit: boolean;
    help: boolean;
    version: boolean;
    templateRoot: string | null;
    dest: string | null;
    stripList: string | null;
  };
  planSummary: (input: {
    name: string;
    templateRoot: string;
    dest: string;
    stripList: string[];
    noGit: boolean;
  }) => string;
  readStripList: (path: string, deps: Record<string, unknown>) => string[];
  runInit: (dest: string, name: string, deps: Record<string, unknown>) => void;
  scaffold: (
    opts: Record<string, unknown>,
    deps: Record<string, unknown>,
  ) => { dest: string; ranInit: boolean; ranGit: boolean; removed?: string[] };
  validateProjectName: (name: unknown) => void;
}

const mod = scaffolderMod as unknown as ScaffolderModule;
const {
  COPY_SKIP_DIRS,
  HELP_TEXT,
  applyStripList,
  copyTemplate,
  defaultDeps,
  defaultStripList,
  defaultTemplateRoot,
  gitInitCommit,
  main,
  nextStepsBanner,
  parseArgs,
  planSummary,
  readStripList,
  runInit,
  scaffold,
  validateProjectName,
} = mod;

interface FakeFs {
  files: Map<string, string>;
  dirs: Set<string>;
}

function emptyFs(): FakeFs {
  return { files: new Map(), dirs: new Set([]) };
}

function addParentDirs(fs: FakeFs, path: string): void {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join('/');
    if (dir !== '') fs.dirs.add(dir);
  }
}

function writeFakeFile(fs: FakeFs, path: string, content: string): void {
  fs.files.set(path, content);
  addParentDirs(fs, path);
}

function writeFakeDir(fs: FakeFs, path: string): void {
  fs.dirs.add(path);
  addParentDirs(fs, `${path}/.placeholder`);
}

function isDirFake(fs: FakeFs, path: string): boolean {
  return fs.dirs.has(path);
}

function existsFake(fs: FakeFs, path: string): boolean {
  return fs.dirs.has(path) || fs.files.has(path);
}

function readdirFake(fs: FakeFs, path: string): string[] {
  const out = new Set<string>();
  const prefix = path === '' ? '' : `${path}/`;
  for (const dir of fs.dirs) {
    if (dir === path) continue;
    if (dir.startsWith(prefix)) {
      const rest = dir.slice(prefix.length);
      if (!rest.includes('/')) out.add(rest);
    }
  }
  for (const file of fs.files.keys()) {
    if (file.startsWith(prefix)) {
      const rest = file.slice(prefix.length);
      if (!rest.includes('/')) out.add(rest);
    }
  }
  return Array.from(out).sort();
}

function rmFake(fs: FakeFs, path: string): void {
  const dirPrefix = `${path}/`;
  fs.files.delete(path);
  fs.dirs.delete(path);
  for (const file of Array.from(fs.files.keys())) {
    if (file.startsWith(dirPrefix)) fs.files.delete(file);
  }
  for (const dir of Array.from(fs.dirs)) {
    if (dir.startsWith(dirPrefix)) fs.dirs.delete(dir);
  }
}

function makeDeps(
  overrides: Record<string, unknown> = {},
  fs: FakeFs = emptyFs(),
): {
  deps: Record<string, unknown>;
  fs: FakeFs;
  logs: string[];
  errors: string[];
  exits: number[];
  spawnCalls: Array<{ cmd: string; args: string[]; cwd?: string }>;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const exits: number[] = [];
  const spawnCalls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
  const deps: Record<string, unknown> = {
    readFile: (path: string) => {
      const v = fs.files.get(path);
      if (v !== undefined) return v;
      throw new Error(`fake readFile: missing ${path}`);
    },
    existsSync: (path: string) => existsFake(fs, path),
    lstatSync: (path: string) => ({
      isDirectory: () => isDirFake(fs, path),
      isFile: () => fs.files.has(path),
      isSymbolicLink: () => false,
    }),
    readdirSync: (path: string) => readdirFake(fs, path),
    mkdirSync: (path: string) => {
      writeFakeDir(fs, path);
    },
    cpSync: (from: string, to: string) => {
      writeFakeFile(fs, to, fs.files.get(from) ?? '');
    },
    rmSync: (path: string) => {
      rmFake(fs, path);
    },
    symlinkSync: (target: string, dest: string) => {
      writeFakeFile(fs, dest, `symlink:${target}`);
    },
    readlinkSync: (path: string) => {
      const v = fs.files.get(path);
      if (v?.startsWith('symlink:')) return v.slice('symlink:'.length);
      throw new Error(`fake readlinkSync: not a symlink ${path}`);
    },
    spawnSync: (cmd: string, args: string[], opts: Record<string, unknown>) => {
      spawnCalls.push({ cmd, args, cwd: opts?.cwd as string | undefined });
      return { status: 0 };
    },
    cwd: () => '/cwd',
    env: () => ({}),
    entryDir: () => '/template/harness/scaffolder',
    log: (msg: string) => logs.push(msg),
    errorLog: (msg: string) => errors.push(msg),
    exit: (code: number) => exits.push(code),
  };
  for (const [k, v] of Object.entries(overrides)) {
    deps[k] = v;
  }
  return { deps, fs, logs, errors, exits, spawnCalls };
}

describe('validateProjectName', () => {
  test('accepts npm-safe names', () => {
    expect(() => validateProjectName('acme')).not.toThrow();
    expect(() => validateProjectName('acme-app-2')).not.toThrow();
  });
  test('rejects invalid names', () => {
    expect(() => validateProjectName('Acme')).toThrow(/project name/);
    expect(() => validateProjectName('1bad_name')).toThrow(/project name/);
    expect(() => validateProjectName(123 as unknown as string)).toThrow(/project name/);
    expect(() => validateProjectName('a'.repeat(215))).toThrow(/project name/);
  });
});

describe('parseArgs', () => {
  test('parses every documented flag', () => {
    expect(
      parseArgs([
        'acme',
        '--yes',
        '--dry-run',
        '--no-git',
        '--template-root',
        '/tmp/t',
        '--dest',
        '/tmp/d',
        '--strip-list',
        '/tmp/s.json',
      ]),
    ).toEqual({
      name: 'acme',
      yes: true,
      dryRun: true,
      noGit: true,
      help: false,
      version: false,
      templateRoot: '/tmp/t',
      dest: '/tmp/d',
      stripList: '/tmp/s.json',
    });
  });

  test('accepts short flags and missing value-args', () => {
    expect(parseArgs(['-y', '-h', '-V'])).toMatchObject({
      yes: true,
      help: true,
      version: true,
      name: null,
    });
    expect(parseArgs(['--template-root'])).toMatchObject({ templateRoot: null });
    expect(parseArgs(['--dest'])).toMatchObject({ dest: null });
    expect(parseArgs(['--strip-list'])).toMatchObject({ stripList: null });
  });

  test('rejects unknown options and extra positionals', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(/unknown option/);
    expect(() => parseArgs(['a', 'b'])).toThrow(/unexpected positional/);
  });
});

describe('readStripList', () => {
  test('returns the paths array', () => {
    const fs = emptyFs();
    writeFakeFile(fs, '/strip.json', JSON.stringify({ paths: ['.beads', 'TEMPLATE.md'] }));
    const { deps } = makeDeps({}, fs);
    expect(readStripList('/strip.json', deps)).toEqual(['.beads', 'TEMPLATE.md']);
  });
  test('rejects missing or malformed lists', () => {
    const fs = emptyFs();
    writeFakeFile(fs, '/none.json', JSON.stringify({}));
    writeFakeFile(fs, '/abs.json', JSON.stringify({ paths: ['/etc'] }));
    writeFakeFile(fs, '/empty.json', JSON.stringify({ paths: [''] }));
    writeFakeFile(fs, '/dotdot.json', JSON.stringify({ paths: ['../escape'] }));
    const { deps } = makeDeps({}, fs);
    expect(() => readStripList('/none.json', deps)).toThrow(/missing "paths"/);
    expect(() => readStripList('/abs.json', deps)).toThrow(/relative/);
    expect(() => readStripList('/empty.json', deps)).toThrow(/non-empty strings/);
    expect(() => readStripList('/dotdot.json', deps)).toThrow(/relative/);
  });
});

describe('copyTemplate', () => {
  test('copies tree skipping COPY_SKIP_DIRS and strip-list paths', () => {
    const fs = emptyFs();
    writeFakeFile(fs, '/src/README.md', '# hi');
    writeFakeFile(fs, '/src/scripts/init.ts', 'init');
    writeFakeFile(fs, '/src/node_modules/x/index.js', 'should-skip');
    writeFakeFile(fs, '/src/.git/HEAD', 'should-skip');
    writeFakeFile(fs, '/src/docs/superpowers/specs/spec.md', 'strip');
    writeFakeFile(fs, '/src/TEMPLATE.md', 'strip');
    writeFakeDir(fs, '/src/.beads');
    writeFakeFile(fs, '/src/keep.txt', 'keep');
    const { deps } = makeDeps({}, fs);
    copyTemplate('/src', '/dest', ['TEMPLATE.md', 'docs/superpowers/specs', '.beads'], deps);
    expect(fs.files.get('/dest/README.md')).toBe('# hi');
    expect(fs.files.get('/dest/scripts/init.ts')).toBe('init');
    expect(fs.files.get('/dest/keep.txt')).toBe('keep');
    expect(fs.files.has('/dest/node_modules/x/index.js')).toBe(false);
    expect(fs.files.has('/dest/.git/HEAD')).toBe(false);
    expect(fs.files.has('/dest/docs/superpowers/specs/spec.md')).toBe(false);
    expect(fs.files.has('/dest/TEMPLATE.md')).toBe(false);
    expect(fs.dirs.has('/dest/.beads')).toBe(false);
  });

  test('skips a worktree-style .git FILE, not just a .git directory', () => {
    // In a git worktree, .git is a regular file containing a `gitdir:`
    // pointer. The type-only skip in an earlier version of this code let
    // it through and broke the in-init `git status` check downstream.
    const fs = emptyFs();
    writeFakeFile(fs, '/src/.git', 'gitdir: /elsewhere');
    writeFakeFile(fs, '/src/keep.txt', 'keep');
    const { deps } = makeDeps({}, fs);
    copyTemplate('/src', '/dest', [], deps);
    expect(fs.files.has('/dest/.git')).toBe(false);
    expect(fs.files.get('/dest/keep.txt')).toBe('keep');
  });

  test('preserves symlinks verbatim with the original target', () => {
    const fs = emptyFs();
    writeFakeFile(fs, '/src/AGENTS.md', '# agents');
    writeFakeFile(fs, '/src/CLAUDE.md', 'symlink:AGENTS.md');
    writeFakeDir(fs, '/src');
    const overrides = {
      lstatSync: (path: string) => ({
        isDirectory: () => isDirFake(fs, path),
        isFile: () => fs.files.has(path),
        isSymbolicLink: () => fs.files.get(path)?.startsWith('symlink:') === true,
      }),
    };
    const { deps } = makeDeps(overrides, fs);
    copyTemplate('/src', '/dest', [], deps);
    expect(fs.files.get('/dest/AGENTS.md')).toBe('# agents');
    expect(fs.files.get('/dest/CLAUDE.md')).toBe('symlink:AGENTS.md');
  });

  test('exposes COPY_SKIP_DIRS as a Set of build/cache dirs', () => {
    expect(COPY_SKIP_DIRS.has('node_modules')).toBe(true);
    expect(COPY_SKIP_DIRS.has('.git')).toBe(true);
  });
});

describe('applyStripList', () => {
  test('removes only the paths that exist', () => {
    const fs = emptyFs();
    writeFakeDir(fs, '/dest/.beads');
    writeFakeFile(fs, '/dest/TEMPLATE.md', 'x');
    const { deps } = makeDeps({}, fs);
    const removed = applyStripList('/dest', ['.beads', 'TEMPLATE.md', 'docs/missing'], deps);
    expect(removed.sort()).toEqual(['.beads', 'TEMPLATE.md']);
    expect(fs.dirs.has('/dest/.beads')).toBe(false);
    expect(fs.files.has('/dest/TEMPLATE.md')).toBe(false);
  });
});

describe('runInit', () => {
  test('shells out to bun run scripts/init.ts <name> --no-verify', () => {
    const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const deps = {
      ...defaultDeps(),
      spawnSync: (cmd: string, args: string[], opts: Record<string, unknown>) => {
        calls.push({ cmd, args, cwd: opts?.cwd as string });
        return { status: 0 };
      },
    };
    runInit('/dest', 'acme', deps);
    expect(calls).toEqual([
      { cmd: 'bun', args: ['run', 'scripts/init.ts', 'acme', '--no-verify'], cwd: '/dest' },
    ]);
  });

  test('throws on spawn error or non-zero status', () => {
    const depsError = {
      ...defaultDeps(),
      spawnSync: () => ({ error: new Error('boom') }),
    };
    expect(() => runInit('/dest', 'acme', depsError)).toThrow(/boom/);
    const depsBad = {
      ...defaultDeps(),
      spawnSync: () => ({ status: 2 }),
    };
    expect(() => runInit('/dest', 'acme', depsBad)).toThrow(/exited 2/);
  });
});

describe('gitInitCommit', () => {
  test('runs init / add / commit with hooks suppressed', () => {
    const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
    const deps = {
      ...defaultDeps(),
      env: () => ({}),
      spawnSync: (_cmd: string, args: string[], opts: Record<string, unknown>) => {
        calls.push({ args, env: opts?.env as Record<string, string> });
        return { status: 0 };
      },
    };
    gitInitCommit('/dest', deps);
    expect(calls.length).toBe(3);
    expect(calls[0].args.slice(0, 4)).toEqual(['-c', 'core.hooksPath=/dev/null', 'init', '-q']);
    expect(calls[1].args.slice(2, 4)).toEqual(['add', '-A']);
    expect(calls[2].args.slice(2, 5)).toEqual(['commit', '-q', '-m']);
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('create-harness-app');
  });

  test('preserves caller-supplied author env', () => {
    const calls: Array<{ env: Record<string, string> }> = [];
    const deps = {
      ...defaultDeps(),
      env: () => ({ GIT_AUTHOR_NAME: 'caller', GIT_COMMITTER_EMAIL: 'caller@example.com' }),
      spawnSync: (_cmd: string, _args: string[], opts: Record<string, unknown>) => {
        calls.push({ env: opts?.env as Record<string, string> });
        return { status: 0 };
      },
    };
    gitInitCommit('/dest', deps);
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('caller');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('create-harness-app@local');
    expect(calls[0].env.GIT_COMMITTER_EMAIL).toBe('caller@example.com');
  });

  test('throws on spawn error or non-zero status', () => {
    const errorDeps = {
      ...defaultDeps(),
      env: () => ({}),
      spawnSync: () => ({ error: new Error('git fail') }),
    };
    expect(() => gitInitCommit('/dest', errorDeps)).toThrow(/git fail/);
    let call = 0;
    const failDeps = {
      ...defaultDeps(),
      env: () => ({}),
      spawnSync: () => {
        call += 1;
        return { status: call === 1 ? 0 : 9 };
      },
    };
    expect(() => gitInitCommit('/dest', failDeps)).toThrow(/git add exited 9/);
  });
});

describe('scaffold', () => {
  test('dry-run prints plan and returns without writes', () => {
    const fs = emptyFs();
    writeFakeFile(
      fs,
      '/template/harness/scaffolder/strip-list.json',
      JSON.stringify({ paths: ['.beads'] }),
    );
    const { deps, logs, spawnCalls } = makeDeps({}, fs);
    const out = scaffold({ name: 'acme', dryRun: true, noGit: false }, deps);
    expect(out.ranInit).toBe(false);
    expect(out.ranGit).toBe(false);
    expect(spawnCalls).toEqual([]);
    expect(logs[0]).toMatch(/would scaffold acme/);
  });

  test('full path: copy, strip, run init, git, banner', () => {
    const fs = emptyFs();
    writeFakeFile(
      fs,
      '/template/harness/scaffolder/strip-list.json',
      JSON.stringify({ paths: ['.beads', 'TEMPLATE.md'] }),
    );
    writeFakeFile(fs, '/template/README.md', '# t');
    writeFakeFile(fs, '/template/TEMPLATE.md', 'remove me');
    writeFakeDir(fs, '/template/.beads');
    writeFakeFile(fs, '/template/scripts/init.ts', 'init');
    const { deps, logs, spawnCalls } = makeDeps({}, fs);
    const out = scaffold({ name: 'acme', dryRun: false, noGit: false }, deps);
    expect(out.dest).toBe('/cwd/acme');
    expect(out.ranInit).toBe(true);
    expect(out.ranGit).toBe(true);
    expect(out.removed?.sort()).toEqual([]);
    expect(fs.files.get('/cwd/acme/README.md')).toBe('# t');
    expect(fs.files.has('/cwd/acme/TEMPLATE.md')).toBe(false);
    const initCall = spawnCalls.find((c) => c.cmd === 'bun');
    expect(initCall?.args).toEqual(['run', 'scripts/init.ts', 'acme', '--no-verify']);
    const gitCalls = spawnCalls.filter((c) => c.cmd === 'git');
    expect(gitCalls.length).toBe(3);
    expect(logs.some((l) => l.includes('created acme'))).toBe(true);
  });

  test('full path with --no-git skips git but still runs init', () => {
    const fs = emptyFs();
    writeFakeFile(
      fs,
      '/template/harness/scaffolder/strip-list.json',
      JSON.stringify({ paths: [] }),
    );
    writeFakeFile(fs, '/template/scripts/init.ts', 'init');
    const { deps, spawnCalls } = makeDeps({}, fs);
    const out = scaffold({ name: 'acme', dryRun: false, noGit: true }, deps);
    expect(out.ranGit).toBe(false);
    expect(spawnCalls.some((c) => c.cmd === 'git')).toBe(false);
  });

  test('refuses non-empty destination', () => {
    const fs = emptyFs();
    writeFakeFile(
      fs,
      '/template/harness/scaffolder/strip-list.json',
      JSON.stringify({ paths: [] }),
    );
    writeFakeFile(fs, '/cwd/acme/existing.txt', 'x');
    const { deps } = makeDeps({}, fs);
    expect(() => scaffold({ name: 'acme', dryRun: false, noGit: true }, deps)).toThrow(/not empty/);
  });

  test('allows empty pre-existing destination', () => {
    const fs = emptyFs();
    writeFakeFile(
      fs,
      '/template/harness/scaffolder/strip-list.json',
      JSON.stringify({ paths: [] }),
    );
    writeFakeFile(fs, '/template/scripts/init.ts', 'init');
    writeFakeDir(fs, '/cwd/acme');
    const { deps } = makeDeps({}, fs);
    expect(() => scaffold({ name: 'acme', dryRun: false, noGit: true }, deps)).not.toThrow();
  });

  test('honors --template-root / --strip-list / --dest overrides', () => {
    const fs = emptyFs();
    writeFakeFile(fs, '/altstrip.json', JSON.stringify({ paths: [] }));
    writeFakeFile(fs, '/altroot/scripts/init.ts', 'init');
    const { deps, spawnCalls } = makeDeps({}, fs);
    const out = scaffold(
      {
        name: 'acme',
        dryRun: false,
        noGit: true,
        templateRoot: '/altroot',
        stripList: '/altstrip.json',
        dest: '/somewhere/acme',
      },
      deps,
    );
    expect(out.dest).toBe('/somewhere/acme');
    expect(spawnCalls.find((c) => c.cmd === 'bun')?.cwd).toBe('/somewhere/acme');
  });
});

describe('main', () => {
  test('--help prints HELP_TEXT and exits 0', () => {
    const { deps, logs, exits } = makeDeps();
    main(['--help'], deps);
    expect(logs[0]).toBe(HELP_TEXT);
    expect(exits).toEqual([0]);
  });

  test('--version prints the package version', () => {
    const fs = emptyFs();
    writeFakeFile(
      fs,
      '/template/harness/scaffolder/package.json',
      JSON.stringify({ version: '9.9.9' }),
    );
    const { deps, logs, exits } = makeDeps({}, fs);
    main(['--version'], deps);
    expect(logs[0]).toBe('9.9.9');
    expect(exits).toEqual([0]);
  });

  test('--version falls back when package.json is missing', () => {
    const { deps, logs, exits } = makeDeps();
    main(['--version'], deps);
    expect(logs[0]).toBe('0.0.0');
    expect(exits).toEqual([0]);
  });

  test('--version falls back when package.json has no version field', () => {
    const fs = emptyFs();
    writeFakeFile(fs, '/template/harness/scaffolder/package.json', JSON.stringify({}));
    const { deps, logs, exits } = makeDeps({}, fs);
    main(['--version'], deps);
    expect(logs[0]).toBe('0.0.0');
    expect(exits).toEqual([0]);
  });

  test('parse error exits 64 with help text', () => {
    const { deps, errors, exits } = makeDeps();
    main(['--bogus'], deps);
    expect(errors[0]).toMatch(/error: unknown option/);
    expect(errors[1]).toBe(HELP_TEXT);
    expect(exits).toEqual([64]);
  });

  test('missing name exits 64', () => {
    const { deps, errors, exits } = makeDeps();
    main([], deps);
    expect(errors[0]).toMatch(/missing required <name>/);
    expect(exits).toEqual([64]);
  });

  test('successful scaffold exits 0', () => {
    const fs = emptyFs();
    writeFakeFile(
      fs,
      '/template/harness/scaffolder/strip-list.json',
      JSON.stringify({ paths: [] }),
    );
    const { deps, exits } = makeDeps({}, fs);
    main(['acme', '--dry-run', '--yes'], deps);
    expect(exits).toEqual([0]);
  });

  test('scaffold failure exits 1 with error message', () => {
    const { deps, errors, exits } = makeDeps();
    main(['Bad_Name'], deps);
    expect(errors[0]).toMatch(/error: project name/);
    expect(exits).toEqual([1]);
  });

  test('scaffold failure with non-Error throwable still exits 1', () => {
    const fs = emptyFs();
    writeFakeFile(
      fs,
      '/template/harness/scaffolder/strip-list.json',
      JSON.stringify({ paths: [] }),
    );
    const { deps, errors, exits } = makeDeps(
      {
        // Make spawnSync throw a non-Error to hit the String() branch.
        mkdirSync: () => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw 'plain-string';
        },
      },
      fs,
    );
    main(['acme', '--yes'], deps);
    expect(errors[0]).toBe('error: plain-string');
    expect(exits).toEqual([1]);
  });
});

describe('defaults and helpers', () => {
  test('defaultTemplateRoot resolves two parents up from entry dir', () => {
    const deps = { entryDir: () => '/repo/harness/scaffolder' };
    expect(defaultTemplateRoot(deps)).toBe('/repo');
  });
  test('defaultStripList joins entry dir + strip-list.json', () => {
    const deps = { entryDir: () => '/repo/harness/scaffolder' };
    expect(defaultStripList(deps)).toBe('/repo/harness/scaffolder/strip-list.json');
  });
  test('nextStepsBanner renders three commands', () => {
    expect(nextStepsBanner('acme', '/dest/acme')).toContain('cd /dest/acme');
    expect(nextStepsBanner('acme', '/dest/acme')).toContain('just bootstrap');
    expect(nextStepsBanner('acme', '/dest/acme')).toContain('just fitness');
  });
  test('planSummary reports git mode toggled by noGit', () => {
    const a = planSummary({
      name: 'acme',
      templateRoot: '/t',
      dest: '/d',
      stripList: ['.beads'],
      noGit: false,
    });
    const b = planSummary({
      name: 'acme',
      templateRoot: '/t',
      dest: '/d',
      stripList: [],
      noGit: true,
    });
    expect(a).toContain('git:      init + commit');
    expect(b).toContain('git:      skip');
    expect(b).toContain('(empty)');
  });
  test('defaultDeps wires every required surface', () => {
    const deps = defaultDeps();
    for (const key of [
      'readFile',
      'existsSync',
      'lstatSync',
      'readdirSync',
      'mkdirSync',
      'cpSync',
      'rmSync',
      'symlinkSync',
      'readlinkSync',
      'spawnSync',
      'log',
      'errorLog',
      'exit',
    ] as const) {
      expect(typeof (deps as Record<string, unknown>)[key]).toBe('function');
    }
    expect(deps.cwd()).toBe(process.cwd());
    expect(deps.env()).toBe(process.env);
    expect(deps.entryDir().endsWith('harness/scaffolder')).toBe(true);
  });
  test('defaultDeps.log / errorLog write to the right streams', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const deps = defaultDeps();
      deps.log('out');
      deps.errorLog('err');
      expect(stdoutSpy).toHaveBeenCalledWith('out\n');
      expect(stderrSpy).toHaveBeenCalledWith('err\n');
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  test('defaultDeps.exit forwards to process.exit', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      defaultDeps().exit(42);
      expect(exitSpy).toHaveBeenCalledWith(42);
    } finally {
      exitSpy.mockRestore();
    }
  });

  test('defaultDeps filesystem surfaces operate on a real tmpdir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scaffolder-deps-'));
    try {
      const deps = defaultDeps();
      deps.mkdirSync(join(dir, 'sub'), { recursive: true });
      // cpSync (file copy) round-trip: write a source file via the raw
      // fs API, copy it through deps.cpSync, then re-read it through
      // deps.readFile to exercise both bindings.
      const src = join(dir, 'src.txt');
      const dst = join(dir, 'sub', 'dst.txt');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('node:fs');
      fs.writeFileSync(src, 'hello');
      deps.cpSync(src, dst, { preserveTimestamps: true });
      expect(deps.readFile(dst)).toBe('hello');
      expect(deps.existsSync(dst)).toBe(true);
      expect(deps.lstatSync(dst).isDirectory()).toBe(false);
      expect(deps.lstatSync(dst).isSymbolicLink()).toBe(false);
      expect(deps.readdirSync(join(dir, 'sub'))).toEqual(['dst.txt']);
      // Symlink round-trip: create one via deps.symlinkSync and read its
      // target back via deps.readlinkSync. lstatSync must report the
      // symbolic-link flag without dereferencing.
      const linkPath = join(dir, 'link.txt');
      deps.symlinkSync('src.txt', linkPath);
      expect(deps.lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(deps.readlinkSync(linkPath)).toBe('src.txt');
      deps.rmSync(join(dir, 'sub'), { recursive: true, force: true });
      expect(deps.existsSync(join(dir, 'sub'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('defaultDeps.spawnSync runs a trivial command', () => {
    const deps = defaultDeps();
    const result = deps.spawnSync('node', ['-e', 'process.exit(0)']);
    expect(result.status).toBe(0);
  });
});

describe('integration: --dry-run against a tmpdir', () => {
  test('reads the real strip-list.json without touching anything', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scaffolder-dryrun-'));
    try {
      const logs: string[] = [];
      const deps = {
        ...defaultDeps(),
        log: (msg: string) => logs.push(msg),
        cwd: () => dir,
      };
      // Dry-run only touches the strip-list and prints the plan; no
      // copy, no spawn, no git. Safe to run against the real template.
      scaffold({ name: 'acme', dryRun: true, noGit: false }, deps);
      expect(logs[0]).toMatch(/would scaffold acme/);
      expect(logs[0]).toMatch(/strip:.*paths/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('bin entry', () => {
  test('runs as a real subprocess and prints --help', () => {
    // The bin shim just dispatches to scaffolder.mjs#main. Exercise it
    // as a real subprocess so the entrypoint module is actually
    // evaluated (vitest's static-import analyser cannot dynamically
    // import a sibling .mjs without erroring).
    const { spawnSync } = require('node:child_process');
    const { resolve } = require('node:path');
    const bin = resolve(__dirname, '..', 'bin', 'create-harness-app.mjs');
    const result = spawnSync('node', [bin, '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('create-harness-app <name>');
  });
});
