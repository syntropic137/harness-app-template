import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMainEntry } from './lib/entrypoint';

export const upstreamHarnessEngineeringRepo =
  'https://github.com/syntropic137/harness-engineering.git';
export const upstreamHarnessEngineeringSkillsUrl =
  'https://github.com/syntropic137/harness-engineering/tree/main/skills';

export const expectedHarnessEngineeringSkills = [
  {
    name: 'application-legibility',
    role: 'Expose runtime state, errors, causal chains, and trace context as machine-readable application surfaces.',
    templateNote: 'Use when adding real app endpoints; the bare template has only example apps.',
  },
  {
    name: 'approved-scenarios',
    role: 'Define what agents may do unilaterally versus what requires escalation.',
    templateNote:
      'Reference-only until this template grows a machine-readable approval policy file.',
  },
  {
    name: 'authoring-skills',
    role: 'Author or audit Claude skills and their routing/frontmatter shape.',
    templateNote: 'Useful immediately for project-local skill maintenance.',
  },
  {
    name: 'autonomous-validation-loop',
    role: 'Shape observe-fix-restart-rerun-diff loops with iteration budgets and structured verdicts.',
    templateNote: 'Use when a consumer adds deterministic workloads or UI journeys.',
  },
  {
    name: 'browser-legibility',
    role: 'Wire browser perception through CDP, Playwright, DOM, accessibility tree, network, console, screenshots, and video evidence.',
    templateNote: 'Complements the local Playwright and Chrome DevTools skills.',
  },
  {
    name: 'harness-review',
    role: 'Orchestrate the sibling principle skills into a parallel harness audit.',
    templateNote: 'Invoke from a top-level claude -p session after installing the plugin.',
  },
  {
    name: 'long-running-durability',
    role: 'Keep multi-hour agent tasks resumable through checkpoints, durable state, retries, and budgets.',
    templateNote: 'Reference-only until long-running task state is wired into this template.',
  },
  {
    name: 'performance-gates',
    role: 'Design startup, latency, span-duration, and journey performance budgets as mechanical gates.',
    templateNote: 'Useful now for the startup-time gate; expand as consumers add real workloads.',
  },
  {
    name: 'repo-knowledge-map',
    role: 'Keep agent-facing context small, discoverable, co-located, and mechanically drift-checked.',
    templateNote: 'Useful now; this CLAUDE.md is the repo map entry point.',
  },
  {
    name: 'skill-testing',
    role: 'Empirically test skill routing and whether a skill body earns its context cost.',
    templateNote: 'Useful for both upstream plugin and in-tree skill edits.',
  },
  {
    name: 'telemetry-pipeline',
    role: 'Shape OTLP/OpenTelemetry collection, routing, enrichment, fanout, buffering, and backend independence.',
    templateNote: 'Useful with the template observability stack; apps must still emit signal.',
  },
  {
    name: 'telemetry-query',
    role: 'Make logs, metrics, traces, schemas, and cross-signal correlation queryable by agents.',
    templateNote: 'Pairs with the local concrete observability-queries skill.',
  },
  {
    name: 'worktree-isolation',
    role: 'Separate parallel agent work by worktree, ports, databases, logs, telemetry labels, and teardown.',
    templateNote: 'Design guide only until per-task worktree wiring lands.',
  },
] as const;

export interface SkillCheckOptions {
  freshClone: boolean;
  keepClone: boolean;
  remoteUrl: string;
  skillsDir?: string;
}

export interface SkillCheckDeps {
  spawn: (
    command: string,
    args: string[],
    options: { encoding: 'utf8'; stdio: ['ignore', 'pipe', 'pipe'] },
  ) => { status: number | null; stdout: string; stderr: string };
  exists: (path: string) => boolean;
  readText: (path: string) => string;
  mkdtemp: (prefix: string) => string;
  removeTree: (path: string) => void;
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
}

export function parseSkillName(content: string): string | undefined {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) {
    return undefined;
  }
  const nameLine = frontmatter[1].split('\n').find((line) => line.startsWith('name:'));
  return nameLine?.slice('name:'.length).trim();
}

export function validateHarnessEngineeringSkills(
  skillsDir: string,
  exists: (path: string) => boolean = existsSync,
  readText: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): string[] {
  const issues: string[] = [];
  for (const skill of expectedHarnessEngineeringSkills) {
    const skillPath = join(skillsDir, skill.name, 'SKILL.md');
    if (!exists(skillPath)) {
      issues.push(`missing ${skill.name}/SKILL.md`);
      continue;
    }
    const actualName = parseSkillName(readText(skillPath));
    if (actualName !== skill.name) {
      issues.push(`${skill.name}/SKILL.md frontmatter name is ${actualName ?? '(missing)'}`);
    }
  }
  return issues;
}

// Flag -> mutation handler. Each handler applies its effect and returns the
// number of extra argv slots it consumed (0 for boolean flags, 1 for
// value-taking flags), so the loop advances uniformly.
type SkillArgHandler = (options: SkillCheckOptions, argv: string[], index: number) => number;

const skillArgHandlers: Record<string, SkillArgHandler> = {
  '--skills-dir': (options, argv, index) => {
    options.skillsDir = argv[index + 1];
    options.freshClone = false;
    return 1;
  },
  '--fresh-clone': (options) => {
    options.freshClone = true;
    return 0;
  },
  '--keep-clone': (options) => {
    options.keepClone = true;
    return 0;
  },
  '--remote-url': (options, argv, index) => {
    options.remoteUrl = argv[index + 1];
    return 1;
  },
};

export function parseArgs(argv: string[]): SkillCheckOptions {
  const options: SkillCheckOptions = {
    freshClone: true,
    keepClone: false,
    remoteUrl: upstreamHarnessEngineeringRepo,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const handler = skillArgHandlers[argv[i]];
    if (!handler) {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
    i += handler(options, argv, i);
  }
  return options;
}

// Returns the remote HEAD sha, or undefined after reporting an unreachable remote.
function resolveRemoteHead(options: SkillCheckOptions, deps: SkillCheckDeps): string | undefined {
  const remote = deps.spawn('git', ['ls-remote', options.remoteUrl, 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (remote.status !== 0) {
    deps.stderr.error(`harness-engineering: cannot reach ${options.remoteUrl}`);
    deps.stderr.error(remote.stderr.trim());
    return undefined;
  }
  return remote.stdout.trim().split(/\s+/)[0];
}

// Clones the remote into cloneRoot and returns the skills directory, or
// undefined after reporting a clone failure.
function cloneSkillsDir(
  options: SkillCheckOptions,
  deps: SkillCheckDeps,
  cloneRoot: string,
): string | undefined {
  const clone = deps.spawn('git', ['clone', '--depth=1', options.remoteUrl, cloneRoot], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (clone.status !== 0) {
    deps.stderr.error(`harness-engineering: fresh clone failed for ${options.remoteUrl}`);
    deps.stderr.error(clone.stderr.trim());
    return undefined;
  }
  return join(cloneRoot, 'skills');
}

function validateAndReport(
  skillsDir: string | undefined,
  sha: string,
  deps: SkillCheckDeps,
): number {
  if (!skillsDir) {
    deps.stderr.error('harness-engineering: provide --skills-dir or use --fresh-clone');
    return 1;
  }
  const issues = validateHarnessEngineeringSkills(skillsDir, deps.exists, deps.readText);
  if (issues.length > 0) {
    for (const issue of issues) {
      deps.stderr.error(`harness-engineering: ${issue}`);
    }
    return 1;
  }
  deps.stdout.log(`harness-engineering: remote HEAD ${sha.slice(0, 12)}`);
  deps.stdout.log(
    `harness-engineering: validated ${expectedHarnessEngineeringSkills.length} skills from ${skillsDir}`,
  );
  return 0;
}

export function runSkillReachabilityCheck(
  options: SkillCheckOptions,
  deps: SkillCheckDeps,
): number {
  const sha = resolveRemoteHead(options, deps);
  if (sha === undefined) {
    return 1;
  }

  let cloneRoot: string | undefined;
  try {
    let skillsDir = options.skillsDir;
    if (options.freshClone) {
      cloneRoot = deps.mkdtemp(join(tmpdir(), 'harness-engineering-'));
      skillsDir = cloneSkillsDir(options, deps, cloneRoot);
      if (skillsDir === undefined) {
        return 1;
      }
    }
    return validateAndReport(skillsDir, sha, deps);
  } finally {
    if (cloneRoot && !options.keepClone) {
      deps.removeTree(cloneRoot);
    }
  }
}

/* v8 ignore start */
if (isMainEntry(import.meta.url)) {
  try {
    const code = runSkillReachabilityCheck(parseArgs(process.argv.slice(2)), {
      spawn: (command, args, options) =>
        spawnSync(command, args, options) as {
          status: number | null;
          stdout: string;
          stderr: string;
        },
      exists: existsSync,
      readText: (path) => readFileSync(path, 'utf8'),
      mkdtemp: mkdtempSync,
      removeTree: (path) => rmSync(path, { recursive: true, force: true }),
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
