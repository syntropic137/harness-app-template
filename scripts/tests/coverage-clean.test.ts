import type { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { main, realDeps } from '../coverage-clean';
import {
  type CoverageCommand,
  cleanCommandsForLane,
  coverageTargetDir,
  type RustLane,
  rustCleanCommands,
  rustLaneCommands,
} from '../lib/coverage';
import { spawnAsync } from './helpers/spawn-async';

// The regression below compiles a one-function crate with the real lane command (cargo llvm-cov
// --profile cov): seconds alone, far more under a loaded full-suite run.
vi.setConfig({ testTimeout: 300_000 });

type Spawn = typeof spawnSync;
const ok = { status: 0, error: undefined } as unknown as ReturnType<Spawn>;

function fakeDeps(results: Array<ReturnType<Spawn>> = []) {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const spawn = ((command: string, args: readonly string[]) => {
    calls.push(`${command} ${args.join(' ')}`);
    return results.shift() ?? ok;
  }) as unknown as Spawn;
  return {
    calls,
    out,
    err,
    deps: {
      spawn,
      stdout: { log: (m: string) => void out.push(m) },
      stderr: { error: (m: string) => void err.push(m) },
      cwd: '/repo',
    },
  };
}

describe('coverage-clean', () => {
  test('cleans the cov profile, not only dev and release, for every Rust lane of a lane', () => {
    const commands = cleanCommandsForLane('rust', '/repo');
    const profile = commands.filter((c) => c.args[0] === 'clean');
    expect(profile.length).toBeGreaterThan(0);
    for (const c of profile) {
      expect(c.args).toEqual(expect.arrayContaining(['--workspace', '--profile', 'cov']));
      expect(c.args.at(-1)).toBe(join(coverageTargetDir('/repo'), 'llvm-cov-target'));
    }
    expect(commands.filter((c) => c.args[0] === 'llvm-cov')).toHaveLength(profile.length);
    expect(cleanCommandsForLane('py', '/repo')).toEqual([]);
  });

  test('runs every clean command in order and exits 0', () => {
    const f = fakeDeps();
    expect(main(['example-rust'], f.deps)).toBe(0);
    expect(f.calls[0]).toBe('cargo llvm-cov --version');
    expect(f.calls.slice(1)).toEqual(
      cleanCommandsForLane('example-rust', '/repo').map((c) => `${c.command} ${c.args.join(' ')}`),
    );
  });

  test('a lane with no Rust has nothing to clean and never probes cargo', () => {
    const f = fakeDeps();
    expect(main(['py'], f.deps)).toBe(0);
    expect(f.calls).toEqual([]);
  });

  test('without cargo-llvm-cov there is nothing to clean: says so, exits 0', () => {
    const f = fakeDeps([{ status: 1 } as ReturnType<Spawn>]);
    expect(main(['rust'], f.deps)).toBe(0);
    expect(f.out.join('\n')).toMatch(/cargo-llvm-cov is not installed; nothing to clean/);
    expect(f.calls).toHaveLength(1);
  });

  test('a failing clean stops the run with its exit code, naming why', () => {
    const f = fakeDeps([ok, { status: 3 } as ReturnType<Spawn>]);
    expect(main(['rust'], f.deps)).toBe(3);
    expect(f.err.join('\n')).toMatch(/FAIL: cargo exited with 3/);
    const g = fakeDeps([ok, { status: null, error: new Error('ENOENT') } as ReturnType<Spawn>]);
    expect(main(['rust'], g.deps)).toBe(1);
    expect(g.err.join('\n')).toMatch(/failed to run \(ENOENT\)/);
    const h = fakeDeps([ok, { status: null } as ReturnType<Spawn>]);
    expect(main(['rust'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toMatch(/exited with signal/);
  });

  test('an unknown lane is a usage error', () => {
    const f = fakeDeps();
    expect(main([], f.deps)).toBe(64);
    expect(f.err.join('\n')).toMatch(/usage: coverage-clean.ts </);
  });

  test('the real handles run in the current directory', () => {
    const deps = realDeps();
    expect(deps.cwd).toBe(process.cwd());
    expect(deps.stdout).toBe(console);
    expect(deps.stderr).toBe(console);
    expect(main(['py'], deps)).toBe(0); // a non-Rust lane: nothing is spawned
  });
});

function hasLlvmCov(): boolean {
  try {
    execFileSync('cargo', ['llvm-cov', '--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function runAll(commands: CoverageCommand[], root: string): Promise<void> {
  for (const c of commands) {
    const r = await spawnAsync(c.command, c.args, { cwd: root, env: { ...process.env, ...c.env } });
    if (r.status !== 0) throw new Error(`${c.command} ${c.args.join(' ')}: ${r.stderr}`);
  }
}

/** Files under `dir` (recursively) whose name mentions `crate`. */
function artifactsOf(dir: string, crate: string): string[] {
  try {
    return readdirSync(dir, { recursive: true })
      .map(String)
      .filter((p) => p.includes(crate));
  } catch {
    return [];
  }
}

describe.skipIf(!hasLlvmCov())('coverage-clean against a real cov-profile build', () => {
  test('the real lane command leaves --profile cov objects that only the cov-profile clean removes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cov-clean-'));
    roots.push(root);
    mkdirSync(join(root, 'probe', 'src'), { recursive: true });
    writeFileSync(
      join(root, 'probe', 'Cargo.toml'),
      [
        '[package]',
        'name = "covprobe"',
        'version = "0.1.0"',
        'edition = "2021"',
        '',
        '[workspace]',
        '',
        '[profile.cov]',
        'inherits = "dev"',
        'debug = "line-tables-only"',
        'incremental = false',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(root, 'probe', 'src', 'lib.rs'),
      'pub fn f(x: u32) -> u32 { x + 1 }\n#[cfg(test)]\nmod t { #[test] fn t() { assert_eq!(super::f(1), 2); } }\n',
    );
    const lane: RustLane = {
      manifestPath: 'probe/Cargo.toml',
      packageName: 'covprobe',
      libOnly: false,
      failUnderLines: 0,
      failUnderFunctions: 0,
    };
    await runAll(rustLaneCommands(lane, root), root);
    const objects = join(coverageTargetDir(root), 'llvm-cov-target', 'cov');
    expect(artifactsOf(objects, 'covprobe').some((p) => p.endsWith('.o'))).toBe(true);
    const [llvmCovClean, profileClean] = rustCleanCommands(lane, root);
    // The control: llvm-cov's own clean leaves the cov-profile objects behind.
    await runAll([llvmCovClean as CoverageCommand], root);
    expect(artifactsOf(objects, 'covprobe').some((p) => p.endsWith('.o'))).toBe(true);
    await runAll([profileClean as CoverageCommand], root);
    expect(artifactsOf(objects, 'covprobe')).toEqual([]);
  });
});
