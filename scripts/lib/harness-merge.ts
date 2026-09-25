import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { git, withoutLocalGitEnv } from './git';

/**
 * Per-file three-way merge planner for `just update`.
 *
 * For every harness-owned path present in base, HEAD ("ours") or upstream
 * ("theirs"), decide what the update does with it:
 *
 *   in-sync       ours same as theirs                 -> nothing to do
 *   fast-forward  ours same as base (unchanged here)  -> take upstream (incl. adds/deletes)
 *   keep-local    theirs same as base                 -> keep ours
 *   merge-clean   both changed, text merge clean      -> write merged result
 *   conflict      both changed, text merge conflicts,
 *                 binary/symlink changed on both sides,
 *                 or deleted upstream + modified locally
 *   kept-deleted  deleted locally, changed upstream   -> stays deleted (reported)
 *
 * Blob identity is `mode + oid`, so a mode-only change counts as a change.
 */

export type MergeCategory =
  | 'in-sync'
  | 'fast-forward'
  | 'keep-local'
  | 'merge-clean'
  | 'conflict'
  | 'kept-deleted';

export interface FilePlan {
  path: string;
  category: MergeCategory;
  /** Present on conflicts: why the file could not be merged automatically. */
  reason?: string;
  /** Upstream has no such file (taking upstream means delete). */
  theirsDeleted?: boolean;
  /** Merged content to write (merge-clean, and text conflicts with markers). */
  merged?: Buffer;
}

export interface MergeRefs {
  base: string;
  ours: string;
  theirs: string;
  /** Label used for the upstream side of conflict markers, e.g. `upstream/main`. */
  theirsLabel: string;
}

interface Entry {
  mode: string;
  oid: string;
}

const SYMLINK_MODE = '120000';
const BINARY_SNIFF_BYTES = 8000;

export function listTree(cwd: string, ref: string, paths: string[]): Map<string, Entry> {
  const raw = git(['ls-tree', '-r', '-z', '--full-tree', ref, '--', ...paths], { cwd });
  const entries = new Map<string, Entry>();
  for (const record of raw.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, , oid] = record.slice(0, tab).split(' ');
    entries.set(record.slice(tab + 1), { mode, oid });
  }
  return entries;
}

function same(a: Entry | undefined, b: Entry | undefined): boolean {
  return a?.mode === b?.mode && a?.oid === b?.oid;
}

export function readBlob(cwd: string, oid: string): Buffer {
  return execFileSync('git', ['cat-file', 'blob', oid], { cwd, env: withoutLocalGitEnv() });
}

/** git's own heuristic: a NUL byte in the first 8000 bytes means binary. */
export function isBinary(content: Buffer): boolean {
  return content.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

interface Sides {
  base?: Entry;
  ours?: Entry;
  theirs?: Entry;
}

/** Categorize without reading content. `undefined` means "both changed: needs a content merge". */
export function classify(sides: Sides): Omit<FilePlan, 'path'> | undefined {
  const { base, ours, theirs } = sides;
  if (same(ours, theirs)) return { category: 'in-sync' };
  if (same(ours, base)) return { category: 'fast-forward', theirsDeleted: !theirs };
  if (same(theirs, base)) return { category: 'keep-local' };
  if (!theirs) {
    return {
      category: 'conflict',
      reason: 'deleted upstream, modified locally',
      theirsDeleted: true,
    };
  }
  if (!ours) return { category: 'kept-deleted' };
  return undefined;
}

function contentMerge(cwd: string, sides: Required<Omit<Sides, 'base'>> & Sides, refs: MergeRefs) {
  const { base, ours, theirs } = sides;
  if (ours.mode === SYMLINK_MODE || theirs.mode === SYMLINK_MODE) {
    return { category: 'conflict' as const, reason: 'symlink changed on both sides' };
  }
  const blobs = [base ? readBlob(cwd, base.oid) : Buffer.alloc(0), readBlob(cwd, ours.oid)];
  blobs.push(readBlob(cwd, theirs.oid));
  if (blobs.some(isBinary)) {
    return { category: 'conflict' as const, reason: 'binary, changed on both sides' };
  }
  const merged = mergeFile(blobs, refs);
  return merged.conflicts
    ? { category: 'conflict' as const, reason: 'both modified', merged: merged.content }
    : { category: 'merge-clean' as const, merged: merged.content };
}

/** `git merge-file -p` over [base, ours, theirs]; exit status is the conflict count. */
export function mergeFile(
  [base, ours, theirs]: Buffer[],
  refs: MergeRefs,
): { content: Buffer; conflicts: boolean } {
  const dir = mkdtempSync(join(tmpdir(), 'harness-merge-'));
  try {
    const files = ['ours', 'base', 'theirs'].map((name) => join(dir, name));
    writeFileSync(files[0], ours);
    writeFileSync(files[1], base);
    writeFileSync(files[2], theirs);
    const labels = ['-L', 'HEAD', '-L', 'template-base', '-L', refs.theirsLabel];
    const result = spawnSync('git', ['merge-file', '-p', ...labels, ...files], {
      env: withoutLocalGitEnv(),
    });
    // Defensive: merge-file exits >127 only on I/O or usage errors.
    /* v8 ignore next 3 */
    if (result.status === null || result.status > 127) {
      throw new Error(`git merge-file failed: ${String(result.stderr)}`);
    }
    return { content: result.stdout, conflicts: result.status > 0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Write merged content to a repo-relative path, refusing anything that
 * resolves outside the work tree. Paths come from `git ls-tree`, which cannot
 * hold `..` segments, so this is defence in depth, not a known hole.
 */
export function writeWorktreeFile(cwd: string, path: string, content: Buffer): void {
  const root = resolve(cwd);
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`refusing to write outside the work tree: ${path}`);
  }
  writeFileSync(target, content);
}

export function planMerge(cwd: string, refs: MergeRefs, paths: string[]): FilePlan[] {
  const trees = [refs.base, refs.ours, refs.theirs].map((ref) => listTree(cwd, ref, paths));
  const [baseTree, oursTree, theirsTree] = trees;
  const allPaths = [...new Set(trees.flatMap((tree) => [...tree.keys()]))].sort();
  return allPaths.map((path) => {
    const sides = {
      base: baseTree.get(path),
      ours: oursTree.get(path),
      theirs: theirsTree.get(path),
    };
    const decided = classify(sides);
    // classify() returns undefined only when ours and theirs both exist.
    const plan = decided ?? contentMerge(cwd, sides as Required<Sides>, refs);
    return { path, ...plan };
  });
}

export function pathsIn(plans: FilePlan[], category: MergeCategory): string[] {
  return plans.filter((plan) => plan.category === category).map((plan) => plan.path);
}

const PREVIEW_LABELS: [MergeCategory, string][] = [
  ['fast-forward', 'fast-forward (take upstream)'],
  ['keep-local', 'keep-local (unchanged upstream)'],
  ['merge-clean', 'merge-clean (both changed, merges cleanly)'],
  ['conflict', 'conflict (needs manual resolution)'],
  ['kept-deleted', 'kept-deleted (deleted locally, changed upstream)'],
];

/** Human-readable per-category listing; in-sync files are omitted. */
export function describePlan(plans: FilePlan[]): string[] {
  const lines: string[] = [];
  for (const [category, label] of PREVIEW_LABELS) {
    const matching = plans.filter((plan) => plan.category === category);
    if (matching.length === 0) continue;
    lines.push(`${label}: ${matching.length}`);
    for (const plan of matching) {
      lines.push(`  ${plan.path}${plan.reason ? ` (${plan.reason})` : ''}`);
    }
  }
  return lines;
}
