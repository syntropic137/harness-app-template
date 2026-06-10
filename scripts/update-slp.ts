import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SLP_SOURCE_PATH = '.claude/skills/slp-source.json';
const SKILLS_DIR = '.claude/skills';
const HELP_ARGS = new Set(['--help', '-h', 'help']);
const USAGE = [
  'Usage: just update-slp [<ref>]',
  '',
  'Re-clones software-leverage-points at <ref> (default: main), re-copies the',
  'vendored skill directories listed in .claude/skills/slp-source.json, updates',
  'the pinned commit SHA and date, and prints the changed files.',
].join('\n');

interface SlpSource {
  $comment?: string;
  upstream: string;
  commit: string;
  vendoredOn: string;
  sourcePath: string;
  skills: string[];
}

function readSource(repoRoot: string): SlpSource {
  const text = readFileSync(join(repoRoot, SLP_SOURCE_PATH), 'utf8');
  return JSON.parse(text) as SlpSource;
}

function writeSource(repoRoot: string, source: SlpSource): void {
  const path = join(repoRoot, SLP_SOURCE_PATH);
  writeFileSync(path, `${JSON.stringify(source, null, 2)}\n`);
}

function cloneUpstream(upstream: string, ref: string): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), 'slp-vendor-'));
  execFileSync('git', ['clone', '--quiet', upstream, dir], { stdio: ['ignore', 'inherit', 'inherit'] });
  execFileSync('git', ['-C', dir, 'fetch', '--quiet', 'origin', ref], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  execFileSync('git', ['-C', dir, 'checkout', '--quiet', ref], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return { dir, sha };
}

function copySkills(srcDir: string, source: SlpSource, repoRoot: string): void {
  for (const skill of source.skills) {
    const src = join(srcDir, source.sourcePath, skill);
    const dst = join(repoRoot, SKILLS_DIR, skill);
    rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
  }
}

function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function changedFiles(repoRoot: string): string {
  const result = spawnSync('git', ['status', '--short', '--', SKILLS_DIR, SLP_SOURCE_PATH], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return (result.stdout ?? '').trimEnd();
}

export interface UpdateOptions {
  repoRoot?: string;
  ref?: string;
  now?: Date;
}

export function updateSlp(options: UpdateOptions = {}): { sha: string; changed: string } {
  const repoRoot = options.repoRoot ?? process.cwd();
  const ref = options.ref ?? 'main';
  const source = readSource(repoRoot);

  const { dir, sha } = cloneUpstream(source.upstream, ref);
  try {
    copySkills(dir, source, repoRoot);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const next: SlpSource = {
    ...source,
    commit: sha,
    vendoredOn: todayIso(options.now),
  };
  writeSource(repoRoot, next);

  const changed = changedFiles(repoRoot);
  return { sha, changed };
}

export function main(argv: string[]): void {
  const positional = argv.filter((a) => a !== '--');
  const first = positional[0];

  if (first && HELP_ARGS.has(first)) {
    console.log(USAGE);
    return;
  }

  const ref = first ?? 'main';
  const result = updateSlp({ ref, repoRoot: resolve(process.cwd()) });

  console.log(`pinned to ${result.sha}`);
  if (result.changed.length === 0) {
    console.log('no changes');
    return;
  }
  console.log('changed files:');
  console.log(result.changed);
}

/* v8 ignore start */
function isEntrypoint(metaUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return fileURLToPath(metaUrl) === argv1;
  }
}

if (isEntrypoint(import.meta.url)) {
  main(process.argv.slice(2));
}
/* v8 ignore stop */
