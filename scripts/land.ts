import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname, loadavg, userInfo } from 'node:os';
import { join } from 'node:path';
import { isMainEntry } from './lib/entrypoint';
import { loadConfig } from './lib/land/config';
import { type EngineDeps, EXIT, type LandMode, type LandOptions, land } from './lib/land/engine';
import { runProcess } from './lib/land/exec';
import type { LockDeps } from './lib/land/lock';

export const USAGE = `usage: just verify <branch-or-commit> [-- options]   (then)
       just land <branch-or-commit> [-- options]

Two steps (docs/development/landing.md):
  verify  applies the ref onto fresh origin/main tip B in a verification worktree
          of its own (no lease; several verifies can run at once), runs the same
          diff-scoped gates and pre-push dry run as a full land, pushes nothing,
          and records a pass for the verified commit C.
  land    with a pass whose B is still origin/main's tip and whose land config
          is unchanged: takes the lease, pushes exactly C with a compare-and-swap
          on B and the SHA-bound marker (pre-push guards run), confirms C is on
          origin/main. Seconds, no gates. Without a current pass it says why and
          runs the full gated land (lease, gates, push), as before.
Success means origin/<target> contains the SHA.

options:
  --mode auto|ff-only|cherry-pick|merge   default: auto
  --message <text>                        merge commit message (--mode merge only)
  --skip-bootstrap                        do not run the configured bootstrap
  --wait <seconds>                        queue behind a live landing lock (or busy verification worktrees) this long (default: refuse at once, naming the holder)
  --dry-run                               full land: gate and exercise the pre-push guards; push nothing
  --require-pass                          land only from a current pass; refuse (exit 3) instead of the full land
  --pass-from <remote>                    use a pass verified on another clone: fetch its refs/land/verified/* and
                                          refs/notes/land-pass (same staleness rules as a local pass)
  --verify                                verify only (what \`just verify\` runs)
  --help                                  print this help

configuration: land.config.json at the repo root (consumer-owned).`;

const MODES = new Set(['auto', 'ff-only', 'cherry-pick', 'merge']);

export type ParsedArgs =
  | { ok: true; options: LandOptions }
  | { ok: false; message: string; exitCode: number };

type Failure = Extract<ParsedArgs, { ok: false }>;

const bad = (message: string): Failure => ({ ok: false, message, exitCode: EXIT.usage });

const FLAG_SETTERS: Record<string, (options: LandOptions) => void> = {
  '--dry-run': (o) => {
    o.dryRun = true;
  },
  '--skip-bootstrap': (o) => {
    o.bootstrap = false;
  },
  '--verify': (o) => {
    o.verify = true;
  },
  '--require-pass': (o) => {
    o.requirePass = true;
  },
};

const VALUE_FLAGS = new Set(['--mode', '--message', '--wait', '--pass-from']);
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function applyValue(options: LandOptions, arg: string, value: string): Failure | null {
  if (arg === '--pass-from') {
    if (!REMOTE_NAME.test(value)) return bad(`invalid --pass-from remote ${value}`);
    options.passFrom = value;
  } else if (arg === '--message') {
    options.message = value;
  } else if (arg === '--wait') {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return bad(`invalid --wait ${value}`);
    options.waitSeconds = seconds;
  } else if (MODES.has(value)) {
    options.mode = value as LandMode;
  } else {
    return bad(`invalid --mode ${value}`);
  }
  return null;
}

function parseValueFlag(
  argv: readonly string[],
  i: number,
  arg: string,
  options: LandOptions,
): number | Failure {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) return bad(`${arg} requires a value`);
  return applyValue(options, arg, value) ?? i + 1;
}

function parsePositional(arg: string, i: number, options: LandOptions): number | Failure {
  if (arg.startsWith('-')) return bad(`unknown option ${arg}`);
  if (options.ref !== '') return bad(`unexpected extra ref ${arg}`);
  options.ref = arg;
  return i;
}

/** Parse the argument at `i`; returns the index of the last argument consumed, or a failure. */
function parseStep(argv: readonly string[], i: number, options: LandOptions): number | Failure {
  const arg = argv[i] as string;
  if (arg === '--') return i;
  if (arg === '--help' || arg === '-h') return { ok: false, message: USAGE, exitCode: 0 };
  const flag = FLAG_SETTERS[arg];
  if (flag !== undefined) {
    flag(options);
    return i;
  }
  return VALUE_FLAGS.has(arg)
    ? parseValueFlag(argv, i, arg, options)
    : parsePositional(arg, i, options);
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: LandOptions = {
    ref: '',
    mode: 'auto',
    message: null,
    dryRun: false,
    bootstrap: true,
    waitSeconds: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const next = parseStep(argv, i, options);
    if (typeof next !== 'number') return next;
    i = next;
  }
  if (options.ref === '') return bad(USAGE);
  if (options.message !== null && options.mode !== 'merge')
    return bad('--message is only valid with --mode merge');
  if (options.verify === true && options.dryRun)
    return bad('--dry-run does not apply to verify: verify never pushes');
  const landOnly = options.requirePass === true || options.passFrom !== undefined;
  if (landOnly && (options.verify === true || options.dryRun))
    return bad('--require-pass and --pass-from apply to a real land only');
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
    // Publish atomically: write a private temp file, then link() it into place. link() fails with
    // EEXIST rather than overwriting, and a reader can never observe a half-written lock.
    createExclusive(path, contents) {
      const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(temp, contents);
      try {
        linkSync(temp, path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      } finally {
        rmSync(temp, { force: true });
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
    appendFile: (p, t) => appendFileSync(p, t),
    rmrf: (p) => rmSync(p, { recursive: true, force: true }),
    user: () => userInfo().username,
    host: () => hostname(),
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
