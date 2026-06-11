import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainEntry } from './lib/entrypoint';
import { git, shortSha } from './lib/git';

/**
 * Consumer self-update: pulls harness-owned surfaces from the
 * standalone canonical-template repo (`syntropic137/harness-app-template`),
 * leaving consumer code (`ws_apps/`, `ws_packages/`) byte-for-byte untouched.
 *
 * **There is no lab upstream.** The lab is R&D only; the canonical
 * template is a standalone repo that was extracted from the lab once
 * and then evolves on its own. See `docs/adrs/ADR-0015-cha-sync-source-of-truth.md`.
 *
 * Mechanic: `git fetch upstream <ref>` then `git checkout upstream/<ref> --
 * <harness-paths>` (path-scoped — NEVER `git merge upstream/<ref>`, which
 * would clobber consumer code).
 */

export interface UpdateOptions {
  cwd?: string;
  check?: boolean;
  force?: boolean;
  strategy?: 'merge' | 'preview';
}

/**
 * Paths owned by the canonical template. `just update` overwrites these
 * with `upstream/<ref>` contents (path-scoped). Everything not on this
 * list is consumer-owned and never touched.
 *
 * The list is intentionally explicit and narrow. Consumer-owned roots
 * (`ws_apps/`, `ws_packages/`, `apps/`, `packages/`, `docs/journal/`,
 * `experiments/`, `runs/`) are NOT here.
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

function existingHarnessPathsAt(cwd: string, ref: string): string[] {
  const tree = git(['ls-tree', '-r', '--name-only', ref], { cwd });
  const files = new Set(tree.split('\n').filter(Boolean));
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      dirs.add(`${parts.slice(0, index).join('/')}/`);
    }
  }
  return HARNESS_OWNED_PATHS.filter((path) => files.has(path) || dirs.has(path));
}

function dirtyHarnessPaths(cwd: string): string[] {
  return git(['status', '--porcelain', '--', ...HARNESS_OWNED_PATHS], { cwd })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3));
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
    ['log', '--oneline', '--no-decorate', '-n', '10', `${base}..${target}`, '--', ...HARNESS_OWNED_PATHS],
    { cwd, allowFailure: true },
  );
  return log.split('\n').filter(Boolean).map((line) => `- ${line}`);
}

export function updateProject(options: UpdateOptions = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const strategy = options.strategy ?? (process.stdout.isTTY ? 'merge' : 'preview');
  const ref = upstreamRef(cwd);
  const target = `upstream/${ref}`;

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
    throw new Error(`dirty harness-owned paths would be overwritten:\n${dirty.map((path) => `  ${path}`).join('\n')}`);
  }

  git(['fetch', 'upstream', ref], { cwd });
  const templateBase = git(['merge-base', 'HEAD', target], { cwd });
  const upstreamSha = git(['rev-parse', target], { cwd });

  if (templateBase === upstreamSha) {
    return `already up to date with upstream ${shortSha(upstreamSha)} (${ref})`;
  }

  const commitCount = git(['rev-list', '--count', `${templateBase}..${target}`], { cwd });
  const localHarnessChanges = git(['diff', '--name-only', `${templateBase}..HEAD`, '--', ...HARNESS_OWNED_PATHS], {
    cwd,
    allowFailure: true,
  })
    .split('\n')
    .filter(Boolean);
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

  if (options.check) {
    throw new Error(summaryLines.join('\n'));
  }
  if (strategy === 'preview') {
    return `${summaryLines.join('\n')}\njust update: preview only (no TTY detected). rerun with\n  \`just update -- --strategy=merge\` to apply harness updates.`;
  }

  let stashed = false;
  if (dirty.length > 0 && options.force) {
    const stashOutput = git(['stash', 'push', '--include-untracked', '-m', 'just update harness-owned preimage', '--', ...dirty], {
      cwd,
    });
    stashed = !stashOutput.includes('No local changes to save');
  }

  const paths = existingHarnessPathsAt(cwd, target);
  if (paths.length === 0) {
    return 'no harness-owned paths found upstream; nothing to update';
  }
  git(['checkout', target, '--', ...paths], { cwd });
  const refreshed = git(['diff', '--name-only', '--cached'], { cwd, allowFailure: true })
    .split('\n')
    .filter(Boolean);
  if (refreshed.length === 0) {
    /* v8 ignore next 3 */
    if (stashed) {
      git(['stash', 'pop'], { cwd });
    }
    return `already up to date with upstream ${shortSha(upstreamSha)} (${ref})`;
  }
  git(['commit', '-m', `update: harness sync from upstream@${shortSha(upstreamSha)}`], { cwd });
  /* v8 ignore next 3 */
  if (stashed) {
    git(['stash', 'pop'], { cwd });
  }
  return `updated: ${refreshed.length} harness file(s) refreshed; ws_apps/ws_packages untouched`;
}

export function parseCli(argv: string[]): UpdateOptions {
  const options: UpdateOptions = {};
  for (const arg of argv) {
    if (arg === '--help') {
      console.log('usage: bun run scripts/update.ts [--check] [--strategy=preview|merge] [--force]');
      process.exit(0);
    } else if (arg === '--check') {
      options.check = true;
    } else if (arg === '--write') {
      options.strategy = 'merge';
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg.startsWith('--strategy=')) {
      const strategy = arg.slice('--strategy='.length);
      if (strategy !== 'merge' && strategy !== 'preview') {
        throw new Error('--strategy must be merge or preview');
      }
      options.strategy = strategy;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
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
