import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, loadavg, userInfo } from 'node:os';
import { join } from 'node:path';
import { isMainEntry } from './lib/entrypoint';
import { loadConfig } from './lib/land/config';
import { type EngineDeps, EXIT, type LandMode, type LandOptions, land } from './lib/land/engine';
import { runProcess } from './lib/land/exec';
import type { LockDeps } from './lib/land/lock';

export const USAGE = `usage: just land <branch-or-commit> [-- options]

Gated, isolated landing onto the target branch (see ADR-0033):
  lock + load check, persistent landing worktree reset to fresh origin/main,
  diff-scoped gates once BEFORE any network use, then a seconds-long SHA-bound
  push. Success means origin/<target> contains the SHA.

options:
  --mode auto|ff-only|cherry-pick|merge   default: auto
  --message <text>                        merge commit message (--mode merge only)
  --skip-bootstrap                        do not run the configured bootstrap
  --dry-run                               gate and exercise the pre-push guards; push nothing
  --help                                  print this help

configuration: land.config.json at the repo root (consumer-owned).`;

const MODES = new Set(['auto', 'ff-only', 'cherry-pick', 'merge']);

export type ParsedArgs =
  | { ok: true; options: LandOptions }
  | { ok: false; message: string; exitCode: number };

const bad = (message: string): ParsedArgs => ({ ok: false, message, exitCode: EXIT.usage });

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: LandOptions = {
    ref: '',
    mode: 'auto',
    message: null,
    dryRun: false,
    bootstrap: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') return { ok: false, message: USAGE, exitCode: 0 };
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--skip-bootstrap') options.bootstrap = false;
    else if (arg === '--mode' || arg === '--message') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return bad(`${arg} requires a value`);
      i += 1;
      if (arg === '--message') options.message = value;
      else if (MODES.has(value)) options.mode = value as LandMode;
      else return bad(`invalid --mode ${value}`);
    } else if (arg.startsWith('-')) return bad(`unknown option ${arg}`);
    else if (options.ref !== '') return bad(`unexpected extra ref ${arg}`);
    else options.ref = arg;
  }
  if (options.ref === '') return bad(USAGE);
  if (options.message !== null && options.mode !== 'merge')
    return bad('--message is only valid with --mode merge');
  return { ok: true, options };
}

export function landHome(env: Record<string, string | undefined>, home: string): string {
  return env.HARNESS_LAND_HOME ?? join(home, '.cache', 'harness-land');
}

/** Identifies this boot of the machine so a lock from before a reboot reads as stale. */
export function readBootId(read: (p: string) => string, probe: () => string): string {
  try {
    return read('/proc/sys/kernel/random/boot_id').trim();
  } catch {
    return probe();
  }
}

export function pidAlive(
  pid: number,
  kill: (pid: number, sig: 0) => unknown = process.kill,
): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/* v8 ignore start -- thin adapters over node:fs; exercised by scripts/tests/land-e2e.test.ts */
function realLockDeps(lockPath: string, log: (m: string) => void): LockDeps {
  return {
    lockPath,
    createExclusive(path, contents) {
      try {
        writeFileSync(path, contents, { flag: 'wx' });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      }
    },
    read: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    remove: (path) => rmSync(path, { force: true }),
    ageMs: (path) => (existsSync(path) ? Date.now() - statSync(path).mtimeMs : null),
    pidAlive: (pid) => pidAlive(pid),
    bootId: () =>
      readBootId(
        (p) => readFileSync(p, 'utf8'),
        () => {
          try {
            return execFileSync('sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8' }).trim();
          } catch {
            return 'unknown';
          }
        },
      ),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log,
  };
}

export function realDeps(env: NodeJS.ProcessEnv, cwd: string): EngineDeps {
  const home = landHome(env, homedir());
  mkdirSync(home, { recursive: true });
  const log = (m: string): void => console.log(m);
  return {
    cwd,
    env,
    home,
    run: runProcess,
    lock: realLockDeps(env.HARNESS_LAND_LOCK ?? join(home, 'land.lock'), log),
    loadavg: () => loadavg()[0] ?? 0,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log,
    error: (m) => console.error(m),
    exists: existsSync,
    mkdirp: (p) => mkdirSync(p, { recursive: true }),
    writeFile: (p, t) => writeFileSync(p, t),
    rmrf: (p) => rmSync(p, { recursive: true, force: true }),
    user: () => userInfo().username,
  };
}

if (isMainEntry(import.meta.url)) {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    (parsed.exitCode === 0 ? console.log : console.error)(parsed.message);
    process.exit(parsed.exitCode);
  }
  const deps = realDeps(process.env, process.cwd());
  process.exit(await land(deps, parsed.options, loadConfig(process.cwd())));
}
/* v8 ignore stop */
