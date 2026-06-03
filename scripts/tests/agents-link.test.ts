import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import type { AgentsLinkDeps } from '../agents-link';
import { main } from '../agents-link';
import type { VendorFs } from '../lib/vendor-links';

type LstatLike = {
  isSymbolicLink: () => boolean;
  isFile: () => boolean;
  isDirectory: () => boolean;
};

function fileStat(): LstatLike {
  return {
    isSymbolicLink: () => false,
    isFile: () => true,
    isDirectory: () => false,
  };
}

function linkStat(): LstatLike {
  return {
    isSymbolicLink: () => true,
    isFile: () => false,
    isDirectory: () => false,
  };
}

function dirStat(): LstatLike {
  return {
    isSymbolicLink: () => false,
    isFile: () => false,
    isDirectory: () => true,
  };
}

function otherStat(): LstatLike {
  return {
    isSymbolicLink: () => false,
    isFile: () => false,
    isDirectory: () => false,
  };
}

function vendorFsFixture(
  initial: Map<string, LstatLike | null>,
  readlinkTargets: Map<string, string> = new Map(),
  initialContents: Map<string, string> = new Map(),
): {
  fs: VendorFs;
  state: Map<string, LstatLike | null>;
  symlinks: Map<string, string>;
  contents: Map<string, string>;
} {
  const state = new Map(initial);
  const symlinks = new Map(readlinkTargets);
  const contents = new Map(initialContents);
  const fs: VendorFs = {
    lstat: (path: string) => state.get(path) ?? null,
    readlink: (path: string) => {
      const target = symlinks.get(path);
      if (target === undefined) {
        throw new Error(`unexpected readlink ${path}`);
      }
      return target;
    },
    unlink: (path: string) => {
      state.delete(path);
      symlinks.delete(path);
      contents.delete(path);
    },
    symlink: (target: string, path: string) => {
      state.set(path, linkStat());
      symlinks.set(path, target);
    },
    readFile: (path: string) => contents.get(path) ?? '',
    writeFile: (path: string, content: string) => {
      state.set(path, fileStat());
      contents.set(path, content);
    },
  };
  return { fs, state, symlinks, contents };
}

function captureDeps(overrides: Partial<AgentsLinkDeps>): AgentsLinkDeps & {
  stdoutLog: ReturnType<typeof vi.fn>;
  stderrError: ReturnType<typeof vi.fn>;
} {
  const stdoutLog = vi.fn();
  const stderrError = vi.fn();
  const exit = vi.fn((_code: number) => {
    throw new Error('__exit__');
  }) as unknown as (code: number) => never;
  return {
    stdout: { log: stdoutLog },
    stderr: { error: stderrError },
    exit,
    cwd: '/proj',
    platform: 'linux',
    ...overrides,
    stdoutLog,
    stderrError,
  };
}

describe('agents link', () => {
  test('uses process cwd, process platform, and real fs by default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-link-default-'));
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    const deps = captureDeps({ cwd: undefined, platform: undefined, vendorFs: undefined });

    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# canonical\n');

      main(deps);
      for (const name of ['CLAUDE.md', 'GEMINI.md', '.codex', '.gemini']) {
        const path = join(dir, name);
        expect(lstatSync(path).isSymbolicLink()).toBe(true);
        expect(readlinkSync(path)).toBe('AGENTS.md');
      }

      const secondRun = captureDeps({ cwd: undefined, platform: undefined, vendorFs: undefined });
      main(secondRun);
      expect(secondRun.stdoutLog).toHaveBeenCalledWith('agents link: vendor symlink CLAUDE.md ok');
    } finally {
      cwd.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('repairs missing symlinks on Unix-like platforms', () => {
    const { fs, symlinks } = vendorFsFixture(
      new Map([['/proj/AGENTS.md', fileStat()]]),
      new Map(),
      new Map([['/proj/AGENTS.md', '# canonical\n']]),
    );
    const deps = captureDeps({ vendorFs: fs });

    main(deps);

    expect(deps.exit).not.toHaveBeenCalled();
    expect(symlinks.get('/proj/CLAUDE.md')).toBe('AGENTS.md');
    expect(symlinks.get('/proj/.gemini')).toBe('AGENTS.md');
    expect(deps.stdoutLog).toHaveBeenCalledWith(
      'agents link: vendor symlink CLAUDE.md -> AGENTS.md (created)',
    );
    expect(deps.stdoutLog).toHaveBeenCalledWith('agents link: complete');
  });

  test('uses copy-sync mirrors on Windows', () => {
    const { fs, contents, state } = vendorFsFixture(
      new Map([
        ['/proj/AGENTS.md', fileStat()],
        ['/proj/CLAUDE.md', fileStat()],
        ['/proj/GEMINI.md', fileStat()],
        ['/proj/.gemini', linkStat()],
      ]),
      new Map([['/proj/.gemini', 'AGENTS.md']]),
      new Map([
        ['/proj/AGENTS.md', '# canonical\n'],
        ['/proj/CLAUDE.md', '# stale\n'],
        ['/proj/GEMINI.md', '# canonical\n'],
      ]),
    );
    const deps = captureDeps({ platform: 'win32', vendorFs: fs });

    main(deps);

    expect(deps.exit).not.toHaveBeenCalled();
    expect(contents.get('/proj/CLAUDE.md')).toBe('# canonical\n');
    expect(contents.get('/proj/GEMINI.md')).toBe('# canonical\n');
    expect(contents.get('/proj/.codex')).toBe('# canonical\n');
    expect(state.get('/proj/.gemini')?.isSymbolicLink()).toBe(true);
    expect(deps.stdoutLog).toHaveBeenCalledWith('agents link: vendor mirror .gemini ok');
    expect(deps.stdoutLog).toHaveBeenCalledWith(
      'agents link: vendor mirror CLAUDE.md <= AGENTS.md (refreshed copy)',
    );
    expect(deps.stdoutLog).toHaveBeenCalledWith('agents link: complete using copy-sync fallback');
  });

  test('uses the real fs for Windows copy-sync fallback', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-link-copy-'));
    const deps = captureDeps({ cwd: dir, platform: 'win32', vendorFs: undefined });

    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# canonical\n');
      writeFileSync(join(dir, 'CLAUDE.md'), '# stale\n');
      symlinkSync('legacy.md', join(dir, 'GEMINI.md'));

      main(deps);

      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# canonical\n');
      expect(readFileSync(join(dir, 'GEMINI.md'), 'utf8')).toBe('# canonical\n');
      expect(readFileSync(join(dir, '.codex'), 'utf8')).toBe('# canonical\n');
      expect(deps.stdoutLog).toHaveBeenCalledWith(
        'agents link: vendor mirror GEMINI.md <= AGENTS.md (replaced symlink from legacy.md)',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails when copy-sync mode has no canonical AGENTS.md', () => {
    const { fs } = vendorFsFixture(new Map());
    const deps = captureDeps({ platform: 'win32', vendorFs: fs });

    expect(() => main(deps)).toThrow('__exit__');
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.stderrError).toHaveBeenCalledWith(
      'agents link: AGENTS.md is missing or not a regular file; the canonical agent context must live there',
    );
  });

  test('fails rather than clobbering a directory in copy-sync mode', () => {
    const { fs } = vendorFsFixture(
      new Map([
        ['/proj/AGENTS.md', fileStat()],
        ['/proj/.codex', dirStat()],
      ]),
      new Map(),
      new Map([['/proj/AGENTS.md', '# canonical\n']]),
    );
    const deps = captureDeps({ platform: 'win32', vendorFs: fs });

    expect(() => main(deps)).toThrow('__exit__');
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.stderrError).toHaveBeenCalledWith(
      'agents link: .codex exists but is a directory; refusing to overwrite it',
    );
  });

  test('fails rather than clobbering an unsupported file type in copy-sync mode', () => {
    const { fs } = vendorFsFixture(
      new Map([
        ['/proj/AGENTS.md', fileStat()],
        ['/proj/.gemini', otherStat()],
      ]),
      new Map(),
      new Map([['/proj/AGENTS.md', '# canonical\n']]),
    );
    const deps = captureDeps({ platform: 'win32', vendorFs: fs });

    expect(() => main(deps)).toThrow('__exit__');
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.stderrError).toHaveBeenCalledWith(
      'agents link: .gemini has an unsupported file type; refusing to overwrite it',
    );
  });
});
