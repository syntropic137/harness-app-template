// Unit tests for harness/sensors/license_scan.mjs - the LG01 Legality
// adapter (bead create-harness-app-2zz.3). All IO is mocked via an
// in-memory fs stub so the suite runs hermetically.

import { describe, expect, test } from 'vitest';
import {
  DEFAULT_ALLOWLIST,
  isLicenseAllowed,
  readLicense,
  scanLicenses,
  walkNodeModules,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/license_scan.mjs';

interface FsStub {
  files: Record<string, string>;
  dirs: Record<string, string[]>;
  existsSync: (p: string) => boolean;
  readFileSync: (p: string) => string;
  readdirSync: (p: string) => string[];
  statSync: (p: string) => { isDirectory: () => boolean };
}

function makeFs(opts: {
  files?: Record<string, string>;
  dirs?: Record<string, string[]>;
  fileDirs?: string[];
}): FsStub {
  const files = opts.files ?? {};
  const dirs = opts.dirs ?? {};
  const fileDirs = new Set(opts.fileDirs ?? Object.keys(dirs));
  return {
    files,
    dirs,
    existsSync: (p: string) => p in files || p in dirs,
    readFileSync: (p: string) => {
      if (!(p in files)) {
        throw new Error(`ENOENT: ${p}`);
      }
      return files[p] as string;
    },
    readdirSync: (p: string) => {
      if (!(p in dirs)) {
        throw new Error(`ENOENT: ${p}`);
      }
      return dirs[p] as string[];
    },
    statSync: (p: string) => ({
      isDirectory: () => fileDirs.has(p),
    }),
  };
}

describe('license_scan - readLicense', () => {
  test('reads top-level string license field', () => {
    const fs = makeFs({ files: { 'pkg/package.json': JSON.stringify({ license: 'MIT' }) } });
    expect(readLicense('pkg/package.json', fs)).toBe('MIT');
  });

  test('reads object license.type field', () => {
    const fs = makeFs({
      files: { 'pkg/package.json': JSON.stringify({ license: { type: 'Apache-2.0', url: 'x' } }) },
    });
    expect(readLicense('pkg/package.json', fs)).toBe('Apache-2.0');
  });

  test('reads first entry of historical licenses array (string)', () => {
    const fs = makeFs({
      files: { 'pkg/package.json': JSON.stringify({ licenses: ['MIT', 'Apache-2.0'] }) },
    });
    expect(readLicense('pkg/package.json', fs)).toBe('MIT');
  });

  test('reads first entry of historical licenses array (object.type)', () => {
    const fs = makeFs({
      files: {
        'pkg/package.json': JSON.stringify({ licenses: [{ type: 'BSD-3-Clause', url: 'x' }] }),
      },
    });
    expect(readLicense('pkg/package.json', fs)).toBe('BSD-3-Clause');
  });

  test('returns null when package.json has no license field', () => {
    const fs = makeFs({ files: { 'pkg/package.json': JSON.stringify({ name: 'pkg' }) } });
    expect(readLicense('pkg/package.json', fs)).toBeNull();
  });

  test('returns null when package.json is unreadable or malformed', () => {
    const fs = makeFs({ files: { 'pkg/package.json': 'not-json' } });
    expect(readLicense('pkg/package.json', fs)).toBeNull();
    expect(readLicense('missing/package.json', fs)).toBeNull();
  });
});

describe('license_scan - isLicenseAllowed', () => {
  test('plain SPDX identifiers on the allowlist pass', () => {
    for (const license of ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'MPL-2.0']) {
      expect(isLicenseAllowed(license)).toBe(true);
    }
  });

  test('common copyleft and unknown licenses are rejected', () => {
    for (const license of ['GPL-3.0', 'AGPL-3.0', 'SSPL-1.0', 'LGPL-2.1', 'Commercial', '']) {
      expect(isLicenseAllowed(license)).toBe(false);
    }
    expect(isLicenseAllowed(null)).toBe(false);
    expect(isLicenseAllowed(undefined)).toBe(false);
  });

  test('parenthesised SPDX expression strips wrapping parens', () => {
    expect(isLicenseAllowed('(MIT)')).toBe(true);
  });

  test('OR clause passes when any operand is on the allowlist', () => {
    expect(isLicenseAllowed('MIT OR Apache-2.0')).toBe(true);
    expect(isLicenseAllowed('(GPL-3.0 OR MIT)')).toBe(true);
    expect(isLicenseAllowed('GPL-3.0 OR AGPL-3.0')).toBe(false);
  });

  test('AND clause requires every operand on the allowlist', () => {
    expect(isLicenseAllowed('MIT AND Apache-2.0')).toBe(true);
    expect(isLicenseAllowed('MIT AND GPL-3.0')).toBe(false);
  });

  test('custom allowlist overrides defaults', () => {
    const custom = new Set(['GPL-3.0']);
    expect(isLicenseAllowed('GPL-3.0', custom)).toBe(true);
    expect(isLicenseAllowed('MIT', custom)).toBe(false);
  });

  test('DEFAULT_ALLOWLIST is a Set and covers the OSI permissive baseline', () => {
    expect(DEFAULT_ALLOWLIST).toBeInstanceOf(Set);
    expect(DEFAULT_ALLOWLIST.has('MIT')).toBe(true);
    expect(DEFAULT_ALLOWLIST.has('GPL-3.0')).toBe(false);
  });
});

describe('license_scan - walkNodeModules', () => {
  test('lists flat and scoped package.json paths under a node_modules root', () => {
    const fs = makeFs({
      dirs: {
        'node_modules': ['react', '@scope', '.bin'],
        'node_modules/react': [],
        'node_modules/@scope': ['util', 'core'],
        'node_modules/@scope/util': [],
        'node_modules/@scope/core': [],
      },
      fileDirs: [
        'node_modules',
        'node_modules/react',
        'node_modules/@scope',
        'node_modules/@scope/util',
        'node_modules/@scope/core',
      ],
    });
    const paths = walkNodeModules('node_modules', fs);
    expect(paths).toEqual([
      'node_modules/react/package.json',
      'node_modules/@scope/util/package.json',
      'node_modules/@scope/core/package.json',
    ]);
  });

  test('skips hidden directories (those starting with a dot)', () => {
    const fs = makeFs({
      dirs: { 'node_modules': ['.bin', '.cache', 'lodash'], 'node_modules/lodash': [] },
      fileDirs: ['node_modules', 'node_modules/lodash'],
    });
    const paths = walkNodeModules('node_modules', fs);
    expect(paths).toEqual(['node_modules/lodash/package.json']);
  });

  test('returns an empty array when the root does not exist', () => {
    const fs = makeFs({});
    expect(walkNodeModules('node_modules', fs)).toEqual([]);
  });

  test('skips non-directory entries inside node_modules', () => {
    const fs = makeFs({
      dirs: { 'node_modules': ['readme.md', 'lodash'], 'node_modules/lodash': [] },
      fileDirs: ['node_modules', 'node_modules/lodash'],
    });
    const paths = walkNodeModules('node_modules', fs);
    expect(paths).toEqual(['node_modules/lodash/package.json']);
  });
});

describe('license_scan - scanLicenses', () => {
  test('aggregates packages and counts denied entries across roots', () => {
    const fs = makeFs({
      dirs: { 'node_modules': ['mit-pkg', 'gpl-pkg', 'no-lic-pkg'] },
      files: {
        'node_modules/mit-pkg/package.json': JSON.stringify({ license: 'MIT' }),
        'node_modules/gpl-pkg/package.json': JSON.stringify({ license: 'GPL-3.0' }),
        'node_modules/no-lic-pkg/package.json': JSON.stringify({ name: 'no-lic-pkg' }),
      },
      fileDirs: [
        'node_modules',
        'node_modules/mit-pkg',
        'node_modules/gpl-pkg',
        'node_modules/no-lic-pkg',
      ],
    });
    const result = scanLicenses(['node_modules'], { fs });
    expect(result.available).toBe(true);
    expect(result.scanned).toBe(3);
    expect(result.denied_count).toBe(2);
    expect(result.denied.map((d: { package: string }) => d.package).sort()).toEqual([
      'gpl-pkg',
      'no-lic-pkg',
    ]);
  });

  test('available=false when no provided root exists', () => {
    const fs = makeFs({});
    const result = scanLicenses(['node_modules', 'harness/sensors/node_modules'], { fs });
    expect(result.available).toBe(false);
    expect(result.scanned).toBe(0);
    expect(result.denied_count).toBe(0);
  });

  test('reports zero denied when every package is on the allowlist', () => {
    const fs = makeFs({
      dirs: { 'node_modules': ['a', 'b'] },
      files: {
        'node_modules/a/package.json': JSON.stringify({ license: 'MIT' }),
        'node_modules/b/package.json': JSON.stringify({ license: 'ISC' }),
      },
      fileDirs: ['node_modules', 'node_modules/a', 'node_modules/b'],
    });
    const result = scanLicenses(['node_modules'], { fs });
    expect(result.denied_count).toBe(0);
    expect(result.scanned).toBe(2);
  });

  test('walks multiple roots independently and aggregates', () => {
    const fs = makeFs({
      dirs: {
        'a/node_modules': ['x'],
        'b/node_modules': ['y'],
      },
      files: {
        'a/node_modules/x/package.json': JSON.stringify({ license: 'MIT' }),
        'b/node_modules/y/package.json': JSON.stringify({ license: 'GPL-3.0' }),
      },
      fileDirs: ['a/node_modules', 'a/node_modules/x', 'b/node_modules', 'b/node_modules/y'],
    });
    const result = scanLicenses(['a/node_modules', 'b/node_modules', 'c/node_modules'], { fs });
    expect(result.scanned_roots).toEqual(['a/node_modules', 'b/node_modules']);
    expect(result.scanned).toBe(2);
    expect(result.denied_count).toBe(1);
  });
});
