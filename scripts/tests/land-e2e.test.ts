import { execFileSync } from 'node:child_process';
import {
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
import { describe, expect, test, vi } from 'vitest';
import { type LandConfig, parseConfig } from '../lib/land/config';
import { type EngineDeps, EXIT, type LandOptions, land } from '../lib/land/engine';
import { runProcess } from '../lib/land/exec';
import { hermeticGitEnv } from './helpers/land-git-env';
import { memoryLock } from './helpers/memory-lock';

const sh = (cwd: string, cmd: string): string =>
  execFileSync('sh', ['-c', cmd], {
    cwd,
    encoding: 'utf8',
    env: {
      ...hermeticGitEnv(),
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();

interface Fixture {
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
  commit: (dir: string, file: string, text?: string) => string;
  ran: () => string[];
  hookSeen: () => string[];
  mainTip: () => string;
  clock: { t: number };
}

const FAKE_LEFTHOOK = `#!/bin/sh
echo "$@" >> "$FAKE_STATE/lefthook.log"
jobs=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--job" ]; then jobs="$jobs $2"; shift; fi
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
esac
exit 0
`;

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'land-e2e-'));
  const origin = join(root, 'origin.git');
  const src = join(root, 'src');
  const other = join(root, 'other');
  const state = join(root, 'state');
  const home = join(root, 'home');
  mkdirSync(state);
  sh(
    root,
    `git init -q --bare -b main origin.git && git clone -q origin.git src 2>/dev/null && git clone -q origin.git other 2>/dev/null`,
  );
  writeFileSync(join(src, 'a.txt'), 'a\n');
  sh(
    src,
    'git add -A && git commit -qm init && git push -q origin HEAD:main && git branch -M main',
  );
  sh(other, 'git pull -q origin main');
  const fake = join(root, 'fake-lefthook');
  writeFileSync(fake, FAKE_LEFTHOOK);
  chmodSync(fake, 0o755);
  writeFileSync(join(src, '.git/hooks/pre-push'), HOOK);
  chmodSync(join(src, '.git/hooks/pre-push'), 0o755);
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
    rmrf: (p) => rmSync(p, { recursive: true, force: true }),
    user: () => 'tester',
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
    config: (extra = {}) =>
      parseConfig({
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
      }),
    commit(dir, file, text = 'x\n') {
      mkdirSync(join(dir, file, '..'), { recursive: true });
      writeFileSync(join(dir, file), text);
      sh(dir, `git add -A && git commit -qm "touch ${file}"`);
      return sh(dir, 'git rev-parse HEAD');
    },
    ran: () => read('lefthook.log'),
    hookSeen: () => read('hook.log'),
    mainTip: () => sh(root, 'git --git-dir=origin.git rev-parse main'),
  };
}

const OPTS: LandOptions = {
  ref: 'feat',
  mode: 'auto',
  message: null,
  dryRun: false,
  bootstrap: true,
};
const branch = (f: Fixture, file: string): string => {
  sh(f.src, 'git checkout -q -B feat main');
  const sha = f.commit(f.src, file);
  sh(f.src, 'git checkout -q main');
  return sha;
};

vi.setConfig({ testTimeout: 120_000 });

describe('land engine end to end (real git, local bare origin)', () => {
  test('docs-only land runs only docs and unconditional gates, then pushes with exact-SHA exclusions', async () => {
    const f = fixture();
    const sha = branch(f, 'docs/note.md');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.mainTip()).toBe(sha);
    expect(f.ran()).toEqual(['run pre-push --force --job doc-validator --job adr']);
    const seen = f.hookSeen()[0] ?? '';
    expect(seen).toContain(`marker=${sha}`);
    // adr and doc-validator ran on this SHA; cov-rust and cov-ts are inapplicable to a docs-only diff
    expect(seen).toContain('exclude=adr,cov-rust,cov-ts,doc-validator ');
    expect(f.logs.some((l) => l.startsWith('LANDED'))).toBe(true);
    expect(f.logs.join('\n')).toMatch(
      /plan: scopes: docs; gates: doc-validator, adr; not applicable: cov-rust, cov-ts/,
    );
  });

  test('rust-only land runs rust and unconditional gates', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.ran()).toEqual(['run pre-push --force --job cov-rust --job adr']);
  });

  test('an unmapped path runs the full suite', async () => {
    const f = fixture();
    branch(f, 'mystery.bin');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.ran()).toEqual([
      'run pre-push --force --job cov-rust --job cov-ts --job doc-validator --job adr',
    ]);
    expect(f.hookSeen()[0]).toMatch(/exclude=adr,cov-rust,cov-ts,doc-validator /);
  });

  test('changing land.config.json or the engine runs the full suite', async () => {
    const f = fixture();
    branch(f, 'scripts/lib/land/engine.ts');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.ran()[0]).toContain('--job cov-rust --job cov-ts');
  });

  test('a failed gate stops before any push', async () => {
    const f = fixture();
    const before = f.mainTip();
    branch(f, 'crates/x.rs');
    f.env.FAKE_FAIL = 'cov-rust';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.gate);
    expect(f.mainTip()).toBe(before);
    expect(f.hookSeen()).toEqual([]);
    expect(f.errors.join('\n')).toMatch(/gates failed: exit status 1/);
  });

  test('exit 0 with a job missing from the summary is a failure, not a silent skip', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    f.env.FAKE_SKIP = 'cov-rust';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/not reported as passed: cov-rust/);
  });

  test('command gates, checks, bootstrap and preflight run with placeholders', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    const config = f.config({
      bootstrap: { run: 'echo boot >> "$FAKE_STATE/boot.log"', when: ['ts'] },
      preflight: [{ name: 'pre', run: 'echo {source} > "$FAKE_STATE/pre.log"', cwd: 'source' }],
      gates: [
        { name: 'cmd', run: 'echo gated >> "$FAKE_STATE/cmd.log"', when: ['rust'] },
        { name: 'skipme', run: 'false', when: ['ts'] },
      ],
      checks: [
        {
          name: 'chk',
          run: 'test "$(git rev-parse HEAD)" = {head} && git diff --exit-code {base} -- baseline.json',
        },
      ],
    });
    expect(await land(f.deps, OPTS, config)).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'cmd.log'), 'utf8')).toBe('gated\n');
    expect(readFileSync(join(f.state, 'boot.log'), 'utf8')).toBe('boot\n'); // first run bootstraps
    expect(f.ran()).toEqual([]); // no lefthook gates at all
    expect(f.hookSeen()[0]).toMatch(/exclude=\s/);
    // second land: bootstrap not repeated (ts untouched), persistent worktree reused
    sh(f.src, 'git checkout -q -B feat2 main');
    f.commit(f.src, 'crates/y.rs');
    sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'feat2' }, config)).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'boot.log'), 'utf8')).toBe('boot\n');
    // --skip-bootstrap
    sh(f.src, 'git checkout -q -B feat3 main');
    f.commit(f.src, 'z/z.ts');
    sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'feat3', bootstrap: false }, config)).toBe(EXIT.gate);
    expect(readFileSync(join(f.state, 'boot.log'), 'utf8')).toBe('boot\n');
  });

  test('a failing project check blocks landing', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    expect(
      await land(
        f.deps,
        OPTS,
        f.config({ checks: [{ name: 'baseline', run: 'echo drift; exit 3' }] }),
      ),
    ).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/baseline failed \(exit status 3\)\ndrift/);
  });

  test('a push killed by a signal that did not land is reported by signal and retried', async () => {
    const f = fixture();
    const sha = branch(f, 'crates/x.rs');
    f.env.FAKE_HOOK = 'kill-first';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.mainTip()).toBe(sha);
    expect(f.logs.join('\n')).toMatch(/push killed by SIGKILL; origin\/main unmoved, retrying/);
  });

  test('a push that always dies fails after bounded retries and names the signal', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    f.env.FAKE_HOOK = 'kill-always';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.push);
    expect(f.errors.join('\n')).toMatch(
      /push failed \(killed by SIGKILL\) and origin\/main does not contain/,
    );
    expect(f.hookSeen()).toHaveLength(3);
  });

  test('a push reported as failed that actually landed is a success', async () => {
    const f = fixture();
    const sha = branch(f, 'crates/x.rs');
    f.env.FAKE_HOOK = 'land-then-kill';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.mainTip()).toBe(sha);
    expect(f.logs.join('\n')).toMatch(/push reported killed by SIGKILL but origin\/main contains/);
  });

  test('a hook refusal (not transport) fails without retry', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    f.env.FAKE_HOOK = 'refuse';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.push);
    expect(f.hookSeen()).toHaveLength(1);
    expect(f.errors.join('\n')).toMatch(/exit status 1\) and origin\/main does not contain/);
  });

  test('main moving during validation re-applies on the new base; evidence for the old SHA is discarded', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    writeFileSync(join(f.state, 'move-once'), '');
    writeFileSync(join(f.state, 'move-file'), 'crates/other.rs');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    // the gate set ran again on the new SHA because the SHA changed
    expect(f.ran()).toEqual([
      'run pre-push --force --job cov-rust --job adr',
      'run pre-push --force --job cov-rust --job adr',
    ]);
    expect(f.logs.join('\n')).toMatch(/moved during validation; re-applying/);
    const landed = f.mainTip();
    expect(f.hookSeen()[0]).toContain(`marker=${landed}`);
    expect(sh(f.src, `git --git-dir=${f.origin} log --format=%s -3`)).toContain('main moved');
  });

  test('evidence can be inherited across a re-apply only when enabled and the delta misses the gate scope', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    writeFileSync(join(f.state, 'move-once'), '');
    writeFileSync(join(f.state, 'move-file'), 'docs/moved.md'); // delta outside rust
    const config = f.config({ inheritUnaffectedEvidence: true, maxAttempts: 3 });
    expect(await land(f.deps, OPTS, config)).toBe(EXIT.ok);
    // `adr` is unconditional (no scope) so it is not provably unaffected and re-runs; cov-rust is inherited.
    expect(f.ran()).toEqual([
      'run pre-push --force --job cov-rust --job adr',
      'run pre-push --force --job adr',
    ]);
    expect(f.hookSeen()[0]).toMatch(/exclude=adr,cov-rust,cov-ts,doc-validator /);
  });

  test('main moving between gates and push (rejected push) re-applies', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    f.env.FAKE_HOOK = 'move-main';
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.logs.join('\n')).toMatch(/moved before the push landed; re-applying/);
    expect(f.ran()).toHaveLength(2);
  });

  test('gives up when main never stops moving', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    writeFileSync(join(f.state, 'move-always'), '');
    expect(await land(f.deps, OPTS, f.config({ maxAttempts: 2 }))).toBe(EXIT.push);
    expect(f.errors.join('\n')).toMatch(/kept moving; gave up after 2 attempts/);
  });

  test('cherry-picks when main has advanced past the branch base; ff-only and merge modes', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    f.commit(f.other, 'docs/adv.md');
    sh(f.other, 'git push -q origin HEAD:main');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.logs.join('\n')).toMatch(/cherry-picking 1 commit/);
    // ff-only fails when diverged
    sh(f.src, 'git fetch -q origin && git checkout -q -B feat4 origin/main~1');
    f.commit(f.src, 'crates/q.rs');
    sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'feat4', mode: 'ff-only' }, f.config())).toBe(
      EXIT.gate,
    );
    // merge mode with and without message
    expect(
      await land(
        f.deps,
        { ...OPTS, ref: 'feat4', mode: 'merge', message: 'custom msg' },
        f.config(),
      ),
    ).toBe(EXIT.ok);
    expect(sh(f.src, `git --git-dir=${f.origin} log -1 --format=%s`)).toBe('custom msg');
    sh(f.src, 'git checkout -q -B feat5 origin/main~1');
    f.commit(f.src, 'crates/r.rs');
    sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'feat5', mode: 'merge' }, f.config())).toBe(EXIT.ok);
  });

  test('a ref with nothing new and a conflicting cherry-pick both fail cleanly', async () => {
    const f = fixture();
    expect(await land(f.deps, { ...OPTS, ref: 'main', mode: 'cherry-pick' }, f.config())).toBe(
      EXIT.gate,
    );
    expect(f.errors.join('\n')).toMatch(/has no commits absent/);
    sh(f.src, 'git checkout -q -B conflict main');
    f.commit(f.src, 'c.txt', 'one\n');
    sh(f.src, 'git checkout -q main');
    f.commit(f.other, 'c.txt', 'two\n');
    sh(f.other, 'git push -q origin HEAD:main');
    expect(await land(f.deps, { ...OPTS, ref: 'conflict' }, f.config())).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/cherry-pick .* failed/);
  });

  test('unknown ref, unfetchable remote and broken worktree are reported or healed', async () => {
    const f = fixture();
    expect(await land(f.deps, { ...OPTS, ref: 'nope' }, f.config())).toBe(EXIT.gate);
    branch(f, 'crates/x.rs');
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    // corrupt the persistent worktree: it is rebuilt
    const wt =
      f.logs.find((l) => l.includes('plan:')) &&
      join(f.home, readdirSync(f.home).find((d) => d.startsWith('src-')) ?? '', 'worktree');
    rmSync(join(wt as string, '.git'), { force: true });
    writeFileSync(join(wt as string, '.git'), 'gitdir: /nonexistent\n');
    sh(f.src, 'git checkout -q -B again main');
    f.commit(f.src, 'crates/again.rs');
    sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'again' }, f.config())).toBe(EXIT.ok);
    // remote gone
    sh(f.src, `git remote set-url origin ${join(f.root, 'gone.git')}`);
    expect(await land(f.deps, { ...OPTS, ref: 'again' }, f.config())).toBe(EXIT.push);
    expect(f.errors.join('\n')).toMatch(/fetch origin failed/);
  });

  test('when no gate applies nothing runs through lefthook and nothing is excluded needlessly', async () => {
    const f = fixture();
    branch(f, 'docs/only.md');
    const config = f.config({ gates: [{ name: 'cov-rust', when: ['rust'] }] });
    expect(await land(f.deps, OPTS, config)).toBe(EXIT.ok);
    expect(f.ran()).toEqual([]);
    expect(f.logs.join('\n')).toMatch(/gates: none; not applicable: cov-rust/);
    expect(f.hookSeen()[0]).toContain('exclude=cov-rust ');
  });

  test('an unreadable diff runs the full suite', async () => {
    const f = fixture();
    branch(f, 'docs/only.md');
    const real = f.deps.run;
    f.deps.run = async (cmd, args, o) =>
      cmd === 'git' &&
      args.includes('diff') &&
      args.includes('--name-only') &&
      !args.includes('HEAD')
        ? { status: 128, signal: null, output: 'boom' }
        : real(cmd, args, o);
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.ok);
    expect(f.ran()[0]).toContain('--job cov-rust --job cov-ts');
    expect(f.logs.join('\n')).toMatch(/changed files could not be read/);
  });

  test('unexpected throws surface as a gate failure', async () => {
    const f = fixture();
    f.deps.run = async () => {
      throw new Error('spawn exploded');
    };
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.gate);
    expect(f.errors).toEqual(['spawn exploded']);
    f.errors.length = 0;
    const nonError: unknown = 'plain string';
    f.deps.run = async () => {
      throw nonError;
    };
    expect(await land(f.deps, OPTS, f.config())).toBe(EXIT.gate);
    expect(f.errors).toEqual(['plain string']);
  });

  test('dry run exercises the real pre-push hook with synthetic ref lines and pushes nothing', async () => {
    const f = fixture();
    const before = f.mainTip();
    const sha = branch(f, 'crates/x.rs');
    expect(await land(f.deps, { ...OPTS, dryRun: true }, f.config())).toBe(EXIT.ok);
    expect(f.mainTip()).toBe(before);
    expect(f.hookSeen()[0]).toContain(`marker=${sha}`);
    expect(f.hookSeen()[0]).toContain(`stdin=HEAD ${sha} refs/heads/main ${before}`);
    f.env.FAKE_HOOK = 'refuse';
    expect(await land(f.deps, { ...OPTS, dryRun: true }, f.config())).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/guards refused the dry run/);
  });

  test('ambient LEFTHOOK=0, LEFTHOOK_EXCLUDE and CARGO_TARGET_DIR never reach gates or the push', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    f.env.LEFTHOOK = '0';
    f.env.LEFTHOOK_EXCLUDE = 'everything';
    f.env.CARGO_TARGET_DIR = '/shared/target';
    f.env.HARNESS_LAND_GATE = 'forged';
    const config = f.config({
      checks: [
        {
          name: 'env',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax, not a template literal
          run: 'echo "L=${LEFTHOOK-unset} X=${LEFTHOOK_EXCLUDE-unset} C=${CARGO_TARGET_DIR-unset} G=${HARNESS_LAND_GATE-unset}" > "$FAKE_STATE/env.log"',
        },
      ],
    });
    expect(await land(f.deps, OPTS, config)).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'env.log'), 'utf8').trim()).toBe(
      'L=unset X=unset C=unset G=unset',
    );
    expect(f.hookSeen()[0]).not.toContain('forged');
    expect(f.hookSeen()[0]).not.toContain('everything');
  });

  test('a gate whose required tool is missing fails closed instead of soft-skipping', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    const config = f.config({
      gates: [
        { name: 'cov-rust', when: ['rust'], requires: ['definitely-not-installed-xyz', 'sh'] },
      ],
    });
    expect(await land(f.deps, OPTS, config)).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(
      /required tool\(s\) not on PATH: definitely-not-installed-xyz/,
    );
    expect(f.ran()).toEqual([]);
    const ok = f.config({ gates: [{ name: 'cov-rust', when: ['rust'], requires: ['sh'] }] });
    expect(await land(f.deps, OPTS, ok)).toBe(EXIT.ok);
  });

  test('gates that rewrite the tree they validate invalidate the evidence, except declared paths', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    const mutate = { gates: [{ name: 'mut', run: 'echo changed >> a.txt', when: ['rust'] }] };
    expect(await land(f.deps, OPTS, f.config(mutate))).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(
      /gates changed the tree they were validating .*modified: a.txt/,
    );
    expect(f.hookSeen()).toEqual([]);
    const allowed = f.config({ ...mutate, ignoreDirty: ['a.txt'] });
    expect(await land(f.deps, OPTS, allowed)).toBe(EXIT.ok);
    const moved = {
      gates: [{ name: 'mv', run: 'git commit -q --allow-empty -m sneaky', when: ['rust'] }],
    };
    sh(f.src, 'git checkout -q -B feat9 main');
    f.commit(f.src, 'crates/n.rs');
    sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'feat9' }, f.config(moved))).toBe(EXIT.gate);
    expect(f.errors.join('\n')).toMatch(/HEAD [0-9a-f]{12} vs [0-9a-f]{12}/);
  });

  test('git config injection and repo-routing variables never reach gates; the diff base is bound', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    f.env.GIT_CONFIG_COUNT = '1';
    f.env.GIT_CONFIG_KEY_0 = 'core.hooksPath';
    f.env.GIT_CONFIG_VALUE_0 = '/dev/null';
    f.env.GIT_CONFIG_PARAMETERS = "'core.hooksPath=/dev/null'";
    const config = f.config({
      env: { GIT_DIR: '/elsewhere' },
      checks: [
        {
          name: 'cfg',
          // biome-ignore lint/suspicious/noTemplateCurlyInString: shell syntax, not a template literal
          run: 'echo "$(git config harness.hookBaseRemote)/$(git config harness.hookBaseRef) $(git config core.hooksPath) ${GIT_DIR-unset} ${GIT_CONFIG_PARAMETERS-unset}" > "$FAKE_STATE/cfg.log"',
        },
      ],
    });
    expect(await land(f.deps, OPTS, config)).toBe(EXIT.ok);
    expect(readFileSync(join(f.state, 'cfg.log'), 'utf8').trim()).toBe('origin/main  unset unset');
    expect(f.hookSeen()).toHaveLength(1); // the push hook still fired
  });

  test('waits for load, gives up when it never drops, and queues behind the lock', async () => {
    const f = fixture();
    branch(f, 'crates/x.rs');
    let calls = 0;
    f.deps.loadavg = () => (++calls < 4 ? 99 : 1);
    expect(await land(f.deps, OPTS, f.config({ loadPollSeconds: 5 }))).toBe(EXIT.ok);
    expect(f.logs.filter((l) => l.includes('is above 40')).length).toBeGreaterThan(0);
    f.deps.loadavg = () => 99;
    sh(f.src, 'git checkout -q -B busy main');
    f.commit(f.src, 'crates/busy.rs');
    sh(f.src, 'git checkout -q main');
    expect(await land(f.deps, { ...OPTS, ref: 'busy' }, f.config({ loadWaitMaxSeconds: 10 }))).toBe(
      EXIT.busy,
    );
    // lock held by a live process: times out as busy
    const m = memoryLock();
    m.files.set('/l', {
      text: JSON.stringify({
        pid: 100,
        bootId: 'boot1',
        startedAt: new Date(f.clock.t).toISOString(),
        repo: '/o',
        ref: 'r',
        user: 'u',
      }),
      at: 0,
    });
    f.deps.lock = m.deps;
    f.deps.loadavg = () => 1;
    expect(await land(f.deps, { ...OPTS, ref: 'busy' }, f.config({ lockWaitMaxSeconds: 10 }))).toBe(
      EXIT.busy,
    );
    expect(f.errors.join('\n')).toMatch(/gave up waiting for the landing lock held by pid 100/);
  });
});

function readdirSync(dir: string): string[] {
  return execFileSync('ls', [dir], { encoding: 'utf8' }).split('\n').filter(Boolean);
}
