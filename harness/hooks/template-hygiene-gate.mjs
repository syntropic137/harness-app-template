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
// Hook wiring: see lefthook.yml `pre-commit > template-hygiene`.
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

function determineChangedPaths(repoRoot) {
  const force = process.env.HARNESS_HYGIENE_FORCE_CHANGED_PATHS;
  if (force !== undefined) {
    return force
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  try {
    const raw = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return parseChangedPaths(raw);
  } catch {
    return [];
  }
}

function runStep(label, cmd, args, opts, log) {
  if (spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status !== 0) {
    log(`[hygiene] warning: ${cmd} not found; skipping step "${label}"`);
    return { ok: true };
  }
  log(`[hygiene] ${label}: ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) {
    return { ok: false, label, cmd, args, cwd: opts.cwd, status: res.status };
  }
  return { ok: true };
}

function main() {
  const log = (msg) => process.stderr.write(`${msg}\n`);
  const t0 = Date.now();

  if (process.env.HARNESS_HYGIENE_SKIP === '1') {
    log('[hygiene] SKIPPED via HARNESS_HYGIENE_SKIP=1');
    process.exit(0);
  }

  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  }).trim();

  const force = process.env.HARNESS_HYGIENE_FORCE === '1';
  const changedPaths = determineChangedPaths(repoRoot);
  const relevant = force || stagedTouchesHygieneSurface(changedPaths);

  if (!relevant) {
    log(
      `[hygiene] skipped - no hygiene-relevant changes staged (${changedPaths.length} path(s) seen)`,
    );
    process.exit(0);
  }

  log(
    `[hygiene] hygiene-relevant changes staged; structural validation (${changedPaths.length} path(s))`,
  );

  const steps = [
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
    ...listHookScripts(join(repoRoot, 'harness', 'hooks')).map((script) => ({
      label: `syntax-check ${script}`,
      cmd: 'node',
      args: ['--check', script],
      opts: { cwd: repoRoot },
    })),
  ];

  for (const s of steps) {
    const r = runStep(s.label, s.cmd, s.args, s.opts, log);
    if (!r.ok) {
      log('');
      log(`[hygiene] FAIL at step "${r.label}" (exit ${r.status})`);
      log(`[hygiene] REPRO: cd ${r.cwd} && ${r.cmd} ${r.args.join(' ')}`);
      log('[hygiene] Bypass for emergencies: HARNESS_HYGIENE_SKIP=1 git commit ...');
      process.exit(1);
    }
  }

  const elapsedMs = Date.now() - t0;
  log(`[hygiene] OK (${(elapsedMs / 1000).toFixed(2)} s)`);
  process.exit(0);
}

// Only run when invoked directly (not when imported for unit testing).
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) main();
