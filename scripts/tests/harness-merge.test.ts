import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { writeWorktreeFile } from '../lib/harness-merge';

describe('writeWorktreeFile', () => {
  test('writes inside the work tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-merge-write-'));
    try {
      writeWorktreeFile(root, 'file.txt', Buffer.from('ok\n'));
      expect(readFileSync(join(root, 'file.txt'), 'utf8')).toBe('ok\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test.each(['../escape.txt', '/etc/passwd', '.'])('refuses %s', (path) => {
    expect(() => writeWorktreeFile(tmpdir(), path, Buffer.from('x'))).toThrow(
      /outside the work tree/,
    );
  });
});
