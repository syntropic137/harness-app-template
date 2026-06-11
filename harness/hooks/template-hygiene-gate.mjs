#!/usr/bin/env node
// Pre-commit gate: when a staged change touches one of the template's
// hygiene-critical surfaces (the pre-commit chain itself, the hook scripts,
// the justfile task surface, or the consumer onboarding scripts), run a fast
// structural validation so a commit can never land a chain that breaks the
// next fresh fork.
//
// Ported from the lab's pre-push template-hygiene-gate (bead
// create-harness-app-port-template-hygiene-hook-rh2). The lab variant
// scaffolds templates/polyglot-monorepo into a temp dir and smoke-tests the
// scaffolded project's bootstrap + pre-commit chain. This repo has no
// scaffolder; the repo itself IS the template that consumers fork, and the
// deep scaffold-and-smoke equivalent already exists as `just fork-check`
// (CI tier, minutes). What belongs at the pre-commit tier is the fast
// structural slice: lefthook config validity, justfile parseability, and
// syntax-checks of every hook script. Each step is sub-second, and the gate
// short-circuits in well under 100 ms when no hygiene-relevant path is
// staged.
//
// Fail-closed posture (two deliberate departures from the lab original):
//   - If git cannot report the staged path set, the gate FAILS instead of
//     treating the set as empty; an empty-on-error list would silently wave
//     a hygiene-relevant commit through.
//   - If a tool a validation step needs (pnpm, just, node) is not on PATH,
//     the gate FAILS instead of soft-skipping the step; a hygiene-relevant
//     change must not land unvalidated. Same posture as the secret-scan
//     hook, and HARNESS_HYGIENE_SKIP=1 remains the explicit escape hatch.
//
// Hook wiring: see lefthook.yml `pre-commit > template-hygiene`.
// Tests: scripts/tests/template-hygiene-gate.test.ts (vitest; this file is
// in the enforced 100 percent coverage include list in vitest.config.ts).
//
// Env overrides:
//   HARNESS_HYGIENE_SKIP=1                 - bypass the gate entirely
//   HARNESS_HYGIENE_FORCE=1                - run the gate regardless of staged paths
//   HARNESS_HYGIENE_FORCE_CHANGED_PATHS=.. - comma-separated path list to use
//                                            in place of git diff (testing)
//
// Lab provenance: harness/hooks/template-hygiene-gate.mjs in the lab repo;
// see experiments/2026-05-18--harness-dogfood-s22-template-hygiene-gate/
// there for the original hypothesis.

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Directory prefixes whose contents are hygiene-critical.
const HYGIENE_PATH_PREFIXES = ['harness/hooks/', 'scripts/lib/'];

// Exact files that are hygiene-critical. Note these are full-path matches,
// not prefixes: scripts/init.ts is in, scripts/inspector.ts is not.
const HYGIENE_FILES = [
  'lefthook.yml',
  'justfile',
  'scripts/init.ts',
  'scripts/update.ts',
  'scripts/bootstrap.ts',
];

/** Pure predicate: does any of `paths` touch a hygiene-critical surface? */
export function stagedTouchesHygieneSurface(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return false;
  for (const p of paths) {
    if (HYGIENE_FILES.includes(p)) return true;
    for (const pref of HYGIENE_PATH_PREFIXES) {
      if (p.startsWith(pref)) return true;
    }
  }
  return false;
}

/** Parse `git diff --name-only -z` output (NUL-separated). */
export function parseChangedPaths(raw) {
  if (!raw) return [];
  return raw.split('\0').filter((s) => s.length > 0);
}

/** List the hook scripts that get syntax-checked, relative to repo root. */
export function listHookScripts(hooksDir, readdir = readdirSync) {
  return readdir(hooksDir)
    .filter((name) => name.endsWith('.mjs'))
    .sort()
    .map((name) => join('harness', 'hooks', name));
}

/**
 * Resolve the staged path set. Honors the FORCE_CHANGED_PATHS test
 * override; otherwise asks git for the staged file list. Deliberately has
 * NO try/catch around the git call: a failure must propagate to the caller
 * as a gate failure (fail closed), never read as "nothing staged".
 */
export function determineChangedPaths(repoRoot, deps) {
  const forced = deps.env.HARNESS_HYGIENE_FORCE_CHANGED_PATHS;
  if (forced !== undefined) {
    return forced
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  const raw = deps.execFile('git', ['diff', '--cached', '--name-only', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return parseChangedPaths(raw);
}

/** Probe PATH for a tool by running `<cmd> --version`. */
export function commandAvailable(cmd, spawn) {
  return spawn(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
}

/** Build the ordered validation step list for one gate run. */
export function buildSteps(repoRoot, readdir = readdirSync) {
  return [
    {
      label: 'lefthook-validate',
      cmd: 'pnpm',
      args: ['exec', 'lefthook', 'validate'],
      opts: { cwd: repoRoot },
    },
    {
      label: 'justfile-parse',
      cmd: 'just',
      args: ['--list'],
      opts: { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] },
    },
    ...listHookScripts(join(repoRoot, 'harness', 'hooks'), readdir).map((script) => ({
      label: `syntax-check ${script}`,
      cmd: 'node',
      args: ['--check', script],
      opts: { cwd: repoRoot },
    })),
  ];
}

/**
 * Run one validation step. A missing tool is a failure (fail closed), not
 * a skip; see the posture note in the header.
 */
export function runStep(step, deps) {
  if (!commandAvailable(step.cmd, deps.spawn)) {
    return { ok: false, missingTool: true, ...step };
  }
  deps.log(`[hygiene] ${step.label}: ${step.cmd} ${step.args.join(' ')}`);
  const res = deps.spawn(step.cmd, step.args, { stdio: 'inherit', ...step.opts });
  if (res.status !== 0) {
    return { ok: false, missingTool: false, status: res.status, ...step };
  }
  return { ok: true };
}

/** Emit the failure block for a failed step, with a REPRO line when possible. */
export function reportFailure(failure, log) {
  log('');
  if (failure.missingTool) {
    log(`[hygiene] FAIL at step "${failure.label}": required tool "${failure.cmd}" is not on PATH`);
    log(
      '[hygiene] The gate fails closed: a change to a hygiene-critical surface must not land unvalidated.',
    );
  } else {
    log(`[hygiene] FAIL at step "${failure.label}" (exit ${failure.status})`);
    log(`[hygiene] REPRO: cd ${failure.opts.cwd} && ${failure.cmd} ${failure.args.join(' ')}`);
  }
  log('[hygiene] Bypass for emergencies: HARNESS_HYGIENE_SKIP=1 git commit ...');
}

export function main(deps) {
  const { env, log, exit } = deps;
  const t0 = deps.now();

  if (env.HARNESS_HYGIENE_SKIP === '1') {
    log('[hygiene] SKIPPED via HARNESS_HYGIENE_SKIP=1');
    return exit(0);
  }

  let repoRoot;
  let changedPaths;
  try {
    repoRoot = deps.execFile('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    changedPaths = determineChangedPaths(repoRoot, deps);
  } catch (err) {
    log(`[hygiene] FAIL: cannot determine the staged path set (${err.message})`);
    log(
      '[hygiene] Failing closed: without the staged list the gate cannot prove the commit is hygiene-irrelevant.',
    );
    return exit(1);
  }

  const relevant = env.HARNESS_HYGIENE_FORCE === '1' || stagedTouchesHygieneSurface(changedPaths);
  if (!relevant) {
    log(
      `[hygiene] skipped - no hygiene-relevant changes staged (${changedPaths.length} path(s) seen)`,
    );
    return exit(0);
  }

  log(
    `[hygiene] hygiene-relevant changes staged; structural validation (${changedPaths.length} path(s))`,
  );

  for (const step of buildSteps(repoRoot, deps.readdir)) {
    const result = runStep(step, deps);
    if (!result.ok) {
      reportFailure(result, log);
      return exit(1);
    }
  }

  const elapsedMs = deps.now() - t0;
  log(`[hygiene] OK (${(elapsedMs / 1000).toFixed(2)} s)`);
  return exit(0);
}

// Only run when invoked directly (not when imported for unit testing). The
// realpath comparison (rather than scripts/bootstrap.ts's string equality)
// matters because lefthook invokes this file by RELATIVE path, so a naive
// `file://${process.argv[1]}` never matches import.meta.url.
/* v8 ignore next 19 */
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main({
    spawn: spawnSync,
    execFile: execFileSync,
    readdir: readdirSync,
    env: process.env,
    log: (msg) => process.stderr.write(`${msg}\n`),
    exit: (code) => process.exit(code),
    now: () => Date.now(),
  });
}
