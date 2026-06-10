#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';

const DEFAULT_ARGS = ['run', 'documentation', 'validate', '.'];
const WINDOWS_EXTS = ['.exe', '.cmd', '.bat', '.com', ''];

// Guard against the fork bomb that took the box down at 2026-06-10 ~04:30Z
// (28,683 processes before the ubuntu nproc cap kicked in). Two layers of
// defence — both needed because the upstream defect is in the apss crate
// itself, not in this wrapper:
//
//   1. APSS_MJS_ACTIVE  — set on entry, errors out if seen again. Catches
//      the case where the spawn chain re-enters this wrapper (e.g. via a
//      lefthook gate, a doc-validator slot config, or any future
//      apss → script chain).
//   2. Composed-binary self-symlink check — when `.apss/bin/apss` resolves
//      (via canonicalisation) to the SAME executable that the bootstrap
//      apss CLI itself uses, spawning it re-enters the bootstrap, whose
//      `apss run` handler then re-spawns `.apss/bin/apss` for delegation
//      (apss 1.1.0 src/main.rs:200-218). Without a composed binary in
//      place, that loop only ends when the OS runs out of process slots.
//
// See commit message for the upstream-issue evidence; this wrapper is the
// safe blast-radius reduction until the upstream guard lands.
const RECURSION_GUARD_ENV = 'APSS_MJS_ACTIVE';

function dieRecursive(reason) {
  process.stderr.write(
    `scripts/apss.mjs: refusing to re-invoke; ${reason}\n` +
      `  This is the apss-wrapper recursion guard. The upstream defect is\n` +
      `  in apss 1.1.0's \`apss run\` delegation (src/main.rs:200-218): when\n` +
      `  .apss/bin/apss resolves to the bootstrap binary itself (no composed\n` +
      `  project CLI installed), each invocation re-spawns its own delegate\n` +
      `  until the OS process table is exhausted. Run \`apss install\` to\n` +
      `  build the composed project binary, or unset ${RECURSION_GUARD_ENV} if\n` +
      `  you are sure this is a legitimate re-entry.\n`,
  );
  process.exit(2);
}

function commandExistsInPath(command) {
  const isWin = process.platform === 'win32';
  const paths = (process.env.PATH || '').split(delimiter);
  const names = isWin ? WINDOWS_EXTS.map((ext) => `${command}${ext}`) : [command];
  return paths.some((dir) => names.some((name) => existsSync(resolve(dir, name))));
}

function resolveApssCommand() {
  const candidates =
    process.platform === 'win32'
      ? WINDOWS_EXTS.map((ext) => resolve(process.cwd(), `.apss/bin/apss${ext}`))
      : [resolve(process.cwd(), '.apss/bin/apss')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  if (commandExistsInPath('apss')) {
    return 'apss';
  }
  throw new Error(
    'APSS binary not found. Install APSS (cargo install apss --version 1.1.0) or ensure .apss/bin/apss exists.',
  );
}

// Returns true when `.apss/bin/apss` canonicalises to the SAME inode as the
// bootstrap apss on PATH (no separately-installed composed binary). That
// configuration is the trigger for the upstream-loop fork bomb.
function detectSelfSymlinkLoop(resolvedCommand) {
  try {
    const realResolved = realpathSync(resolvedCommand);
    // Locate the bootstrap apss the same way the bootstrap itself does.
    const paths = (process.env.PATH || '').split(delimiter);
    for (const dir of paths) {
      const candidate = resolve(dir, 'apss');
      if (existsSync(candidate)) {
        try {
          const realCandidate = realpathSync(candidate);
          if (realCandidate === realResolved) {
            return realCandidate;
          }
        } catch {
          // Ignore unreadable PATH entries.
        }
      }
    }
  } catch {
    // realpathSync can fail if the symlink points at a vanished target —
    // safe to fall through; resolveApssCommand already verified existence.
  }
  return null;
}

function main(argv) {
  if (process.env[RECURSION_GUARD_ENV] === '1') {
    dieRecursive(`${RECURSION_GUARD_ENV}=1 set by parent invocation`);
  }
  process.env[RECURSION_GUARD_ENV] = '1';

  const command = resolveApssCommand();
  const looped = detectSelfSymlinkLoop(command);
  if (looped) {
    dieRecursive(`.apss/bin/apss and the bootstrap apss both resolve to ${looped}`);
  }
  const args = argv.length ? argv : DEFAULT_ARGS;
  const proc = spawnSync(command, args, { stdio: 'inherit' });
  if (proc.error) {
    throw proc.error;
  }
  process.exit(proc.status ?? 0);
}

main(process.argv.slice(2));
