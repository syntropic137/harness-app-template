import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isMainEntry } from './lib/entrypoint';
import { loadConfig } from './lib/land/config';
import { globToRegExp } from './lib/land/scope';

// Pre-push guard (ADR-0033): refuse an UNGATED push that
// changes code on `main`. The authoritative gated path is `just land <ref>`
// (scripts/land.ts), which runs the diff-scoped gates in
// an isolated fresh-origin/main worktree and pushes ONLY if every gate passes. It
// marks its push with HARNESS_LAND_GATE=<the exact commit SHA it validated>.
//
// WHAT THIS IS (and is NOT): a DEFAULT-CLOSER, not an unforgeable boundary. No
// local pre-push hook can be unforgeable against someone with push access --
// `git push --no-verify` skips every hook, and any marker (env var, receipt file,
// in-repo secret) can be reproduced by a determined pusher. Real enforcement needs
// SERVER-SIDE GitHub branch protection, which the billing tier blocks here (bead
// server-side branch protection). This guard's job is narrower and still worthwhile: make the
// gated `just land` path the path of least resistance so an ungated code push to
// main takes a CONSCIOUS act (a `--no-verify`, or deliberately
// forging the SHA marker) rather than being the default.
//
// The SHA-binding earns its keep specifically by defeating the ACCIDENTAL bypass:
// an ambient/stale `HARNESS_LAND_GATE=1` left in a shell profile matches no ref,
// so it cannot silently turn the guard into a no-op for every push. (A deliberate
// per-push `HARNESS_LAND_GATE=$(git rev-parse <ref>)` still forges it -- that is
// a conscious bypass, no worse than `--no-verify`.) The guard also FAILS CLOSED
// when it gets no ref lines on stdin, so broken hook wiring can't silently disable
// it either.

export const PROTECTED_REF = 'refs/heads/main';
export const ZERO_SHA = '0000000000000000000000000000000000000000';
export const LAND_GATE_ENV = 'HARNESS_LAND_GATE';

/** Defaults; a consumer overrides all three in land.config.json (markerEnv, targetBranch, metadataSafe). */

/** Paths a direct push may change WITHOUT the gate, from land.config.json `metadataSafe` globs.
 * Deliberately empty by default: only pure operational-log locations that are NEVER build, test or
 * render inputs belong here. Anything else requires the gate or a conscious `--no-verify`. */
export const METADATA_SAFE: RegExp[] = [];

export interface PushRefLine {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

/** Parse git's pre-push stdin: one `<localRef> <localSha> <remoteRef> <remoteSha>`
 * line per ref being pushed. Malformed / blank lines are ignored. */
export function parsePushStdin(input: string): PushRefLine[] {
  const lines: PushRefLine[] = [];
  for (const raw of input.split('\n')) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length !== 4) {
      continue;
    }
    const [localRef, localSha, remoteRef, remoteSha] = parts;
    lines.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return lines;
}

export interface GuardDeps {
  /** Ref to protect; defaults to PROTECTED_REF. */
  protectedRef?: string;
  /** Paths exempt from the gate; defaults to METADATA_SAFE. */
  metadataSafe?: RegExp[];
  /** The raw HARNESS_LAND_GATE value. `just land` sets it to the exact commit SHA
   * it validated + is pushing; the guard accepts a main push only when this equals
   * the pushed ref's local SHA, so an ambient/stale `=1` proves nothing. */
  landGateSha: string | undefined;
  /** Files changed between the remote tip and the pushed commit for a main push. */
  changedFiles: (remoteSha: string, localSha: string) => string[];
}

export interface GuardResult {
  ok: boolean;
  message: string;
}

/** True when every changed path is pure metadata (or there is no net change at
 * all) — such a push carries nothing that needs the build/test gate. */
function isMetadataOnly(files: string[], safe: RegExp[]): boolean {
  return files.every((f) => safe.some((re) => re.test(f)));
}

const GUIDANCE = `Refusing an ungated push to main.

  Pushes that change CODE on main must go through the gated land flow:
      just land <branch-or-ref>
  which runs the diff-scoped gates in an isolated fresh-origin/main worktree and
  pushes ONLY if every gate passes (ADR-0033). Paths listed under \`metadataSafe\`
  in land.config.json push directly.

  Conscious escape hatches (the resulting commit lands in main's history, but the
  bypass ACT itself is not specially recorded):
    - \`git push --no-verify\`  skips ALL hooks (git limitation).
    - \`gh pr merge\`           merges server-side; ungateable locally without
                              server-side branch protection.`;

/** Decide whether a push may proceed. Pure: all IO is injected via deps. */
export function evaluatePush(refs: PushRefLine[], deps: GuardDeps): GuardResult {
  for (const ref of refs) {
    if (ref.remoteRef !== (deps.protectedRef ?? PROTECTED_REF)) {
      continue;
    }
    if (ref.localSha === ZERO_SHA) {
      return { ok: false, message: 'Refusing to delete main via push.' };
    }
    // Gated iff `just land` validated THIS exact commit (SHA-bound, not a boolean).
    if (deps.landGateSha !== undefined && deps.landGateSha === ref.localSha) {
      continue;
    }
    // A brand-new remote main (remoteSha all-zero) can't be diffed; require the gate.
    const files = ref.remoteSha === ZERO_SHA ? [] : deps.changedFiles(ref.remoteSha, ref.localSha);
    if (ref.remoteSha !== ZERO_SHA && isMetadataOnly(files, deps.metadataSafe ?? METADATA_SAFE)) {
      continue;
    }
    return { ok: false, message: GUIDANCE };
  }
  return { ok: true, message: '' };
}

/** The `git diff` args used to list every path that differs between the current
 * remote tip and the pushed commit. Space-separated endpoints (tree-to-tree), NOT
 * `remote..local`: for `git diff` the two forms are equivalent (unlike `git log`,
 * `..` is not a range here), but the explicit form removes any ambiguity and
 * guarantees a non-fast-forward / force-push of a divergent or older commit still
 * lists the files it reverts or deletes, so such a push can't slip through as
 * "no changes". */
export function changedFilesArgs(remoteSha: string, localSha: string): string[] {
  return ['diff', '--name-only', remoteSha, localSha];
}

export interface GuardIoDeps {
  stdin: string;
  env: NodeJS.ProcessEnv;
  /** Env var carrying the validated SHA; defaults to LAND_GATE_ENV. */
  markerEnv?: string;
  protectedRef?: string;
  metadataSafe?: RegExp[];
  changedFiles: (remoteSha: string, localSha: string) => string[];
  stderr: Pick<typeof console, 'error'>;
}

export function runGuard(deps: GuardIoDeps): number {
  const refs = parsePushStdin(deps.stdin);
  if (refs.length === 0) {
    // FAIL CLOSED. Git always feeds a real pre-push its ref lines on stdin; zero
    // parseable refs means stdin was absent or malformed (e.g. lefthook use_stdin
    // wiring broke). Rejecting -- rather than silently allowing -- keeps a wiring
    // regression from turning the guard into a no-op. A conscious `--no-verify`
    // still bypasses.
    deps.stderr.error(
      '✗ guard-main-push: no parseable push refs on stdin; failing closed. ' +
        'If the lefthook `use_stdin` wiring is broken, fix it; to bypass consciously use --no-verify.',
    );
    return 1;
  }
  const result = evaluatePush(refs, {
    landGateSha: deps.env[deps.markerEnv ?? LAND_GATE_ENV],
    changedFiles: deps.changedFiles,
    protectedRef: deps.protectedRef,
    metadataSafe: deps.metadataSafe,
  });
  if (result.ok) {
    return 0;
  }
  deps.stderr.error(`✗ ${result.message}`);
  return 1;
}

/* v8 ignore start */
function realChangedFiles(remoteSha: string, localSha: string): string[] {
  const result = spawnSync('git', changedFilesArgs(remoteSha, localSha), {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    // If we cannot compute the diff, fail closed: treat as a code push (require gate).
    return ['<unknown>'];
  }
  return result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

function readStdinSync(): string {
  try {
    // fd 0 is stdin; git pipes the ref lines here per the pre-push hook contract.
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

if (isMainEntry(import.meta.url)) {
  const config = loadConfig(process.cwd());
  const code = runGuard({
    stdin: readStdinSync(),
    env: process.env,
    markerEnv: config.markerEnv,
    protectedRef: `refs/heads/${config.targetBranch}`,
    metadataSafe: config.metadataSafe.map(globToRegExp),
    changedFiles: realChangedFiles,
    stderr: console,
  });
  process.exit(code);
}
/* v8 ignore stop */
