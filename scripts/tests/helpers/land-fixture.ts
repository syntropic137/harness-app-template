import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type LandConfig, parseConfig } from '../../lib/land/config';
import type { EngineDeps, LandOptions } from '../../lib/land/engine';
import { runProcess } from '../../lib/land/exec';
import { hermeticGitEnv } from './land-git-env';
import { memoryLock } from './memory-lock';
import { spawnAsync } from './spawn-async';

/** A throwaway bare origin, two clones, a fake lefthook and a recording pre-push hook, for driving the land engine. */

// Awaited, never execFileSync: a test runs many fixture git commands back
// to back, and under a loaded land each costs seconds. Synchronously that is one uninterrupted block
// of the vitest worker's event loop, long enough to miss birpc's 60 s onTaskUpdate deadline. Throws
// on a non-zero exit exactly as execFileSync did, so every fixture step still fails loudly.
export const sh = async (cwd: string, cmd: string): Promise<string> => {
  const r = await spawnAsync('sh', ['-c', cmd], {
    cwd,
    env: {
      ...hermeticGitEnv(),
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  });
  if (r.status !== 0) {
    throw new Error(`sh -c ${cmd} failed with ${r.status ?? r.signal}: ${r.stderr}`);
  }
  return r.stdout.trim();
};

export interface Fixture {
  root: string;
  src: string;
  origin: string;
  other: string;
  home: string;
  state: string;
  logs: string[];
  errors: string[];
  deps: EngineDeps;
  env: Record<string, string | undefined>;
  config: (extra?: Record<string, unknown>) => LandConfig;
  /** Commit land.config.json (the base config plus `extra`) to main, as a real repo carries it; returns main's new tip. */
  publishConfig: (extra?: Record<string, unknown>) => Promise<string>;
  commit: (dir: string, file: string, text?: string) => Promise<string>;
  ran: () => string[];
  hookSeen: () => string[];
  mainTip: () => Promise<string>;
  clock: { t: number };
}

const FAKE_LEFTHOOK = `#!/bin/sh
[ "$1" = version ] && { echo "fake lefthook 0"; exit 0; }
if [ "$1" = dump ]; then
  # A stand-in for lefthook's merged view: the committed config files here, hashed.
  [ -n "$FAKE_DUMP_FAIL" ] && { echo "dump failed"; exit 1; }
  [ -n "$FAKE_DUMP" ] && { printf '%s\\n' "$FAKE_DUMP"; exit 0; }
  grep -q REMOTES lefthook.yml 2>/dev/null && { printf '{"remotes":[{"git_url":"u"}]}\\n'; exit 0; }
  printf '{"config":"%s"}\\n' "$(cat lefthook.yml lefthook.json 2>/dev/null | git hash-object --stdin)"
  exit 0
fi
if [ "$1" = install ]; then
  echo "$@" >> "$FAKE_STATE/install.log"
  [ -n "$FAKE_INSTALL_FAIL" ] && { echo "install refused"; exit 1; }
  [ -f "$FAKE_STATE/install-fail-once" ] && { rm -f "$FAKE_STATE/install-fail-once"; echo "install refused once"; exit 1; }
  hook=$(git rev-parse --path-format=absolute --git-path "hooks/$2")
  case "$FAKE_INSTALL_MODE" in
    noop) exit 0;;
    noexec) cp "$FAKE_HOOK_TEMPLATE" "$hook" && chmod 644 "$hook"; exit 0;;
    norunner) printf '#!/bin/sh\\nexit 0\\n' > "$hook" && chmod 755 "$hook"; exit 0;;
  esac
  cp "$FAKE_HOOK_TEMPLATE" "$hook" && chmod 755 "$hook"
  exit $?
fi
echo "$@" >> "$FAKE_STATE/lefthook.log"
cat >> "$FAKE_STATE/lefthook.stdin"
jobs=""
while [ $# -gt 0 ]; do
  case "$1" in
    --job|--command) jobs="$jobs $2"; shift;;
    --jobs|--commands) jobs="$jobs $(echo "$2" | tr ',' ' ')"; shift;;
  esac
  shift
done
if [ -f "$FAKE_STATE/move-once" ] || [ -f "$FAKE_STATE/move-always" ]; then
  rm -f "$FAKE_STATE/move-once"
  c=$(cat "$FAKE_STATE/move-count" 2>/dev/null || echo 0); c=$((c+1)); echo $c > "$FAKE_STATE/move-count"
  f=$(cat "$FAKE_STATE/move-file" 2>/dev/null || echo moved.txt)
  [ -f "$FAKE_STATE/move-always" ] && f="moved$c.txt"
  (cd "$FAKE_OTHER" && git pull -q origin main && mkdir -p "$(dirname "$f")" && echo moved > "$f" && git add -A && git commit -qm "main moved" && git push -q origin HEAD:main)
fi
for j in $jobs; do
  case " $FAKE_FAIL " in *" $j "*) echo "🥊 $j"; exit 1;; esac
  case " $FAKE_SKIP " in *" $j "*) continue;; esac
  echo "✔️ $j (0.01 seconds)"
done
`;

const HOOK = `#!/bin/sh
# Test stand-in for an installed hook that runs fake-lefthook (the runner land checks for).
echo "marker=$HARNESS_LAND_GATE exclude=$LEFTHOOK_EXCLUDE stdin=$(cat | tr '\\n' ' ')" >> "$FAKE_STATE/hook.log"
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX
n=$(cat "$FAKE_STATE/hook-count" 2>/dev/null || echo 0)
n=$((n+1)); echo $n > "$FAKE_STATE/hook-count"
case "$FAKE_HOOK" in
  refuse) echo "guard says no"; exit 1;;
  kill-first) [ "$n" = 1 ] && kill -9 $PPID;;
  kill-always) kill -9 $PPID;;
  land-then-kill) [ "$n" = 1 ] && { git --git-dir="$FAKE_ORIGIN" fetch -q "$PWD" "$HARNESS_LAND_GATE:refs/heads/main"; kill -9 $PPID; };;
  move-main) [ "$n" = 1 ] && (cd "$FAKE_OTHER" && git pull -q origin main && echo m > m2.txt && git add -A && git commit -qm m2 && git push -q origin HEAD:main) ;;
  noise-dup) printf ' \\t%s:refs/heads/main\\tnoise\\n' "$HARNESS_LAND_GATE";;
  noise-eq) printf '=\\t%s:refs/heads/main\\t[noise]\\n' "$HARNESS_LAND_GATE";;
esac
exit 0
`;

export async function fixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'land-e2e-'));
  const origin = join(root, 'origin.git');
  const src = join(root, 'src');
  const other = join(root, 'other');
  const state = join(root, 'state');
  const home = join(root, 'home');
  mkdirSync(state);
  await sh(
    root,
    `git init -q --bare -b main origin.git && git clone -q origin.git src 2>/dev/null && git clone -q origin.git other 2>/dev/null`,
  );
  writeFileSync(join(src, 'a.txt'), 'a\n');
  await sh(
    src,
    'git add -A && git commit -qm init && git push -q origin HEAD:main && git branch -M main',
  );
  await sh(other, 'git pull -q origin main');
  const fake = join(root, 'fake-lefthook');
  writeFileSync(fake, FAKE_LEFTHOOK);
  chmodSync(fake, 0o755);
  writeFileSync(join(root, 'hook-template'), HOOK);
  writeFileSync(join(src, '.git/hooks/pre-push'), HOOK);
  chmodSync(join(src, '.git/hooks/pre-push'), 0o755);
  const raw = (extra: Record<string, unknown>): Record<string, unknown> => ({
    lefthook: fake,
    scopes: {
      rust: ['**/*.rs'],
      ts: ['**/*.ts'],
      docs: ['**/*.md', 'docs/**'],
      text: ['**/*.txt'],
    },
    gates: [
      { name: 'cov-rust', when: ['rust'] },
      { name: 'cov-ts', when: ['ts'] },
      { name: 'doc-validator', when: ['docs'] },
      { name: 'adr' },
    ],
    ...extra,
  });
  const clock = { t: 1_000_000 };
  const lock = memoryLock();
  const logs: string[] = [];
  const errors: string[] = [];
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: root,
    GIT_DIR: '/nonexistent-ambient-git-dir',
    FAKE_STATE: state,
    FAKE_OTHER: other,
    FAKE_ORIGIN: origin,
    FAKE_HOOK_TEMPLATE: join(root, 'hook-template'),
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  };
  const deps: EngineDeps = {
    cwd: src,
    env,
    home,
    run: runProcess,
    lock: lock.deps,
    loadavg: () => 1,
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
    log: (m) => void logs.push(m),
    error: (m) => void errors.push(m),
    exists: existsSync,
    mkdirp: (p) => void mkdirSync(p, { recursive: true }),
    writeFile: (p, t) => writeFileSync(p, t),
    appendFile: (p, t) => appendFileSync(p, t),
    rmrf: (p) => rmSync(p, { recursive: true, force: true }),
    user: () => 'tester',
    host: () => 'testhost',
  };
  const read = (f: string): string[] =>
    existsSync(join(state, f))
      ? readFileSync(join(state, f), 'utf8').split('\n').filter(Boolean)
      : [];
  return {
    root,
    src,
    origin,
    other,
    home,
    state,
    logs,
    errors,
    deps,
    env,
    clock,
    config: (extra = {}) => parseConfig(raw(extra)),
    async publishConfig(extra = {}) {
      writeFileSync(join(src, 'land.config.json'), `${JSON.stringify(raw(extra), null, 2)}\n`);
      await sh(
        src,
        'git add land.config.json && git commit -qm "land config" && git push -q origin HEAD:main',
      );
      await sh(other, 'git pull -q origin main');
      return sh(src, 'git rev-parse HEAD');
    },
    async commit(dir, file, text = 'x\n') {
      mkdirSync(join(dir, file, '..'), { recursive: true });
      writeFileSync(join(dir, file), text);
      await sh(dir, `git add -A && git commit -qm "touch ${file}"`);
      return sh(dir, 'git rev-parse HEAD');
    },
    ran: () => read('lefthook.log').map((line) => line.replace(/ origin \S+$/, '')),
    hookSeen: () => read('hook.log'),
    mainTip: () => sh(root, 'git --git-dir=origin.git rev-parse main'),
  };
}

export interface RunLine {
  ref: string;
  sha: string | null;
  exit: number;
  dryRun: boolean;
  totalSeconds: number;
  waitedSeconds: number;
  sampleStart: string | null;
  sampleEnd: string | null;
  steps: { name: string; seconds: number; ok: boolean }[];
}

/** A run receipt line, parsed for assertions. */
export function parseRun(line: string): RunLine {
  try {
    return JSON.parse(line) as RunLine;
  } catch {
    throw new Error(`unparseable run receipt: ${line}`);
  }
}

export const OPTS: LandOptions = {
  ref: 'feat',
  mode: 'auto',
  message: null,
  dryRun: false,
  bootstrap: true,
  waitSeconds: null,
};
export const branch = async (f: Fixture, file: string): Promise<string> => {
  await sh(f.src, 'git checkout -q -B feat main');
  const sha = await f.commit(f.src, file);
  await sh(f.src, 'git checkout -q main');
  return sha;
};
