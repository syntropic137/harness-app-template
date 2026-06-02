import { lstatSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  type BootstrapDeps,
  detectEsbuildMismatches,
  detectMissingTools,
  main,
  platformArchSlug,
  repairEsbuildMismatch,
  VENDOR_SYMLINKS,
  type VendorFs,
  verifyAndRepairVendorLinks,
} from '../bootstrap';

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

function vendorFsFixture(
  initial: Map<string, LstatLike | null>,
  readlinkTargets: Map<string, string> = new Map(),
): {
  fs: VendorFs;
  state: Map<string, LstatLike | null>;
  symlinks: Map<string, string>;
} {
  const state = new Map(initial);
  const symlinks = new Map(readlinkTargets);
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
    },
    symlink: (target: string, path: string) => {
      state.set(path, linkStat());
      symlinks.set(path, target);
    },
    exists: (path: string) => state.has(path),
  };
  return { fs, state, symlinks };
}

type SpawnResultLike = { status: number; stdout?: string; stderr?: string };

function spawnRouter(
  routes: Array<(command: string, args: readonly string[]) => SpawnResultLike | undefined>,
): ReturnType<typeof vi.fn> {
  return vi.fn((command: string, args: readonly string[] = []) => {
    for (const route of routes) {
      const result = route(command, args);
      if (result) {
        return result;
      }
    }
    return { status: 0 };
  });
}

function captureSinks() {
  const stdoutLog = vi.fn();
  const stderrError = vi.fn();
  const exit = vi.fn((_code: number) => {
    throw new Error('__exit__');
  }) as unknown as (code: number) => never;
  return {
    stdout: { log: stdoutLog },
    stderr: { error: stderrError },
    exit,
    stdoutLog,
    stderrError,
  };
}

function defaultVendorFsForTests(): VendorFs {
  const initial = new Map<string, LstatLike | null>([['/proj/AGENTS.md', fileStat()]]);
  const readlinks = new Map<string, string>();
  for (const [name, target] of VENDOR_SYMLINKS) {
    initial.set(`/proj/${name}`, linkStat());
    readlinks.set(`/proj/${name}`, target);
  }
  return vendorFsFixture(initial, readlinks).fs;
}

function baseDeps(overrides: Partial<BootstrapDeps>): BootstrapDeps {
  const sinks = captureSinks();
  return {
    spawn: overrides.spawn ?? (vi.fn(() => ({ status: 0 })) as unknown as BootstrapDeps['spawn']),
    stdout: overrides.stdout ?? sinks.stdout,
    stderr: overrides.stderr ?? sinks.stderr,
    exit: overrides.exit ?? sinks.exit,
    cwd: overrides.cwd ?? '/proj',
    platform: overrides.platform ?? 'linux',
    arch: overrides.arch ?? 'x64',
    exists: overrides.exists ?? (() => false),
    readdir: overrides.readdir ?? (() => []),
    copyFile: overrides.copyFile ?? vi.fn(),
    chmod: overrides.chmod ?? vi.fn(),
    vendorFs: overrides.vendorFs ?? defaultVendorFsForTests(),
  };
}

describe('detectMissingTools', () => {
  test('reports every tool whose --version fails', () => {
    const present = new Set(['bun', 'cargo']);
    const spawn = vi.fn((command: string) => ({ status: present.has(command) ? 0 : 1 }));
    expect(detectMissingTools(spawn as unknown as BootstrapDeps['spawn'])).toEqual(['pnpm', 'uv']);
  });

  test('returns empty when all tools succeed', () => {
    const spawn = vi.fn(() => ({ status: 0 }));
    expect(detectMissingTools(spawn as unknown as BootstrapDeps['spawn'])).toEqual([]);
  });
});

describe('detectEsbuildMismatches', () => {
  const spawn = vi.fn() as unknown as BootstrapDeps['spawn'];

  test('returns empty when .pnpm directory does not exist', () => {
    expect(
      detectEsbuildMismatches(
        '/c',
        spawn,
        () => false,
        () => [],
      ),
    ).toEqual([]);
  });

  test('skips entries that are not esbuild@VERSION', () => {
    const exists = vi.fn((path: string) => path.endsWith('node_modules/.pnpm'));
    expect(
      detectEsbuildMismatches('/c', spawn, exists, () => ['vite@5.0.0', 'esbuild@bad']),
    ).toEqual([]);
  });

  test('skips esbuild dirs missing the bin file', () => {
    const exists = (path: string) => path.endsWith('/.pnpm');
    expect(detectEsbuildMismatches('/c', spawn, exists, () => ['esbuild@0.21.5'])).toEqual([]);
  });

  test('skips when the version probe itself fails', () => {
    const exists = () => true;
    const probe = vi.fn(() => ({ status: 1, stdout: '' }));
    expect(
      detectEsbuildMismatches('/c', probe as unknown as BootstrapDeps['spawn'], exists, () => [
        'esbuild@0.21.5',
      ]),
    ).toEqual([]);
  });

  test('returns nothing when actual version matches', () => {
    const exists = () => true;
    const probe = vi.fn(() => ({ status: 0, stdout: '0.21.5\n' }));
    expect(
      detectEsbuildMismatches('/c', probe as unknown as BootstrapDeps['spawn'], exists, () => [
        'esbuild@0.21.5',
      ]),
    ).toEqual([]);
  });

  test('returns mismatches when the actual binary version differs', () => {
    const exists = () => true;
    const probe = vi.fn(() => ({ status: 0, stdout: '0.27.7\n' }));
    const result = detectEsbuildMismatches(
      '/c',
      probe as unknown as BootstrapDeps['spawn'],
      exists,
      () => ['esbuild@0.21.5'],
    );
    expect(result).toEqual([
      {
        version: '0.21.5',
        binPath: '/c/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild',
        actual: '0.27.7',
      },
    ]);
  });

  test('treats blank version output as no mismatch', () => {
    const exists = () => true;
    const probe = vi.fn(() => ({ status: 0, stdout: '   ' }));
    expect(
      detectEsbuildMismatches('/c', probe as unknown as BootstrapDeps['spawn'], exists, () => [
        'esbuild@0.21.5',
      ]),
    ).toEqual([]);
  });

  test('treats missing stdout as no mismatch', () => {
    const exists = () => true;
    const probe = vi.fn(() => ({ status: 0 }));
    expect(
      detectEsbuildMismatches('/c', probe as unknown as BootstrapDeps['spawn'], exists, () => [
        'esbuild@0.21.5',
      ]),
    ).toEqual([]);
  });
});

describe('platformArchSlug', () => {
  test('maps known platform + arch pairs', () => {
    expect(platformArchSlug('linux', 'x64')).toBe('linux-x64');
    expect(platformArchSlug('darwin', 'arm64')).toBe('darwin-arm64');
    expect(platformArchSlug('freebsd', 'arm')).toBe('freebsd-arm');
    expect(platformArchSlug('netbsd', 'ia32')).toBe('netbsd-ia32');
    expect(platformArchSlug('openbsd', 'loong64')).toBe('openbsd-loong64');
    expect(platformArchSlug('sunos', 'mips64el')).toBe('sunos-mips64el');
    expect(platformArchSlug('win32', 'ppc64')).toBe('win32-ppc64');
    expect(platformArchSlug('linux', 'riscv64')).toBe('linux-riscv64');
    expect(platformArchSlug('linux', 's390x')).toBe('linux-s390x');
  });

  test('throws on unsupported platform', () => {
    expect(() => platformArchSlug('aix' as NodeJS.Platform, 'x64')).toThrow(/unsupported/);
  });

  test('throws on unsupported arch', () => {
    expect(() => platformArchSlug('linux', 'mips' as NodeJS.Architecture)).toThrow(/unsupported/);
  });
});

describe('repairEsbuildMismatch', () => {
  const mismatch = {
    version: '0.21.5',
    binPath: '/c/node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild',
    actual: '0.27.7',
  };

  test('returns false when the platform source binary is missing', () => {
    const copyFile = vi.fn();
    const chmod = vi.fn();
    const ok = repairEsbuildMismatch('/c', mismatch, 'linux-x64', () => false, copyFile, chmod);
    expect(ok).toBe(false);
    expect(copyFile).not.toHaveBeenCalled();
    expect(chmod).not.toHaveBeenCalled();
  });

  test('copies and chmods when source exists', () => {
    const copyFile = vi.fn();
    const chmod = vi.fn();
    const ok = repairEsbuildMismatch('/c', mismatch, 'linux-x64', () => true, copyFile, chmod);
    expect(ok).toBe(true);
    expect(copyFile).toHaveBeenCalledWith(
      '/c/node_modules/.pnpm/@esbuild+linux-x64@0.21.5/node_modules/@esbuild/linux-x64/bin/esbuild',
      mismatch.binPath,
    );
    expect(chmod).toHaveBeenCalledWith(mismatch.binPath, 0o755);
  });
});

describe('verifyAndRepairVendorLinks', () => {
  test('errors when AGENTS.md is missing', () => {
    const { fs } = vendorFsFixture(new Map());
    const report = verifyAndRepairVendorLinks('/proj', fs);
    expect(report.errors).toEqual([
      'AGENTS.md is missing or not a regular file; the canonical agent context must live there',
    ]);
    expect(report.repaired).toEqual([]);
    expect(report.ok).toEqual([]);
  });

  test('errors when AGENTS.md is a directory (not a file)', () => {
    const { fs } = vendorFsFixture(new Map([['/proj/AGENTS.md', dirStat()]]));
    const report = verifyAndRepairVendorLinks('/proj', fs);
    expect(report.errors[0]).toMatch(/AGENTS\.md is missing or not a regular file/);
  });

  test('creates symlinks that are absent', () => {
    const { fs, symlinks } = vendorFsFixture(new Map([['/proj/AGENTS.md', fileStat()]]));
    const report = verifyAndRepairVendorLinks('/proj', fs);
    expect(report.repaired.length).toBe(VENDOR_SYMLINKS.length);
    expect(report.errors).toEqual([]);
    expect(symlinks.get('/proj/CLAUDE.md')).toBe('AGENTS.md');
    expect(symlinks.get('/proj/.codex')).toBe('AGENTS.md');
  });

  test('reports ok when all symlinks already point at AGENTS.md', () => {
    const initial = new Map<string, LstatLike | null>([['/proj/AGENTS.md', fileStat()]]);
    const readlinks = new Map<string, string>();
    for (const [name, target] of VENDOR_SYMLINKS) {
      initial.set(`/proj/${name}`, linkStat());
      readlinks.set(`/proj/${name}`, target);
    }
    const { fs } = vendorFsFixture(initial, readlinks);
    const report = verifyAndRepairVendorLinks('/proj', fs);
    expect(report.ok).toEqual(VENDOR_SYMLINKS.map(([name]) => name));
    expect(report.repaired).toEqual([]);
    expect(report.errors).toEqual([]);
  });

  test('repairs a symlink that points at the wrong target', () => {
    const initial = new Map<string, LstatLike | null>([
      ['/proj/AGENTS.md', fileStat()],
      ['/proj/CLAUDE.md', linkStat()],
    ]);
    const readlinks = new Map<string, string>([['/proj/CLAUDE.md', '.claude/CLAUDE.md']]);
    const { fs, symlinks } = vendorFsFixture(initial, readlinks);
    const report = verifyAndRepairVendorLinks('/proj', fs);
    expect(report.repaired.some((entry) => entry.includes('was .claude/CLAUDE.md'))).toBe(true);
    expect(symlinks.get('/proj/CLAUDE.md')).toBe('AGENTS.md');
  });

  test('refuses to clobber a real file occupying a link slot', () => {
    const initial = new Map<string, LstatLike | null>([
      ['/proj/AGENTS.md', fileStat()],
      ['/proj/CLAUDE.md', fileStat()],
    ]);
    const { fs, state } = vendorFsFixture(initial);
    const report = verifyAndRepairVendorLinks('/proj', fs);
    expect(report.errors[0]).toMatch(/CLAUDE\.md exists but is not a symlink/);
    expect(state.get('/proj/CLAUDE.md')?.isFile()).toBe(true);
  });
});

describe('main', () => {
  test('exits 1 with named missing tools', () => {
    const sinks = captureSinks();
    const spawn = spawnRouter([
      (command, args) => {
        if (args[0] === '--version') {
          return { status: command === 'pnpm' ? 1 : 0 };
        }
        return undefined;
      },
    ]);
    expect(() =>
      main(
        baseDeps({
          spawn: spawn as unknown as BootstrapDeps['spawn'],
          stdout: sinks.stdout,
          stderr: sinks.stderr,
          exit: sinks.exit,
        }),
      ),
    ).toThrow('__exit__');
    expect(sinks.exit).toHaveBeenCalledWith(1);
    expect(sinks.stderrError).toHaveBeenCalledWith('bootstrap: missing required tools: pnpm');
    expect(sinks.stderrError).toHaveBeenCalledWith(
      expect.stringMatching(/pnpm: install via corepack/),
    );
  });

  test('happy path runs pnpm install, cargo check, uv sync to completion', () => {
    const sinks = captureSinks();
    const spawn = spawnRouter([
      (_command, args) => (args[0] === '--version' ? { status: 0 } : undefined),
      (command) => {
        if (command === 'pnpm' || command === 'cargo' || command === 'uv') {
          return { status: 0 };
        }
        return undefined;
      },
    ]);
    main(
      baseDeps({
        spawn: spawn as unknown as BootstrapDeps['spawn'],
        stdout: sinks.stdout,
        stderr: sinks.stderr,
        exit: sinks.exit,
      }),
    );
    expect(sinks.exit).not.toHaveBeenCalled();
    expect(sinks.stdoutLog).toHaveBeenCalledWith('bootstrap: complete');
  });

  test('install failure with no esbuild mismatches surfaces and exits non-zero', () => {
    const sinks = captureSinks();
    const spawn = vi
      .fn()
      .mockImplementationOnce(() => ({ status: 0 })) // bun preflight
      .mockImplementationOnce(() => ({ status: 0 })) // pnpm preflight
      .mockImplementationOnce(() => ({ status: 0 })) // cargo preflight
      .mockImplementationOnce(() => ({ status: 0 })) // uv preflight
      .mockImplementationOnce(() => ({ status: 2 })); // pnpm install
    expect(() =>
      main(
        baseDeps({
          spawn: spawn as unknown as BootstrapDeps['spawn'],
          stdout: sinks.stdout,
          stderr: sinks.stderr,
          exit: sinks.exit,
          exists: () => false,
          readdir: () => [],
        }),
      ),
    ).toThrow('__exit__');
    expect(sinks.exit).toHaveBeenCalledWith(2);
    expect(sinks.stderrError).toHaveBeenCalledWith(
      'bootstrap: pnpm install failed and no known auto-repair applies',
    );
  });

  test('install failure with unrepairable mismatch exits with install status', () => {
    const sinks = captureSinks();
    const spawn = vi
      .fn()
      .mockImplementationOnce(() => ({ status: 0 })) // bun preflight
      .mockImplementationOnce(() => ({ status: 0 })) // pnpm preflight
      .mockImplementationOnce(() => ({ status: 0 })) // cargo preflight
      .mockImplementationOnce(() => ({ status: 0 })) // uv preflight
      .mockImplementationOnce(() => ({ status: 1 })) // pnpm install
      .mockImplementationOnce(() => ({ status: 0, stdout: '0.27.7' })); // esbuild --version probe
    const exists = vi.fn((path: string) => {
      if (path.endsWith('node_modules/.pnpm')) return true;
      if (path.endsWith('esbuild@0.21.5/node_modules/esbuild/bin/esbuild')) return true;
      return false;
    });
    expect(() =>
      main(
        baseDeps({
          spawn: spawn as unknown as BootstrapDeps['spawn'],
          stdout: sinks.stdout,
          stderr: sinks.stderr,
          exit: sinks.exit,
          exists,
          readdir: () => ['esbuild@0.21.5'],
        }),
      ),
    ).toThrow('__exit__');
    expect(sinks.exit).toHaveBeenCalledWith(1);
    expect(sinks.stderrError).toHaveBeenCalledWith(
      expect.stringMatching(/no platform binary available for esbuild@0\.21\.5/),
    );
  });

  test('install failure auto-repairs esbuild and rebuilds successfully', () => {
    const sinks = captureSinks();
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const spawn = vi.fn((command: string, args: readonly string[] = []) => {
      calls.push({ command, args: [...args] });
      if (command.endsWith('/bin/esbuild') && args[0] === '--version') {
        return { status: 0, stdout: '0.27.7' };
      }
      if (args[0] === '--version') {
        return { status: 0 };
      }
      if (command === 'pnpm' && args[0] === 'install') {
        return { status: 1 };
      }
      if (command === 'pnpm' && args[0] === 'rebuild') {
        return { status: 0 };
      }
      if (command === 'cargo' && args[0] === 'check') {
        return { status: 0 };
      }
      if (command === 'uv' && args[0] === 'sync') {
        return { status: 0 };
      }
      return { status: 0 };
    });
    const exists = vi.fn((path: string) => {
      if (path.endsWith('node_modules/.pnpm')) return true;
      if (path.endsWith('esbuild@0.21.5/node_modules/esbuild/bin/esbuild')) return true;
      if (path.endsWith('@esbuild+linux-x64@0.21.5/node_modules/@esbuild/linux-x64/bin/esbuild'))
        return true;
      return false;
    });
    const copyFile = vi.fn();
    const chmod = vi.fn();
    main(
      baseDeps({
        spawn: spawn as unknown as BootstrapDeps['spawn'],
        stdout: sinks.stdout,
        stderr: sinks.stderr,
        exit: sinks.exit,
        exists,
        readdir: () => ['esbuild@0.21.5'],
        copyFile,
        chmod,
      }),
    );
    expect(sinks.exit).not.toHaveBeenCalled();
    expect(copyFile).toHaveBeenCalledTimes(1);
    expect(chmod).toHaveBeenCalledTimes(1);
    expect(
      calls.some((c) => c.command === 'pnpm' && c.args[0] === 'rebuild' && c.args[1] === 'esbuild'),
    ).toBe(true);
    expect(sinks.stdoutLog).toHaveBeenCalledWith('bootstrap: complete');
  });

  test('rebuild failure after repair exits with rebuild status', () => {
    const sinks = captureSinks();
    const spawn = vi.fn((command: string, args: readonly string[] = []) => {
      if (args[0] === '--version') {
        if (command.endsWith('/bin/esbuild')) {
          return { status: 0, stdout: '0.27.7' };
        }
        return { status: 0 };
      }
      if (command === 'pnpm' && args[0] === 'install') return { status: 1 };
      if (command === 'pnpm' && args[0] === 'rebuild') return { status: 5 };
      return { status: 0 };
    });
    const exists = (path: string) =>
      path.endsWith('/.pnpm') ||
      path.endsWith('esbuild@0.21.5/node_modules/esbuild/bin/esbuild') ||
      path.endsWith('@esbuild+linux-x64@0.21.5/node_modules/@esbuild/linux-x64/bin/esbuild');
    expect(() =>
      main(
        baseDeps({
          spawn: spawn as unknown as BootstrapDeps['spawn'],
          stdout: sinks.stdout,
          stderr: sinks.stderr,
          exit: sinks.exit,
          exists,
          readdir: () => ['esbuild@0.21.5'],
        }),
      ),
    ).toThrow('__exit__');
    expect(sinks.exit).toHaveBeenCalledWith(5);
    expect(sinks.stderrError).toHaveBeenCalledWith(
      'bootstrap: pnpm rebuild esbuild failed after binary repair',
    );
  });

  test('cargo check failure exits 1', () => {
    const sinks = captureSinks();
    const spawn = vi.fn((command: string, args: readonly string[] = []) => {
      if (args[0] === '--version') return { status: 0 };
      if (command === 'pnpm' && args[0] === 'install') return { status: 0 };
      if (command === 'cargo') return { status: 1 };
      return { status: 0 };
    });
    expect(() =>
      main(
        baseDeps({
          spawn: spawn as unknown as BootstrapDeps['spawn'],
          stdout: sinks.stdout,
          stderr: sinks.stderr,
          exit: sinks.exit,
        }),
      ),
    ).toThrow('__exit__');
    expect(sinks.exit).toHaveBeenCalledWith(1);
    expect(sinks.stderrError).toHaveBeenCalledWith('bootstrap: cargo check failed');
  });

  test('uv sync failure exits 1', () => {
    const sinks = captureSinks();
    const spawn = vi.fn((command: string, args: readonly string[] = []) => {
      if (args[0] === '--version') return { status: 0 };
      if (command === 'pnpm' && args[0] === 'install') return { status: 0 };
      if (command === 'cargo') return { status: 0 };
      if (command === 'uv') return { status: 1 };
      return { status: 0 };
    });
    expect(() =>
      main(
        baseDeps({
          spawn: spawn as unknown as BootstrapDeps['spawn'],
          stdout: sinks.stdout,
          stderr: sinks.stderr,
          exit: sinks.exit,
        }),
      ),
    ).toThrow('__exit__');
    expect(sinks.exit).toHaveBeenCalledWith(1);
    expect(sinks.stderrError).toHaveBeenCalledWith('bootstrap: uv sync failed');
  });

  test('runInherit treats null spawn status as failure code 1', () => {
    const sinks = captureSinks();
    const spawn = vi.fn((command: string, args: readonly string[] = []) => {
      if (args[0] === '--version') return { status: 0 };
      if (command === 'pnpm' && args[0] === 'install') {
        return { status: null as unknown as number };
      }
      return { status: 0 };
    });
    expect(() =>
      main(
        baseDeps({
          spawn: spawn as unknown as BootstrapDeps['spawn'],
          stdout: sinks.stdout,
          stderr: sinks.stderr,
          exit: sinks.exit,
          exists: () => false,
        }),
      ),
    ).toThrow('__exit__');
    expect(sinks.exit).toHaveBeenCalledWith(1);
  });

  test('uses real fs defaults when DI is omitted on the failure path', () => {
    const sinks = captureSinks();
    const spawn = vi.fn((command: string, args: readonly string[] = []) => {
      if (args[0] === '--version') {
        if (command === 'pnpm') return { status: 1 };
        return { status: 0 };
      }
      return { status: 0 };
    });
    expect(() =>
      main({
        spawn: spawn as unknown as BootstrapDeps['spawn'],
        stdout: sinks.stdout,
        stderr: sinks.stderr,
        exit: sinks.exit,
        cwd: '/nonexistent-path-for-test',
      }),
    ).toThrow('__exit__');
    expect(sinks.exit).toHaveBeenCalledWith(1);
  });

  test('exits 1 when vendor verify reports an error (AGENTS.md missing)', () => {
    const sinks = captureSinks();
    const spawn = vi.fn((_command: string, args: readonly string[] = []) => {
      if (args[0] === '--version') return { status: 0 };
      return { status: 0 };
    });
    const { fs } = vendorFsFixture(new Map());
    expect(() =>
      main(
        baseDeps({
          spawn: spawn as unknown as BootstrapDeps['spawn'],
          stdout: sinks.stdout,
          stderr: sinks.stderr,
          exit: sinks.exit,
          vendorFs: fs,
        }),
      ),
    ).toThrow('__exit__');
    expect(sinks.exit).toHaveBeenCalledWith(1);
    expect(sinks.stderrError).toHaveBeenCalledWith(
      expect.stringMatching(/AGENTS\.md is missing or not a regular file/),
    );
  });

  test('creates missing vendor symlinks then continues', () => {
    const sinks = captureSinks();
    const spawn = vi.fn((_command: string, args: readonly string[] = []) => {
      if (args[0] === '--version') return { status: 0 };
      return { status: 0 };
    });
    const { fs, symlinks } = vendorFsFixture(new Map([['/proj/AGENTS.md', fileStat()]]));
    main(
      baseDeps({
        spawn: spawn as unknown as BootstrapDeps['spawn'],
        stdout: sinks.stdout,
        stderr: sinks.stderr,
        exit: sinks.exit,
        vendorFs: fs,
      }),
    );
    expect(sinks.exit).not.toHaveBeenCalled();
    expect(symlinks.get('/proj/CLAUDE.md')).toBe('AGENTS.md');
    expect(symlinks.get('/proj/GEMINI.md')).toBe('AGENTS.md');
    expect(symlinks.get('/proj/.codex')).toBe('AGENTS.md');
    expect(symlinks.get('/proj/.gemini')).toBe('AGENTS.md');
    expect(sinks.stdoutLog).toHaveBeenCalledWith(
      expect.stringMatching(/vendor symlink CLAUDE\.md -> AGENTS\.md \(created\)/),
    );
    expect(sinks.stdoutLog).toHaveBeenCalledWith('bootstrap: complete');
  });

  test('logs vendor ok lines when nothing needs repair', () => {
    const sinks = captureSinks();
    const spawn = vi.fn((_command: string, args: readonly string[] = []) => {
      if (args[0] === '--version') return { status: 0 };
      return { status: 0 };
    });
    main(
      baseDeps({
        spawn: spawn as unknown as BootstrapDeps['spawn'],
        stdout: sinks.stdout,
        stderr: sinks.stderr,
        exit: sinks.exit,
      }),
    );
    expect(sinks.exit).not.toHaveBeenCalled();
    expect(sinks.stdoutLog).toHaveBeenCalledWith('bootstrap: vendor symlink CLAUDE.md ok');
  });

  test('falls back to process defaults when cwd/platform/arch are omitted', () => {
    const sinks = captureSinks();
    const spawn = vi.fn((command: string, args: readonly string[] = []) => {
      if (args[0] === '--version' && command === 'pnpm') return { status: 1 };
      if (args[0] === '--version') return { status: 0 };
      return { status: 0 };
    });
    expect(() =>
      main({
        spawn: spawn as unknown as BootstrapDeps['spawn'],
        stdout: sinks.stdout,
        stderr: sinks.stderr,
        exit: sinks.exit,
      }),
    ).toThrow('__exit__');
    expect(sinks.exit).toHaveBeenCalledWith(1);
    expect(sinks.stderrError).toHaveBeenCalledWith('bootstrap: missing required tools: pnpm');
  });

  test('falls back to real vendorFs when omitted; exits with the canonical AGENTS.md error on a bare cwd', () => {
    const sinks = captureSinks();
    const spawn = vi.fn((_command: string, args: readonly string[] = []) => {
      if (args[0] === '--version') return { status: 0 };
      return { status: 0 };
    });
    expect(() =>
      main({
        spawn: spawn as unknown as BootstrapDeps['spawn'],
        stdout: sinks.stdout,
        stderr: sinks.stderr,
        exit: sinks.exit,
        cwd: '/path/does/not/exist/for/bootstrap/test',
      }),
    ).toThrow('__exit__');
    expect(sinks.exit).toHaveBeenCalledWith(1);
    expect(sinks.stderrError).toHaveBeenCalledWith(
      expect.stringMatching(/AGENTS\.md is missing or not a regular file/),
    );
  });

  describe('real vendor-symlink filesystem exercise', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'bootstrap-vendor-'));
      writeFileSync(join(dir, 'AGENTS.md'), '# real canonical body\n');
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    test('creates, validates, and repairs vendor symlinks via the real default fs', () => {
      const sinks = captureSinks();
      const spawn = vi.fn((_command: string, args: readonly string[] = []) => {
        if (args[0] === '--version') return { status: 0 };
        // pnpm install / cargo / uv all succeed
        return { status: 0 };
      });

      // First run: creates the four missing symlinks.
      main({
        spawn: spawn as unknown as BootstrapDeps['spawn'],
        stdout: sinks.stdout,
        stderr: sinks.stderr,
        exit: sinks.exit,
        cwd: dir,
        platform: 'linux',
        arch: 'x64',
      });
      for (const [name, target] of VENDOR_SYMLINKS) {
        const linkPath = join(dir, name);
        expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
        expect(readlinkSync(linkPath)).toBe(target);
      }

      // Stale-target case: replace one symlink with a bogus target and re-run.
      const claudePath = join(dir, 'CLAUDE.md');
      rmSync(claudePath);
      symlinkSync('docs/legacy.md', claudePath);
      const sinks2 = captureSinks();
      main({
        spawn: spawn as unknown as BootstrapDeps['spawn'],
        stdout: sinks2.stdout,
        stderr: sinks2.stderr,
        exit: sinks2.exit,
        cwd: dir,
        platform: 'linux',
        arch: 'x64',
      });
      expect(readlinkSync(claudePath)).toBe('AGENTS.md');
      expect(sinks2.exit).not.toHaveBeenCalled();
    });
  });
});
