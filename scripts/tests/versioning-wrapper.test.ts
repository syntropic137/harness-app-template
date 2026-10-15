import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { spawnAsync } from './helpers/spawn-async';

// Builds a one-file crate three times with cargo through the wrapper: seconds alone, more under load.
vi.setConfig({ testTimeout: 120_000 });

// harness/versioning/bin/versioning runs the binary it built without cargo's freshness check only
// while a stamp binds both the pristine crate tree and the binary's own hash. Replays the sequence
// that broke a tree-only stamp: a clean build A, a dirty build B, the source restored to A.
const WRAPPER = resolve(__dirname, '../../harness/versioning/bin/versioning');

function hasCargo(): boolean {
  try {
    execFileSync('cargo', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const gitEnv = {
  ...process.env,
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_INDEX_FILE: undefined,
};

async function sh(cwd: string, command: string): Promise<string> {
  const r = await spawnAsync('sh', ['-c', command], { cwd, env: gitEnv });
  if (r.status !== 0) throw new Error(`${command}: ${r.stderr}${r.stdout}`);
  return r.stdout.trim();
}

const source = (marker: string) => `fn main() { println!("${marker}"); }\n`;

describe.skipIf(!hasCargo())('versioning wrapper fast path', () => {
  test('a dirty build between two clean runs never leaves the wrong binary trusted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'versioning-wrapper-'));
    dirs.push(root);
    const crate = join(root, 'crate');
    mkdirSync(join(crate, 'bin'), { recursive: true });
    mkdirSync(join(crate, 'src'));
    writeFileSync(
      join(crate, 'Cargo.toml'),
      '[package]\nname = "harness-versioning"\nversion = "0.1.0"\nedition = "2021"\n\n[workspace]\n',
    );
    writeFileSync(join(crate, 'src', 'main.rs'), source('validator A'));
    writeFileSync(join(root, '.gitignore'), 'target/\n');
    copyFileSync(WRAPPER, join(crate, 'bin', 'versioning'));
    chmodSync(join(crate, 'bin', 'versioning'), 0o755);
    // The lockfile is committed, as in the real crate: an untracked one would keep it unstamped.
    await sh(
      root,
      'cargo generate-lockfile -q --manifest-path crate/Cargo.toml && git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm A',
    );
    const run = () => sh(crate, 'bin/versioning');

    expect(await run()).toBe('validator A'); // built and stamped
    const stamped = (dir: string) =>
      readdirSync(dir, { recursive: true }).some((n) => String(n).includes('.harness-versioning.'));
    expect(stamped(join(crate, 'target'))).toBe(true); // the fast path is live, so the next steps test it
    expect(await run()).toBe('validator A'); // the stamped fast path
    writeFileSync(join(crate, 'src', 'main.rs'), source('validator B')); // a dirty edit
    expect(await run()).toBe('validator B'); // built, not stamped
    await sh(root, 'git checkout -- crate/src/main.rs'); // back to A
    expect(await run()).toBe('validator A'); // the binary is B's: its hash refuses the stamp
    expect(await run()).toBe('validator A');

    // A cargo config now sends the build elsewhere, with new source: the wrapper must run what
    // cargo built there, never the old binary still at the default path.
    mkdirSync(join(crate, '.cargo'));
    writeFileSync(join(crate, '.cargo', 'config.toml'), '[build]\ntarget-dir = "out"\n');
    writeFileSync(join(crate, 'src', 'main.rs'), source('validator C'));
    writeFileSync(join(root, '.gitignore'), 'target/\nout/\n');
    await sh(root, 'git add -A && git -c user.email=t@t -c user.name=t commit -qm C');
    expect(await run()).toBe('validator C');
    expect(await run()).toBe('validator C'); // stamped, at cargo's path
  });
});
