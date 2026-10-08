import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { realDeps } from '../land';

// The real adapters are excluded from coverage (they are thin node:fs wrappers), which is exactly
// how a missing import once shipped in appendFile. Exercise every one of them once.
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('realDeps', () => {
  test('every adapter works against a real directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'land-real-deps-'));
    dirs.push(root);
    const deps = realDeps({ HARNESS_LAND_HOME: join(root, 'home'), PATH: process.env.PATH }, root);

    expect(deps.home).toBe(join(root, 'home'));
    expect(existsSync(deps.home)).toBe(true);
    const file = join(root, 'a', 'b.txt');
    deps.mkdirp(join(root, 'a'));
    deps.writeFile(file, 'one\n');
    deps.appendFile(file, 'two\n');
    expect(readFileSync(file, 'utf8')).toBe('one\ntwo\n');
    expect(deps.exists(file)).toBe(true);
    deps.rmrf(join(root, 'a'));
    expect(deps.exists(file)).toBe(false);
    expect(typeof deps.user()).toBe('string');
    expect(deps.loadavg()).toBeGreaterThanOrEqual(0);
    expect(deps.now()).toBeGreaterThan(0);
    await deps.sleep(1);
    const logs: string[] = [];
    const log = console.log;
    console.log = (m: string) => void logs.push(m);
    deps.log('hello');
    console.log = log;
    expect(logs).toEqual(['hello']);
    const result = await deps.run('sh', ['-c', 'echo ran'], { cwd: root });
    expect(result.output).toBe('ran');
  });

  test('the lock adapter is exclusive, atomic, and reads and removes what it wrote', () => {
    const root = mkdtempSync(join(tmpdir(), 'land-real-lock-'));
    dirs.push(root);
    const deps = realDeps(
      { HARNESS_LAND_HOME: root, HARNESS_LAND_LOCK: join(root, 'x.lock') },
      root,
    );
    const lock = deps.lock;
    expect(lock.lockPath).toBe(join(root, 'x.lock'));
    expect(lock.createExclusive(lock.lockPath, 'first')).toBe(true);
    expect(lock.createExclusive(lock.lockPath, 'second')).toBe(false);
    expect(lock.read(lock.lockPath)).toBe('first');
    expect(lock.read(join(root, 'absent'))).toBeNull();
    expect(lock.ageMs(lock.lockPath)).toBeGreaterThanOrEqual(0);
    expect(lock.ageMs(join(root, 'absent'))).toBeNull();
    expect(lock.pidAlive(process.pid)).toBe(true);
    expect(typeof lock.bootId()).toBe('string');
    expect(lock.now()).toBeGreaterThan(0);
    lock.remove(lock.lockPath);
    expect(existsSync(lock.lockPath)).toBe(false);
    writeFileSync(join(root, 'temp-leftover'), '');
    expect(readFileSync(join(root, 'temp-leftover'), 'utf8')).toBe('');
    // no temp files are left behind by createExclusive
    expect(lock.createExclusive(lock.lockPath, 'again')).toBe(true);
    expect(deps.exists(`${lock.lockPath}.${process.pid}`)).toBe(false);
  });
});
