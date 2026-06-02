import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(testDir, '..');
const repoRoot = resolve(packageRoot, '../..');

function run(command: string, args: string[]) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

describe('inspector slot smoke test', () => {
  it('prints dispatcher help successfully', () => {
    const result = run('bash', [join(packageRoot, 'bin/inspector'), '--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('harness inspector');
    expect(result.stdout).toContain('screenshot-pair');
    expect(result.stderr).toBe('');
  });

  it.each([
    'screenshot-pair.mjs',
    'record-flow.mjs',
    'keyframe-grid.mjs',
  ])('syntax-checks %s', (script) => {
    const result = run('node', ['--check', join(packageRoot, script)]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
