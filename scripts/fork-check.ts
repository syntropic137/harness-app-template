/**
 * fork-check: prove the template is fork-ready end-to-end.
 *
 * Simulates a fresh consumer onboarding: snapshot HEAD into an isolated
 * temp dir, run the documented `just init <name>` + `just bootstrap`
 * flow, then execute the full gate suite (qa, sensors gate, fitness,
 * optional doc-validator). If any step fails in the fresh context, the
 * template has a fork-readiness gap that the in-repo CI can never
 * catch.
 *
 * Configuration via env (no flags, keep it minimal):
 *   FORK_CHECK_NAME       project name passed to `just init` (default
 *                         "forkcheck")
 *   FORK_CHECK_KEEP       "1" preserves the temp workspace for
 *                         post-mortem
 *   FORK_CHECK_SOURCE     "head" (default; uses `git archive HEAD`) or
 *                         "worktree" (uses `git ls-files` + tar to
 *                         include uncommitted-but-tracked changes)
 *   FORK_CHECK_SKIP_DOC   "1" skips the doc-validator step (used when
 *                         apss is intentionally absent)
 *   FORK_CHECK_FITNESS    "quick" (default) or "full" — `quick` reads
 *                         the floor from baseline.json without re-
 *                         scanning; `full` runs the live pipeline.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMainEntry } from './lib/entrypoint';

const SOURCE_ROOT = process.cwd();
const PROJECT_NAME = process.env.FORK_CHECK_NAME ?? 'forkcheck';
const KEEP = process.env.FORK_CHECK_KEEP === '1';
const SOURCE_MODE = (process.env.FORK_CHECK_SOURCE ?? 'head').toLowerCase();
const SKIP_DOC = process.env.FORK_CHECK_SKIP_DOC === '1';
const FITNESS_MODE = (process.env.FORK_CHECK_FITNESS ?? 'quick').toLowerCase();

interface StepResult {
  name: string;
  ok: boolean;
  durationMs: number;
}

function which(cmd: string): boolean {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' });
  return r.status === 0;
}

function step(
  name: string,
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): StepResult {
  console.log(`\n=== fork-check: ${name} ===`);
  console.log(`$ (cwd=${cwd}) ${cmd} ${args.join(' ')}`);
  const t0 = Date.now();
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  const durationMs = Date.now() - t0;
  const ok = r.status === 0;
  console.log(`--- fork-check: ${name} ${ok ? 'OK' : 'FAIL'} (${(durationMs / 1000).toFixed(1)}s) ---`);
  if (!ok) {
    throw new Error(`step "${name}" exited ${r.status}`);
  }
  return { name, ok, durationMs };
}

function snapshot(source: string, dest: string): void {
  if (SOURCE_MODE === 'worktree') {
    // Capture tracked-and-modified state by piping `git ls-files` into
    // tar. Includes uncommitted edits to tracked files; excludes
    // untracked. Useful for dev iteration on the fork-check itself.
    spawnSync('sh', [
      '-c',
      `cd "${source}" && git ls-files -z | tar --null -T - -cf - | tar -xf - -C "${dest}"`,
    ], { stdio: 'inherit' });
  } else {
    // Default: `git archive HEAD` produces a clean snapshot of the
    // last commit — the same surface "Use this template" + clone
    // produces for a real consumer.
    spawnSync('sh', [
      '-c',
      `git -C "${source}" archive --format=tar HEAD | tar -xf - -C "${dest}"`,
    ], { stdio: 'inherit' });
  }
}

function makeFreshRepo(work: string): void {
  // init.ts reads `git rev-parse HEAD` for provenance; needs a real
  // commit. Suppress global hooks (apss managed pre-commit can hit
  // here on the VPS).
  const gitEnv = {
    GIT_AUTHOR_NAME: 'fork-check',
    GIT_AUTHOR_EMAIL: 'fork-check@local',
    GIT_COMMITTER_NAME: 'fork-check',
    GIT_COMMITTER_EMAIL: 'fork-check@local',
  };
  step('git init', 'git', ['init', '-q', '-b', 'main'], work);
  step('git stage', 'git', ['-c', 'core.hooksPath=/dev/null', 'add', '-A'], work, gitEnv);
  step(
    'git commit',
    'git',
    ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'fork-check snapshot'],
    work,
    gitEnv,
  );
}

function runDocValidator(work: string, results: StepResult[]): void {
  if (SKIP_DOC) {
    console.log('\nfork-check: doc-validator skipped (FORK_CHECK_SKIP_DOC=1)');
    return;
  }
  if (!which('apss')) {
    console.log('\nfork-check: doc-validator skipped (apss not on PATH)');
    return;
  }
  // apss install composes .apss/bin/apss from the lockfile;
  // env -u CARGO_TARGET_DIR mirrors the `just apss-install` recipe's
  // workaround for the upstream cargo-target-dir bug.
  results.push(step('apss install', 'sh', ['-c', 'env -u CARGO_TARGET_DIR apss install'], work));
  results.push(step('doc-validator', 'node', ['scripts/doc-validator.mjs', '--apss'], work));
}

function runGates(work: string, results: StepResult[]): void {
  // Documented consumer flow: `just init <name>`. We pass --no-verify
  // so bootstrap below runs pnpm/cargo/uv under one observable umbrella
  // instead of init's hidden pre-flight.
  results.push(
    step('just init', 'bun', ['run', 'scripts/init.ts', PROJECT_NAME, '--no-verify'], work),
  );
  results.push(step('just bootstrap', 'just', ['bootstrap'], work));
  // `just qa` runs typecheck + lint + test + sensors-gate + secret-scan.
  // Sensors gate exercises the APSS topology producer and the
  // architectural ratchet against the post-init tree — the canonical
  // fork-readiness pressure point.
  results.push(step('just qa', 'just', ['qa'], work));
  runDocValidator(work, results);
  const fitnessArgs = FITNESS_MODE === 'full' ? ['fitness'] : ['fitness', '--quick'];
  results.push(step(`just ${fitnessArgs.join(' ')}`, 'just', fitnessArgs, work));
}

function summarize(results: StepResult[], totalSec: string, work: string): void {
  console.log('\n=== fork-check: summary ===');
  for (const r of results) {
    const tag = r.ok ? 'OK  ' : 'FAIL';
    console.log(`  ${tag}  ${r.name}  (${(r.durationMs / 1000).toFixed(1)}s)`);
  }
  console.log(`  total: ${totalSec}s`);
  console.log(`  workspace: ${work}${KEEP ? ' (preserved)' : ' (removed)'}`);
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), 'harness-forkcheck-'));
  console.log(`fork-check: workspace = ${work}`);
  console.log(`fork-check: source    = ${SOURCE_ROOT} (mode=${SOURCE_MODE})`);
  console.log(`fork-check: project   = ${PROJECT_NAME}`);
  console.log(`fork-check: fitness   = ${FITNESS_MODE}`);
  console.log(`fork-check: skip-doc  = ${SKIP_DOC}`);

  const results: StepResult[] = [];
  let failed = false;
  const t0 = Date.now();

  try {
    snapshot(SOURCE_ROOT, work);
    if (!existsSync(join(work, 'package.json'))) {
      throw new Error('snapshot incomplete: package.json missing in workspace');
    }
    makeFreshRepo(work);
    runGates(work, results);
  } catch (e) {
    failed = true;
    console.error(`\nfork-check: FAIL — ${(e as Error).message}`);
  } finally {
    const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
    summarize(results, totalSec, work);
    if (!KEEP) {
      rmSync(work, { recursive: true, force: true });
    }
    if (failed) {
      process.exit(1);
    }
    console.log('\nfork-check: PASS — template is fork-ready');
  }
}

/* v8 ignore next 3 */
if (isMainEntry(import.meta.url)) {
  main();
}
