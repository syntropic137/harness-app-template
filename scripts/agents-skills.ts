import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMainEntry } from './lib/entrypoint';

// Generated-block sync for the AGENTS.md skill inventory (bead
// create-harness-app-64l). The list between the markers below is derived
// from .claude/skills/*/SKILL.md frontmatter so the advertised set can
// never drift from the shipped set. `--write` regenerates the block;
// `--check` (the default, wired into lefthook pre-commit and the CI
// `scripts` job) fails when the block is stale.

export const BEGIN_MARKER = '<!-- agents-skills:begin -->';
export const END_MARKER = '<!-- agents-skills:end -->';
export const DEFAULT_SKILLS_DIR = '.claude/skills';
export const DEFAULT_AGENTS_MD = 'AGENTS.md';

export interface SkillEntry {
  name: string;
  description: string;
}

export interface SkillDiscovery {
  skills: SkillEntry[];
  issues: string[];
}

export interface AgentsSkillsOptions {
  mode: 'check' | 'write';
  skillsDir: string;
  agentsMd: string;
}

export interface AgentsSkillsDeps {
  listDirNames: (dir: string) => string[];
  readText: (path: string) => string;
  writeText: (path: string, content: string) => void;
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

// This parser is deliberately line-based instead of a YAML dependency, so
// multiline values (block scalars and indented plain-scalar continuations)
// are rejected explicitly rather than silently truncated to their first line.
const YAML_BLOCK_SCALARS = new Set(['|', '|-', '|+', '>', '>-', '>+']);

export interface ParsedFrontmatter extends Partial<SkillEntry> {
  problems: string[];
}

function readSingleLineScalar(
  lines: string[],
  index: number,
  key: 'name' | 'description',
  parsed: ParsedFrontmatter,
): void {
  const raw = lines[index].slice(`${key}:`.length).trim();
  if (raw === '' || YAML_BLOCK_SCALARS.has(raw)) {
    parsed.problems.push(
      `frontmatter ${key} must be a single-line value (empty and block-scalar YAML values are not supported)`,
    );
    return;
  }
  const next = lines[index + 1];
  if (next !== undefined && /^[ \t]+\S/.test(next)) {
    parsed.problems.push(
      `frontmatter ${key} continues onto an indented line (multiline YAML values are not supported)`,
    );
    return;
  }
  parsed[key] = unquote(raw);
}

export function parseSkillFrontmatter(content: string): ParsedFrontmatter {
  const parsed: ParsedFrontmatter = { problems: [] };
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) {
    return parsed;
  }
  const lines = frontmatter[1].split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('name:')) {
      readSingleLineScalar(lines, i, 'name', parsed);
    } else if (lines[i].startsWith('description:')) {
      readSingleLineScalar(lines, i, 'description', parsed);
    }
  }
  return parsed;
}

export function discoverSkills(
  skillsDir: string,
  deps: Pick<AgentsSkillsDeps, 'listDirNames' | 'readText'>,
): SkillDiscovery {
  const skills: SkillEntry[] = [];
  const issues: string[] = [];
  for (const dirName of [...deps.listDirNames(skillsDir)].sort()) {
    const skillPath = join(skillsDir, dirName, 'SKILL.md');
    let content: string;
    try {
      content = deps.readText(skillPath);
    } catch {
      issues.push(`${dirName}: missing SKILL.md`);
      continue;
    }
    const entry = parseSkillFrontmatter(content);
    if (entry.problems.length > 0) {
      for (const problem of entry.problems) {
        issues.push(`${dirName}: ${problem}`);
      }
      continue;
    }
    if (entry.name === undefined || entry.description === undefined) {
      issues.push(`${dirName}: SKILL.md frontmatter must declare name and description`);
      continue;
    }
    if (entry.name !== dirName) {
      issues.push(`${dirName}: frontmatter name is ${entry.name}, expected ${dirName}`);
      continue;
    }
    skills.push({ name: entry.name, description: entry.description });
  }
  return { skills, issues };
}

export function renderSkillsList(skills: SkillEntry[]): string {
  return skills.map((skill) => `- **\`${skill.name}\`**: ${skill.description}`).join('\n');
}

export function replaceGeneratedBlock(document: string, body: string): string {
  const begin = document.indexOf(BEGIN_MARKER);
  const end = document.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `AGENTS.md must contain the markers ${BEGIN_MARKER} and ${END_MARKER}, in that order`,
    );
  }
  const head = document.slice(0, begin + BEGIN_MARKER.length);
  const tail = document.slice(end);
  return `${head}\n${body}\n${tail}`;
}

function requirePathValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a path value (usage: ${flag} <path>)`);
  }
  return value;
}

export function parseArgs(argv: string[]): AgentsSkillsOptions {
  const options: AgentsSkillsOptions = {
    mode: 'check',
    skillsDir: DEFAULT_SKILLS_DIR,
    agentsMd: DEFAULT_AGENTS_MD,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write') {
      options.mode = 'write';
    } else if (arg === '--check') {
      options.mode = 'check';
    } else if (arg === '--skills-dir') {
      options.skillsDir = requirePathValue(argv, i, '--skills-dir');
      i += 1;
    } else if (arg === '--agents-md') {
      options.agentsMd = requirePathValue(argv, i, '--agents-md');
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

export function runAgentsSkills(options: AgentsSkillsOptions, deps: AgentsSkillsDeps): number {
  const { skills, issues } = discoverSkills(options.skillsDir, deps);
  if (issues.length > 0) {
    for (const issue of issues) {
      deps.stderr.error(`agents skills: ${issue}`);
    }
    return 1;
  }
  const document = deps.readText(options.agentsMd);
  const updated = replaceGeneratedBlock(document, renderSkillsList(skills));
  if (updated === document) {
    deps.stdout.log(`agents skills: ${options.agentsMd} in sync (${skills.length} skills)`);
    return 0;
  }
  if (options.mode === 'write') {
    deps.writeText(options.agentsMd, updated);
    deps.stdout.log(`agents skills: ${options.agentsMd} updated (${skills.length} skills)`);
    return 0;
  }
  deps.stderr.error(
    `agents skills: ${options.agentsMd} skill list is stale; run \`just agents skills --write\``,
  );
  return 1;
}

/* v8 ignore start */
if (isMainEntry(import.meta.url)) {
  try {
    const code = runAgentsSkills(parseArgs(process.argv.slice(2)), {
      listDirNames: (dir) =>
        readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name),
      readText: (path) => readFileSync(path, 'utf8'),
      writeText: (path, content) => writeFileSync(path, content),
      stdout: console,
      stderr: console,
    });
    process.exit(code);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
/* v8 ignore stop */
