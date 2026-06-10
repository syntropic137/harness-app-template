import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
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
  note?: string;
  upstream: string;
  commit: string;
  vendoredOn: string;
  sourcePath: string;
  skills: string[];
}

type SlpSourceKey = keyof SlpSource;

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const PATH_SEPARATOR_PATTERN = /[\\/]/;
const STRING_FIELDS: SlpSourceKey[] = ['upstream', 'commit', 'vendoredOn', 'sourcePath'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationError(message: string): never {
  throw new Error(`invalid ${SLP_SOURCE_PATH}: ${message}`);
}

function requireStringField(source: Record<string, unknown>, field: SlpSourceKey): string {
  const value = source[field];
  if (typeof value !== 'string' || value.length === 0) {
    validationError(`${field} must be a non-empty string`);
  }
  return value;
}

function assertSafeSkillName(skill: string): void {
  if (skill.length === 0) {
    validationError('skills entries must be non-empty strings');
  }
  if (PATH_SEPARATOR_PATTERN.test(skill) || skill.includes('..')) {
    validationError(`skill "${skill}" must be a single safe directory name`);
  }
}

function assertSafeSourcePath(sourcePath: string): void {
  if (isAbsolute(sourcePath) || sourcePath.split(/[\\/]/).includes('..')) {
    validationError('sourcePath must be a relative path inside the upstream checkout');
  }
}

function validateSource(value: unknown): SlpSource {
  if (!isRecord(value)) {
    validationError('manifest must be a JSON object');
  }

  if ('$comment' in value && typeof value.$comment !== 'string') {
    validationError('$comment must be a string when present');
  }
  if ('note' in value && typeof value.note !== 'string') {
    validationError('note must be a string when present');
  }

  const source = Object.fromEntries(
    STRING_FIELDS.map((field) => [field, requireStringField(value, field)]),
  ) as Pick<SlpSource, (typeof STRING_FIELDS)[number]>;

  if (!FULL_SHA_PATTERN.test(source.commit)) {
    validationError('commit must be a 40-character hexadecimal SHA');
  }
  assertSafeSourcePath(source.sourcePath);

  if (!Array.isArray(value.skills) || value.skills.length === 0) {
    validationError('skills must be a non-empty string list');
  }
  const skills = value.skills.map((skill) => {
    if (typeof skill !== 'string') {
      validationError('skills entries must be non-empty strings');
    }
    assertSafeSkillName(skill);
    return skill;
  });

  return {
    ...(typeof value.$comment === 'string' ? { $comment: value.$comment } : {}),
    ...(typeof value.note === 'string' ? { note: value.note } : {}),
    ...source,
    skills,
  };
}

function readSource(repoRoot: string): SlpSource {
  const text = readFileSync(join(repoRoot, SLP_SOURCE_PATH), 'utf8');
  return validateSource(JSON.parse(text));
}

function writeSource(repoRoot: string, source: SlpSource): void {
  const path = join(repoRoot, SLP_SOURCE_PATH);
  writeFileSync(path, `${JSON.stringify(source, null, 2)}\n`);
}

function cloneUpstream(upstream: string, ref: string, dir: string): string {
  execFileSync('git', ['clone', '--quiet', upstream, dir], { stdio: ['ignore', 'inherit', 'inherit'] });
  execFileSync('git', ['-C', dir, 'fetch', '--quiet', 'origin', ref], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'FETCH_HEAD'], {
    encoding: 'utf8',
  }).trim();
  execFileSync('git', ['-C', dir, 'checkout', '--quiet', '--detach', sha], {
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return sha;
}

function isUnder(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function assertUnder(label: string, parent: string, child: string): void {
  if (!isUnder(parent, child)) {
    throw new Error(`${label} path escapes its allowed root: ${child}`);
  }
}

function existingRealPath(path: string): string | undefined {
  return existsSync(path) ? realpathSync(path) : undefined;
}

function stageSkills(srcDir: string, stagingDir: string, source: SlpSource, repoRoot: string): void {
  const upstreamRoot = realpathSync(resolve(srcDir, source.sourcePath));
  const skillsRoot = realpathSync(resolve(repoRoot, SKILLS_DIR));

  for (const skill of source.skills) {
    const src = resolve(upstreamRoot, skill);
    const srcReal = existingRealPath(src);
    if (!srcReal) {
      throw new Error(`upstream skill not found: ${skill}`);
    }
    assertUnder('source', upstreamRoot, srcReal);

    const dst = resolve(skillsRoot, skill);
    const dstReal = existingRealPath(dst);
    assertUnder('destination', skillsRoot, dstReal ?? dst);

    cpSync(srcReal, resolve(stagingDir, skill), { recursive: true });
  }
}

function replaceSkills(stagingDir: string, source: SlpSource, repoRoot: string): void {
  const skillsRoot = realpathSync(resolve(repoRoot, SKILLS_DIR));

  for (const skill of source.skills) {
    const dst = resolve(skillsRoot, skill);
    const staged = realpathSync(resolve(stagingDir, skill));
    assertUnder('destination', skillsRoot, existingRealPath(dst) ?? dst);
    rmSync(dst, { recursive: true, force: true });
    cpSync(staged, dst, { recursive: true });
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
  const dir = mkdtempSync(join(tmpdir(), 'slp-vendor-'));
  const stagingDir = join(dir, '.slp-staging');

  try {
    const sha = cloneUpstream(source.upstream, ref, dir);
    stageSkills(dir, stagingDir, source, repoRoot);
    replaceSkills(stagingDir, source, repoRoot);

    const next: SlpSource = {
      ...source,
      commit: sha,
      vendoredOn: todayIso(options.now),
    };
    writeSource(repoRoot, next);

    const changed = changedFiles(repoRoot);
    return { sha, changed };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
