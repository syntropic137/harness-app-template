// Shared helpers for the inspector evidence-capture scripts.
//
// Everything here is dependency-injected so the scripts stay 100% unit
// coverable without a real browser, ffmpeg binary, or stack checkout.

import { execFileSync } from 'node:child_process';
import { readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv = process.argv.slice(2)) {
  return Object.fromEntries(
    argv.map((a) => {
      const [k, ...v] = a.replace(/^--/, '').split('=');
      return [k, v.join('=')];
    }),
  );
}

// The stack-manager slot owns worktree isolation; its `inspect` command
// prints the per-worktree iso key. Must run from the repo root (the same
// assumption every inspector script already makes for artifact paths).
export function detectIsoKey(execFileSyncImpl = execFileSync) {
  try {
    const out = execFileSyncImpl('harness/stack/bin/stack', ['inspect'], {
      encoding: 'utf8',
    });
    const line = out.split('\n').find((l) => l.startsWith('Iso key:'));
    return line?.split(/\s+/)[2] ?? null;
  } catch {
    return null;
  }
}

// ffmpeg lookup order: HARNESS_FFMPEG override, system PATH, then the
// ffmpeg bundle Playwright installs alongside its browsers (so a box with
// `playwright install` but no system ffmpeg still works). Returns null
// when nothing is available; callers degrade per capability.
export function resolveFfmpeg(
  deps = {
    env: process.env,
    execFileSync,
    homedir,
    readdirSync,
  },
) {
  if (deps.env.HARNESS_FFMPEG) return deps.env.HARNESS_FFMPEG;
  try {
    deps.execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    // fall through to the Playwright bundle
  }
  const home = deps.homedir();
  const cacheRoots = [
    deps.env.PLAYWRIGHT_BROWSERS_PATH,
    join(home, '.cache', 'ms-playwright'),
    join(home, 'Library', 'Caches', 'ms-playwright'),
  ].filter(Boolean);
  for (const root of cacheRoots) {
    let entries;
    try {
      entries = deps.readdirSync(root);
    } catch {
      continue;
    }
    const bundle = entries.find((e) => e.startsWith('ffmpeg-'));
    if (!bundle) continue;
    let binaries;
    try {
      binaries = deps.readdirSync(join(root, bundle));
    } catch {
      continue;
    }
    const binary = binaries.find((b) => b.startsWith('ffmpeg'));
    if (binary) return join(root, bundle, binary);
  }
  return null;
}

// Canonicalized entrypoint check: run main() only when the module is the
// executed script. Survives symlinked checkouts and paths with spaces
// (import.meta.url percent-encodes them while process.argv[1] stays raw).
// Mirrors scripts/lib/entrypoint.ts; see PR #46.
export function isScriptEntry(importMetaUrl, argv1 = process.argv[1], realpath = realpathSync) {
  if (!argv1) return false;
  try {
    return realpath(fileURLToPath(importMetaUrl)) === realpath(argv1);
  } catch {
    return false;
  }
}
