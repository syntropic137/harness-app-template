import { describe, expect, it } from 'vitest';
import { captureSync, run, tryCapture } from '../../src/runtime/exec.js';

describe('runtime/exec', () => {
  describe('captureSync', () => {
    it('captures and trims stdout of a successful command', () => {
      const out = captureSync('node', ['-e', 'process.stdout.write("hello\\n")']);
      expect(out).toBe('hello');
    });

    it('throws on non-zero exit (execFileSync behavior)', () => {
      expect(() => captureSync('node', ['-e', 'process.exit(2)'])).toThrow();
    });
  });

  describe('tryCapture', () => {
    it('resolves with stdout, stderr, exitCode 0 on success', async () => {
      const r = await tryCapture('node', [
        '-e',
        'process.stdout.write("o"); process.stderr.write("e")',
      ]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe('o');
      expect(r.stderr).toBe('e');
    });

    it('resolves with exitCode 127 + error message when command does not exist', async () => {
      const r = await tryCapture('this-binary-does-not-exist-xyzzy', []);
      expect(r.exitCode).toBe(127);
      expect(r.stderr.length).toBeGreaterThan(0);
    });

    it('resolves with non-zero exitCode when command fails', async () => {
      const r = await tryCapture('node', ['-e', 'process.exit(3)']);
      expect(r.exitCode).toBe(3);
    });
  });

  describe('run', () => {
    it('resolves with exit code on success', async () => {
      const code = await run('node', ['-e', ''], { stdio: 'ignore' });
      expect(code).toBe(0);
    });

    it('resolves with non-zero exit code on failure', async () => {
      const code = await run('node', ['-e', 'process.exit(5)'], { stdio: 'ignore' });
      expect(code).toBe(5);
    });

    it('rejects when binary does not exist', async () => {
      await expect(
        run('this-binary-does-not-exist-xyzzy', [], { stdio: 'ignore' }),
      ).rejects.toThrow();
    });
  });
});
