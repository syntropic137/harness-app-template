import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PHASES, detectIsoKey, isSafePathSegment, isScriptEntry, parseArgs, resolveFfmpeg } from '../common.mjs';

describe('phase and path-segment validation', () => {
  it('exposes the closed before/after phase contract', () => {
    expect(PHASES).toEqual(['before', 'after']);
  });

  it('accepts plain artifact path segments', () => {
    expect(isSafePathSegment('58fda1d5')).toBe(true);
    expect(isSafePathSegment('iso-1.worktree_A')).toBe(true);
  });

  it('rejects traversal, separators, and empty or non-string values', () => {
    expect(isSafePathSegment('../../etc')).toBe(false);
    expect(isSafePathSegment('a/b')).toBe(false);
    expect(isSafePathSegment('a\\b')).toBe(false);
    expect(isSafePathSegment('.hidden')).toBe(false);
    expect(isSafePathSegment('')).toBe(false);
    expect(isSafePathSegment(undefined)).toBe(false);
    expect(isSafePathSegment(`x${'y'.repeat(64)}`)).toBe(false);
  });
});

describe('parseArgs', () => {
  it('parses --key=value pairs and preserves embedded equals signs', () => {
    expect(parseArgs(['--url=http://app?a=b', '--phase=before'])).toEqual({
      phase: 'before',
      url: 'http://app?a=b',
    });
  });
});

describe('detectIsoKey', () => {
  it('extracts the iso key from stack inspect output', () => {
    const exec = vi.fn(() => 'Branch:           main\nIso key:          abc123\n');
    expect(detectIsoKey(exec)).toBe('abc123');
    expect(exec).toHaveBeenCalledWith('harness/stack/bin/stack', ['inspect'], {
      encoding: 'utf8',
    });
  });

  it('returns null when the line is absent or the command fails', () => {
    expect(detectIsoKey(() => 'no iso line here\n')).toBeNull();
    expect(
      detectIsoKey(() => {
        throw new Error('stack not installed');
      }),
    ).toBeNull();
  });
});

describe('resolveFfmpeg', () => {
  const throwingExec = () => {
    throw new Error('ENOENT');
  };

  it('prefers the HARNESS_FFMPEG override', () => {
    expect(
      resolveFfmpeg({
        env: { HARNESS_FFMPEG: '/opt/ffmpeg' },
        execFileSync: vi.fn(),
        homedir: () => '/home/u',
        readdirSync: vi.fn(),
      }),
    ).toBe('/opt/ffmpeg');
  });

  it('uses PATH ffmpeg when the probe succeeds', () => {
    expect(
      resolveFfmpeg({
        env: {},
        execFileSync: vi.fn(() => ''),
        homedir: () => '/home/u',
        readdirSync: vi.fn(),
      }),
    ).toBe('ffmpeg');
  });

  it('falls back to the Playwright bundle, preferring PLAYWRIGHT_BROWSERS_PATH', () => {
    const readdirSync = vi.fn((dir: string) => {
      if (dir === '/custom') return ['chromium-1200', 'ffmpeg-1011'];
      if (dir === join('/custom', 'ffmpeg-1011')) return ['DEPS', 'ffmpeg-linux'];
      throw new Error(`unexpected ${dir}`);
    });
    expect(
      resolveFfmpeg({
        env: { PLAYWRIGHT_BROWSERS_PATH: '/custom' },
        execFileSync: throwingExec,
        homedir: () => '/home/u',
        readdirSync,
      }),
    ).toBe(join('/custom', 'ffmpeg-1011', 'ffmpeg-linux'));
  });

  it('skips unreadable roots and finds the default linux cache', () => {
    const linuxCache = join('/home/u', '.cache', 'ms-playwright');
    const readdirSync = vi.fn((dir: string) => {
      if (dir === linuxCache) return ['ffmpeg-1011'];
      if (dir === join(linuxCache, 'ffmpeg-1011')) return ['ffmpeg-linux'];
      throw new Error('ENOENT');
    });
    expect(
      resolveFfmpeg({
        env: { PLAYWRIGHT_BROWSERS_PATH: '/missing' },
        execFileSync: throwingExec,
        homedir: () => '/home/u',
        readdirSync,
      }),
    ).toBe(join(linuxCache, 'ffmpeg-1011', 'ffmpeg-linux'));
  });

  it('skips roots without an ffmpeg bundle and bundles without a binary', () => {
    const linuxCache = join('/home/u', '.cache', 'ms-playwright');
    const macCache = join('/home/u', 'Library', 'Caches', 'ms-playwright');
    const readdirSync = vi.fn((dir: string) => {
      if (dir === linuxCache) return ['chromium-1200'];
      if (dir === macCache) return ['ffmpeg-1011'];
      if (dir === join(macCache, 'ffmpeg-1011')) return ['DEPS'];
      throw new Error('ENOENT');
    });
    expect(
      resolveFfmpeg({
        env: {},
        execFileSync: throwingExec,
        homedir: () => '/home/u',
        readdirSync,
      }),
    ).toBeNull();
  });

  it('returns null when a bundle directory is unreadable', () => {
    const linuxCache = join('/home/u', '.cache', 'ms-playwright');
    const readdirSync = vi.fn((dir: string) => {
      if (dir === linuxCache) return ['ffmpeg-1011'];
      throw new Error('EACCES');
    });
    expect(
      resolveFfmpeg({
        env: {},
        execFileSync: throwingExec,
        homedir: () => '/home/u',
        readdirSync,
      }),
    ).toBeNull();
  });
});

describe('isScriptEntry', () => {
  const url = 'file:///repo/harness/inspector/screenshot-pair.mjs';

  it('matches when canonical paths agree and differs otherwise', () => {
    const identity = (p: string) => p.replace('/link/', '/repo/');
    expect(isScriptEntry(url, '/link/harness/inspector/screenshot-pair.mjs', identity)).toBe(true);
    expect(isScriptEntry(url, '/repo/other.mjs', identity)).toBe(false);
  });

  it('returns false with no argv or when canonicalization throws', () => {
    expect(isScriptEntry(url, undefined)).toBe(false);
    expect(
      isScriptEntry(url, '/missing.mjs', () => {
        throw new Error('ENOENT');
      }),
    ).toBe(false);
  });
});
