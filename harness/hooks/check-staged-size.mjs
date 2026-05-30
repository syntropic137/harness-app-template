#!/usr/bin/env node
// Pre-commit guardrail: block accidentally-committing very large files.
//
// Designed for cases where an agent inadvertently stages a binary (compiled
// artifact, dataset, model weights, video, etc.) that doesn't belong in git.
// Cross-platform Node replacement for the original POSIX shell script.
//
// Thresholds (override via env):
//   HARNESS_MAX_FILE_KB   — single-file hard cap (default 1024 = 1MB)
//   HARNESS_WARN_FILE_KB  — warn at this size (default 256 KB)
//   HARNESS_MAX_TOTAL_KB  — total staged bytes cap (default 5120 = 5MB)
//
// Bypass for a legitimate large commit:
//   HARNESS_SIZE_GUARDRAIL_BYPASS=1 git commit ...
//
// Hook wiring: see lefthook.yml `pre-commit > check-staged-size`.

import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_FILE_KB = Number(process.env.HARNESS_MAX_FILE_KB ?? 1024);
const WARN_FILE_KB = Number(process.env.HARNESS_WARN_FILE_KB ?? 256);
const MAX_TOTAL_KB = Number(process.env.HARNESS_MAX_TOTAL_KB ?? 5120);

// Hardcoded skip list for build-output / cache directories that should never
// be size-policed even if they slip into the index (e.g., when a scaffold
// is missing its .gitignore). Belt-and-suspenders complement to
// `.gitignore`: ensures the hook is robust on a fresh scaffold before the
// gitignore lands. Captured as E-11 in experiments/2026-05-17--e11-e12-ignore-configs/.
const SKIP_PATH_SEGMENTS = [
  'target/',
  'node_modules/',
  '.venv/',
  'dist/',
  'build/',
  'coverage/',
  '.pytest_cache/',
  '__pycache__/',
  '.ruff_cache/',
  '.harness/',
];

export function shouldSkip(path) {
  for (const seg of SKIP_PATH_SEGMENTS) {
    if (path.includes(seg)) return true;
  }
  return false;
}

function main() {
  if (process.env.HARNESS_SIZE_GUARDRAIL_BYPASS === '1') {
    console.log('[size-guardrail] BYPASSED via HARNESS_SIZE_GUARDRAIL_BYPASS=1');
    process.exit(0);
  }

  let stagedRaw;
  try {
    stagedRaw = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=AM'], {
      encoding: 'utf8',
    });
  } catch (err) {
    console.error(`[size-guardrail] git diff failed: ${err.message}`);
    process.exit(1);
  }

  const staged = stagedRaw.split('\n').filter((s) => s.length > 0);
  if (staged.length === 0) process.exit(0);

  let totalKb = 0;
  let errors = 0;
  let warnings = 0;

  let skipped = 0;
  for (const file of staged) {
    if (shouldSkip(file)) {
      skipped += 1;
      continue;
    }
    let sizeBytes;
    try {
      sizeBytes = statSync(file).size;
    } catch {
      // File may have been deleted or moved between staging and now — skip.
      continue;
    }
    const sizeKb = Math.ceil(sizeBytes / 1024);
    totalKb += sizeKb;
    if (sizeKb > MAX_FILE_KB) {
      console.error(
        `[size-guardrail] FAIL ${file} is ${sizeKb} KB (limit ${MAX_FILE_KB} KB per file)`,
      );
      errors += 1;
    } else if (sizeKb > WARN_FILE_KB) {
      console.error(`[size-guardrail] WARN ${file} is ${sizeKb} KB (over warn ${WARN_FILE_KB} KB)`);
      warnings += 1;
    }
  }

  if (totalKb > MAX_TOTAL_KB) {
    console.error(
      `[size-guardrail] FAIL total staged size is ${totalKb} KB (limit ${MAX_TOTAL_KB} KB)`,
    );
    errors += 1;
  }

  if (errors > 0) {
    console.error('');
    console.error(
      '[size-guardrail] Commit blocked. To override (only for legitimate large files):',
    );
    console.error('[size-guardrail]   HARNESS_SIZE_GUARDRAIL_BYPASS=1 git commit ...');
    console.error('[size-guardrail] But first check: do you really need to commit this? Consider');
    console.error('[size-guardrail] git-lfs, external storage, or compressing the artifact.');
    process.exit(1);
  }

  if (warnings > 0) {
    console.error(
      `[size-guardrail] ${warnings} warning(s); commit allowed but consider whether file belongs in git.`,
    );
  }
  if (skipped > 0) {
    console.error(
      `[size-guardrail] ${skipped} path(s) skipped (build-output / cache dirs). Consider adding to .gitignore.`,
    );
  }
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
