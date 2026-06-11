import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { isMainEntry } from '../lib/entrypoint';

// Path-with-spaces regression: every scripts/*.ts entrypoint compared
// `import.meta.url` to a raw `file://${process.argv[1]}` template. Bun
// (and Node) URL-encode literal spaces in `import.meta.url` as %20 but
// leave `process.argv[1]` raw, so the string equality always failed
// inside any path containing a space and main() silently no-opped —
// `bun run scripts/<anything>.ts` exited 0 with empty stdout. This
// suite pins the canonicalized check used by `isMainEntry()`.

describe('isMainEntry()', () => {
  test('returns false when process.argv[1] is missing', () => {
    const original = process.argv[1];
    try {
      (process.argv as string[])[1] = '';
      expect(isMainEntry('file:///does/not/matter.ts')).toBe(false);
    } finally {
      (process.argv as string[])[1] = original;
    }
  });

  test('returns false when the entrypoint path does not exist on disk', () => {
    const original = process.argv[1];
    try {
      (process.argv as string[])[1] = '/this/path/should/not/exist/foo.ts';
      expect(isMainEntry('file:///also/missing/foo.ts')).toBe(false);
    } finally {
      (process.argv as string[])[1] = original;
    }
  });

  test('matches when import.meta.url URL-encodes a space that argv[1] keeps raw', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-entry space-'));
    try {
      const filePath = join(root, 'probe.ts');
      writeFileSync(filePath, '// probe\n');
      const original = process.argv[1];
      try {
        (process.argv as string[])[1] = filePath;
        const encodedUrl = `file://${filePath.replaceAll(' ', '%20')}`;
        expect(isMainEntry(encodedUrl)).toBe(true);
      } finally {
        (process.argv as string[])[1] = original;
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('matches when one side is a symlink and the other is its realpath', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-entry-symlink-'));
    try {
      const target = join(root, 'real.ts');
      const link = join(root, 'link.ts');
      writeFileSync(target, '// real\n');
      symlinkSync(target, link);
      const original = process.argv[1];
      try {
        (process.argv as string[])[1] = link;
        expect(isMainEntry(`file://${target}`)).toBe(true);
      } finally {
        (process.argv as string[])[1] = original;
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('scripts/*.ts entrypoint actually runs in a path with spaces', () => {
  // Spawn a real script under a `bun run` invocation routed through a
  // path that contains a space. Before the fix this prints nothing and
  // exits 0 even though main() never ran. After the fix the expected
  // stdout / nonzero exit appears.

  test('build.ts entrypoint runs main() through a space-bearing path', () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-space probe-'));
    try {
      const repo = join(root, 'repo');
      symlinkSync(process.cwd(), repo, 'dir');
      const result = spawnSync('bun', ['run', join(repo, 'scripts/build.ts'), '--no-such-flag'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      // build.ts forwards to `pnpm turbo run build`. Whether that
      // succeeds or fails is irrelevant: the bug shape this test pins
      // is the silent-no-op (stdout empty AND status 0). After the
      // fix main() runs, so at least one of those two falsies will
      // flip. We assert the disjunction rather than the specific
      // exit code so the test stays stable across environments.
      const stdout = (result.stdout ?? '').trim();
      const stderr = (result.stderr ?? '').trim();
      const ran = stdout.length > 0 || stderr.length > 0 || result.status !== 0;
      expect(ran).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
