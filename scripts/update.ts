import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainEntry } from './lib/entrypoint';
import { git, shortSha } from './lib/git';
import {
  describePlan,
  type FilePlan,
  type MergeCategory,
  pathsIn,
  planMerge,
  writeWorktreeFile,
} from './lib/harness-merge';

/**
 * Consumer self-update: pulls harness-owned surfaces from the
 * standalone canonical-template repo (`syntropic137/harness-app-template`),
 * leaving consumer code (`ws_apps/`, `ws_packages/`) byte-for-byte untouched.
 *
 * **There is no lab upstream.** The lab is R&D only; the canonical
 * template is a standalone repo that was extracted from the lab once
 * and then evolves on its own. See `docs/adrs/ADR-0015-cha-sync-source-of-truth.md`.
 *
 * Mechanic: `git fetch upstream <ref>`, then a PER-FILE three-way merge of
 * the harness-owned paths (path-scoped; NEVER `git merge upstream/<ref>`,
 * which would drag consumer code into the merge). See
 * `scripts/lib/harness-merge.ts`. base = the upstream commit last synced to
 * (the `Harness-Upstream:` trailer of the previous sync commit), falling back
 * to `git merge-base HEAD upstream/<ref>`, or for a fresh-mode scaffold with no
 * shared history to `.harness-provenance.json` canonical_commit; ours = HEAD;
 * theirs = upstream.
 *
 *   - unchanged locally since base   -> take upstream (adds and deletes too)
 *   - unchanged upstream since base  -> keep local
 *   - changed on both sides          -> `git merge-file`; clean merges apply,
 *     conflicts leave standard markers in the working tree, nothing is
 *     committed, and the command exits non-zero naming each file
 *   - binary / symlink changed on both sides -> conflict (local copy kept)
 *   - deleted locally, changed upstream -> stays deleted, reported
 *   - deleted upstream, modified locally -> stays (yours), reported; does
 *     NOT block the rest of the update
 *
 * `--force` means "upstream wins where we could not merge": every conflict,
 * kept-deleted and kept-modified file takes the upstream side (the pre-merge wholesale
 * overwrite, now limited to the files that actually conflict). It also still
 * stashes dirty harness-owned edits before applying and pops them after.
 * With no conflicts the result is committed as
 * `update: harness sync from upstream@<sha>` plus a `Harness-Upstream:` trailer.
 */

export interface UpdateOptions {
  cwd?: string;
  check?: boolean;
  force?: boolean;
  strategy?: 'merge' | 'preview';
}

/**
 * Paths owned by the canonical template. `just update` three-way merges
 * these with `upstream/<ref>` (path-scoped); committed local customizations
 * survive unless they conflict. Everything not on this list is
 * consumer-owned and never touched.
 *
 * The list is intentionally explicit and narrow. Consumer-owned roots
 * (`ws_apps/`, `ws_packages/`, `apps/`, `packages/`, `docs/journal/`,
 * `experiments/`, `runs/`) are NOT here.
 *
 * DO NOT add `vitest.consumer.json`. That file is the deliberate
 * consumer-owned extension point for the `scripts/` TypeScript coverage gate
 * (read by `vitest.config.ts`, which IS harness-owned and updated).
 * Its absence from this list is what makes it durable across syncs.
 */
const HARNESS_OWNED_PATHS = [
  'harness/',
  '.claude/',
  'scripts/',
  'docs/standard/',
  'security.md',
  'lefthook.yml',
  'biome.jsonc',
  'turbo.json',
  'cog.toml',
  'tsconfig.base.json',
  'vitest.config.ts',
  '.gitignore',
  '.github/CODEOWNERS',
  '.github/workflows/test.yml',
  'harness.manifest.json',
];

/**
 * Resolve the upstream branch the consumer wants to track. Set via:
 *
 * ```
 * git config harness.upstreamRef <branch>
 * ```
 *
 * Defaults to `main`. Consumer-side preference — not stored in any
 * tracked file (otherwise `just update` would overwrite it).
 */
function upstreamRef(cwd: string): string {
  return git(['config', '--get', 'harness.upstreamRef'], { cwd, allowFailure: true }) || 'main';
}

function dirtyHarnessPaths(cwd: string): string[] {
  return (
    git(['status', '--porcelain', '--', ...HARNESS_OWNED_PATHS], { cwd })
      .split('\n')
      .filter(Boolean)
      // NOT trimmed: porcelain's leading status column is significant. Trimming
      // ' M path' to 'M path' made slice(3) drop the path's first character, so
      // --force stashed nothing and the checkout silently overwrote the edit.
      .map((line) => line.slice(3))
  );
}

function provenanceDirty(cwd: string): boolean {
  return git(['status', '--porcelain', '--', '.harness-provenance.json'], { cwd })
    .split('\n')
    .some(Boolean);
}

interface HarnessProvenance {
  schemaVersion: '1.0';
  canonical_repo?: string;
  canonical_commit?: string;
  forked_at?: string;
}

/**
 * Read git-native provenance. Missing file = `null` (legal — older
 * consumers may not have it). Update succeeds either way; the
 * provenance file is informational, not load-bearing on the merge
 * mechanic.
 */
function readProvenance(cwd: string): HarnessProvenance | null {
  const path = join(cwd, '.harness-provenance.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as HarnessProvenance;
  } catch {
    return null;
  }
}

/**
 * `git log --oneline <base>..<target> -- <harness-paths>` capped at 10
 * lines. Used to summarize what `--write` would apply.
 */
function commitSummary(cwd: string, base: string, target: string): string[] {
  const log = git(
    [
      'log',
      '--oneline',
      '--no-decorate',
      '-n',
      '10',
      `${base}..${target}`,
      '--',
      ...HARNESS_OWNED_PATHS,
    ],
    { cwd, allowFailure: true },
  );
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => `- ${line}`);
}

function assertUpdatable(cwd: string, options: UpdateOptions): string[] {
  if (!git(['remote', 'get-url', 'upstream'], { cwd, allowFailure: true })) {
    throw new Error(
      'no `upstream` remote configured.\nTo configure (one-time):\n  git remote add upstream https://github.com/syntropic137/harness-app-template',
    );
  }
  if (provenanceDirty(cwd)) {
    throw new Error('.harness-provenance.json is immutable after init; revert it before updating');
  }
  const dirty = dirtyHarnessPaths(cwd);
  if (dirty.length > 0 && !options.force) {
    throw new Error(
      `dirty harness-owned paths would be overwritten:\n${dirty.map((path) => `  ${path}`).join('\n')}`,
    );
  }
  return dirty;
}

/** Harness-owned paths this consumer has COMMITTED changes to since the base. */
function consumerTouchedHarnessPaths(cwd: string, templateBase: string): string[] {
  return git(['diff', '--name-only', `${templateBase}..HEAD`, '--', ...HARNESS_OWNED_PATHS], {
    cwd,
    allowFailure: true,
  })
    .split('\n')
    .filter(Boolean);
}

const SYNC_SUBJECT_PREFIX = 'update: harness sync from upstream@';
const SYNC_TRAILER = 'Harness-Upstream';

/**
 * The three-way merge base: the upstream commit this consumer last synced to.
 *
 * `git merge-base HEAD upstream` never advances, because this tool checks
 * paths out rather than merging histories. Merging against that stale base
 * re-merges every upstream change already taken, which inflates hunks and
 * produces spurious conflicts next to real local edits. So prefer the upstream
 * commit recorded by the most recent sync commit (`Harness-Upstream:` trailer,
 * or the sha in the subject of older sync commits), as long as it is an
 * ancestor of the target and a descendant of the merge base. Otherwise fall
 * back to the merge base.
 */
export function syncBase(cwd: string, templateBase: string, target: string): string {
  const log = git(
    ['log', '-1', '--fixed-strings', `--grep=${SYNC_SUBJECT_PREFIX}`, '--format=%s%n%b', 'HEAD'],
    { cwd, allowFailure: true },
  );
  const trailer = log.match(new RegExp(`^${SYNC_TRAILER}: *([0-9a-f]{7,40})`, 'm'));
  const subject = log.match(/^update: harness sync from upstream@([0-9a-f]{7,40})/);
  const recorded = trailer?.[1] ?? subject?.[1];
  if (!recorded) return templateBase;
  const candidate = git(['rev-parse', '--verify', '--quiet', `${recorded}^{commit}`], {
    cwd,
    allowFailure: true,
  });
  const isAncestor = (older: string, newer: string) =>
    git(['merge-base', older, newer], { cwd, allowFailure: true }) === older;
  if (candidate && isAncestor(candidate, target) && isAncestor(templateBase, candidate)) {
    return candidate;
  }
  return templateBase;
}

/**
 * The template commit this consumer's history started from. A `clone`-mode
 * consumer shares history with upstream, so `git merge-base` answers. A
 * `fresh`-mode consumer has its own root commit and NO shared history, so
 * merge-base exits 1; for those the recorded `.harness-provenance.json`
 * `canonical_commit` is the base when it is an upstream commit. `just init`
 * records the consumer's own HEAD there, which for a GitHub "Use this template"
 * repo is a squashed root commit with the template's exact tree, so a
 * canonical_commit that is not upstream falls back to the upstream commit
 * with the same tree.
 */
function resolveTemplateBase(cwd: string, target: string): string {
  const mergeBase = git(['merge-base', 'HEAD', target], { cwd, allowFailure: true });
  if (mergeBase) return mergeBase;
  const recorded = readProvenance(cwd)?.canonical_commit;
  const commit = recorded
    ? git(['rev-parse', '--verify', '--quiet', `${recorded}^{commit}`], {
        cwd,
        allowFailure: true,
      })
    : '';
  if (commit && git(['merge-base', commit, target], { cwd, allowFailure: true }) === commit) {
    return commit;
  }
  const sameTree = commit ? upstreamCommitWithSameTree(cwd, commit, target) : '';
  if (sameTree) return sameTree;
  throw new Error(
    [
      `no common history with ${target}, and no usable .harness-provenance.json canonical_commit`,
      recorded
        ? `  canonical_commit ${recorded} is not an ancestor of ${target}, and no ${target} commit has its tree (fetched?)`
        : '  .harness-provenance.json is missing or has no canonical_commit',
      'Record the template commit this project was scaffolded from as canonical_commit, then re-run.',
    ].join('\n'),
  );
}

/** The newest `target` commit whose tree is byte-identical to `commit`'s, or ''. */
function upstreamCommitWithSameTree(cwd: string, commit: string, target: string): string {
  const tree = git(['rev-parse', `${commit}^{tree}`], { cwd });
  for (const line of git(['log', '--format=%H %T', target], { cwd }).split('\n')) {
    const [sha, candidateTree] = line.split(' ');
    if (candidateTree === tree) return sha;
  }
  return '';
}

function buildSummaryLines(cwd: string, templateBase: string, target: string): string[] {
  const commitCount = git(['rev-list', '--count', `${templateBase}..${target}`], { cwd });
  const localHarnessChanges = consumerTouchedHarnessPaths(cwd, templateBase);
  const provenance = readProvenance(cwd);
  const provenanceLine = provenance?.canonical_commit
    ? `provenance: forked at ${shortSha(provenance.canonical_commit)} (${provenance.forked_at ?? 'unknown date'})`
    : 'provenance: not initialized (run `just init` to stamp git-native provenance)';

  const summaryLines = [
    `upstream ${target} is ${commitCount} commit(s) ahead of template base ${shortSha(templateBase)}`,
    provenanceLine,
    ...commitSummary(cwd, templateBase, target),
  ];
  if (localHarnessChanges.length > 0) {
    summaryLines.push(`local harness edits: ${localHarnessChanges.join(', ')}`);
  }
  return summaryLines;
}

function stashPreimage(cwd: string, dirty: string[], options: UpdateOptions): boolean {
  if (dirty.length === 0 || !options.force) {
    return false;
  }
  const stashOutput = git(
    [
      'stash',
      'push',
      '--include-untracked',
      '-m',
      'just update harness-owned preimage',
      '--',
      ...dirty,
    ],
    {
      cwd,
    },
  );
  return !stashOutput.includes('No local changes to save');
}

/**
 * Pop the --force pre-image stash. A conflicting pop is a FAILURE, not a
 * warning: the tree now holds conflict markers and the stash is kept, so the
 * command must exit non-zero and say how to recover.
 */
function popPreimage(cwd: string, stashed: boolean): void {
  if (!stashed) return;
  try {
    git(['stash', 'pop'], { cwd });
  } catch {
    const conflicted = git(['diff', '--name-only', '--diff-filter=U'], { cwd, allowFailure: true })
      .split('\n')
      .filter(Boolean);
    throw new Error(
      [
        'just update: the harness sync WAS committed, but restoring your uncommitted',
        'harness edits (`git stash pop`) conflicted in:',
        ...conflicted.map((path) => `  ${path}`),
        '',
        'Your edits are still in the stash (`git stash list`). To finish:',
        '  1. resolve the <<<<<<< / >>>>>>> markers in each file above',
        '  2. git restore --staged -- <path>...   (keep them as uncommitted edits)',
        '  3. git stash drop',
      ].join('\n'),
    );
  }
}

/** Categories where the merge could not decide and --force takes upstream. */
const FORCEABLE = new Set<MergeCategory>(['conflict', 'kept-deleted', 'kept-modified']);

interface ApplyResult {
  conflicts: FilePlan[];
  forced: string[];
}

type PlanAction = 'upstream' | 'write-merged' | 'conflict' | 'none';

function actionFor(plan: FilePlan, force: boolean): PlanAction {
  if (plan.category === 'fast-forward') return 'upstream';
  if (plan.category === 'merge-clean') return 'write-merged';
  if (force && FORCEABLE.has(plan.category)) return 'upstream';
  return plan.category === 'conflict' ? 'conflict' : 'none';
}

/** Clean merges are written and staged; text conflicts are written with markers, unstaged. */
function writeMerged(cwd: string, plan: FilePlan, action: PlanAction): void {
  if (!plan.merged || (action !== 'write-merged' && action !== 'conflict')) return;
  writeWorktreeFile(cwd, plan.path, plan.merged);
  if (action === 'write-merged') git(['add', '--', plan.path], { cwd });
}

/** Stage every non-conflicting outcome; write conflicts to the working tree unstaged. */
function applyPlan(cwd: string, plans: FilePlan[], target: string, force: boolean): ApplyResult {
  const actions = plans.map((plan) => ({ plan, action: actionFor(plan, force) }));
  for (const { plan, action } of actions) writeMerged(cwd, plan, action);
  const upstream = actions.filter((a) => a.action === 'upstream').map((a) => a.plan);
  const checkout = upstream.filter((plan) => !plan.theirsDeleted).map((plan) => plan.path);
  const remove = upstream.filter((plan) => plan.theirsDeleted).map((plan) => plan.path);
  if (checkout.length > 0) git(['checkout', target, '--', ...checkout], { cwd });
  if (remove.length > 0) git(['rm', '-q', '--', ...remove], { cwd });
  return {
    conflicts: actions.filter((a) => a.action === 'conflict').map((a) => a.plan),
    forced: upstream.filter((plan) => plan.category !== 'fast-forward').map((plan) => plan.path),
  };
}

function syncCommitArgs(upstreamSha: string): string[] {
  return [
    '-m',
    `${SYNC_SUBJECT_PREFIX}${shortSha(upstreamSha)}`,
    '-m',
    `${SYNC_TRAILER}: ${upstreamSha}`,
  ];
}

function conflictError(
  conflicts: FilePlan[],
  touched: string[],
  context: { target: string; upstreamSha: string },
): Error {
  const commit = syncCommitArgs(context.upstreamSha)
    .map((arg) => (arg === '-m' ? arg : `"${arg}"`))
    .join(' ');
  const paths = touched.join(' ');
  return new Error(
    [
      `just update: ${conflicts.length} harness-owned file(s) conflict; NOTHING was committed.`,
      ...conflicts.map((plan) => `  ${plan.path} (${plan.reason})`),
      '',
      'Every non-conflicting change is already staged. To finish:',
      '  1. resolve each file above: remove the <<<<<<< / ======= / >>>>>>> markers,',
      `     or take a side: \`git checkout ${context.target} -- <path>\` / \`git checkout HEAD -- <path>\``,
      '  2. git add <path>...',
      `  3. git commit ${commit} -- ${paths}`,
      '     (path-limited so nothing else you staged is swept in; the Harness-Upstream',
      '     trailer makes the next update merge from this point)',
      'Or undo this update (touches only the paths above, nothing else) with',
      `\`git restore --source=HEAD --staged --worktree -- ${paths}\``,
      'then `just update -- --write --force` (upstream wins for conflicted files only).',
    ].join('\n'),
  );
}

function outcomeLines(plans: FilePlan[], forced: string[]): string[] {
  const lines: string[] = [];
  const kept = pathsIn(plans, 'keep-local');
  const merged = pathsIn(plans, 'merge-clean');
  const keptDeleted = forced.length > 0 ? [] : pathsIn(plans, 'kept-deleted');
  const keptModified = forced.length > 0 ? [] : pathsIn(plans, 'kept-modified');
  if (kept.length > 0) lines.push(`kept local: ${kept.join(', ')}`);
  if (merged.length > 0) lines.push(`merged cleanly: ${merged.join(', ')}`);
  if (keptDeleted.length > 0) {
    lines.push(`kept deleted (changed upstream; --force restores): ${keptDeleted.join(', ')}`);
  }
  if (keptModified.length > 0) {
    lines.push(`kept yours (deleted upstream; --force deletes): ${keptModified.join(', ')}`);
  }
  if (forced.length > 0) lines.push(`--force took upstream for: ${forced.join(', ')}`);
  return lines;
}

/** Harness paths this run staged or left conflicted (what a commit or undo must cover). */
function touchedPaths(plans: FilePlan[], force: boolean): string[] {
  return plans.filter((plan) => actionFor(plan, force) !== 'none').map((plan) => plan.path);
}

function applyUpdate(
  cwd: string,
  plans: FilePlan[],
  context: { target: string; ref: string; upstreamSha: string },
  dirty: string[],
  options: UpdateOptions,
): string {
  const { ref, upstreamSha } = context;
  const force = options.force === true;
  const stashed = stashPreimage(cwd, dirty, options);
  const { conflicts, forced } = applyPlan(cwd, plans, context.target, force);
  const touched = touchedPaths(plans, force);
  if (conflicts.length > 0) {
    throw conflictError(conflicts, touched, context);
  }
  const outcome = outcomeLines(plans, forced);
  if (touched.length === 0) {
    // Nothing was applied, so the stash pops onto its own base and cannot conflict.
    if (stashed) git(['stash', 'pop'], { cwd });
    return [`already up to date with upstream ${shortSha(upstreamSha)} (${ref})`, ...outcome].join(
      '\n',
    );
  }
  // Path-limited: anything the consumer had staged elsewhere stays staged
  // and out of the sync commit.
  git(['commit', ...syncCommitArgs(upstreamSha), '--', ...touched], { cwd });
  popPreimage(cwd, stashed);
  return [
    `updated: ${touched.length} harness file(s) refreshed; ws_apps/ws_packages untouched`,
    ...outcome,
  ].join('\n');
}

export function updateProject(options: UpdateOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const strategy = options.strategy ?? (process.stdout.isTTY ? 'merge' : 'preview');
  const ref = upstreamRef(cwd);
  const target = `upstream/${ref}`;

  const dirty = assertUpdatable(cwd, options);

  git(['fetch', 'upstream', ref], { cwd });
  const templateBase = resolveTemplateBase(cwd, target);
  const upstreamSha = git(['rev-parse', target], { cwd });
  const base = syncBase(cwd, templateBase, target);

  if (templateBase === upstreamSha || base === upstreamSha) {
    return `already up to date with upstream ${shortSha(upstreamSha)} (${ref})`;
  }
  const plans = planMerge(
    cwd,
    { base, ours: 'HEAD', theirs: target, theirsLabel: target },
    HARNESS_OWNED_PATHS,
  );
  // Only when NO side has any harness path. Upstream deleting every harness
  // file is still an update, and must go through the plan like any deletion.
  if (plans.length === 0) {
    return 'no harness-owned paths found upstream; nothing to update';
  }
  const summaryLines = [...buildSummaryLines(cwd, templateBase, target), ...describePlan(plans)];

  if (options.check) {
    throw new Error(summaryLines.join('\n'));
  }
  if (strategy === 'preview') {
    return `${summaryLines.join('\n')}\njust update: preview only (no TTY detected). rerun with\n  \`just update -- --strategy=merge\` to apply harness updates.`;
  }

  return applyUpdate(cwd, plans, { target, ref, upstreamSha }, dirty, options);
}

const USAGE = `usage: bun run scripts/update.ts [--check] [--strategy=preview|merge] [--write] [--force]

  Three-way merges harness-owned paths from upstream (base = last synced upstream
  commit, falling back to \`git merge-base HEAD upstream/<ref>\`, or to
  .harness-provenance.json canonical_commit when there is no shared history):
    fast-forward   unchanged locally        -> take upstream (adds and deletes too)
    keep-local     unchanged upstream       -> keep yours
    merge-clean    changed on both sides    -> merged and committed
    conflict       overlapping edits, or binary/symlink changed on both sides
                   -> markers left in the working tree, NOTHING committed, exit 1
    kept-deleted   you deleted it, upstream changed it -> stays deleted
    kept-modified  upstream deleted it, you changed it -> stays (yours)

  --check      print the summary + per-file plan and exit non-zero if updates exist
  --strategy   preview (print the plan, change nothing) or merge (apply)
  --write      shorthand for --strategy=merge
  --force      upstream wins for every conflict, kept-deleted and kept-modified file (the pre-merge
               overwrite behaviour), and dirty harness edits are stashed and re-applied`;

const FLAG_HANDLERS: Record<string, (options: UpdateOptions) => void> = {
  '--help': () => {
    console.log(USAGE);
    process.exit(0);
  },
  '--check': (options) => {
    options.check = true;
  },
  '--write': (options) => {
    options.strategy = 'merge';
  },
  '--force': (options) => {
    options.force = true;
  },
};

function applyStrategyArg(options: UpdateOptions, arg: string): void {
  const strategy = arg.slice('--strategy='.length);
  if (strategy !== 'merge' && strategy !== 'preview') {
    throw new Error('--strategy must be merge or preview');
  }
  options.strategy = strategy;
}

function applyArg(options: UpdateOptions, arg: string): void {
  const handler = FLAG_HANDLERS[arg];
  if (handler) {
    handler(options);
    return;
  }
  if (arg.startsWith('--strategy=')) {
    applyStrategyArg(options, arg);
    return;
  }
  throw new Error(`unknown argument: ${arg}`);
}

export function parseCli(argv: string[]): UpdateOptions {
  const options: UpdateOptions = {};
  for (const arg of argv) {
    applyArg(options, arg);
  }
  return options;
}

/* v8 ignore next 8 */
if (isMainEntry(import.meta.url)) {
  try {
    console.log(updateProject(parseCli(process.argv.slice(2))));
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
