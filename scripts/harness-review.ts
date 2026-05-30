import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  upstreamHarnessEngineeringSkillsUrl,
  validateHarnessEngineeringSkills,
} from './harness-engineering-skills';

export interface HarnessReviewOptions {
  dryRun: boolean;
  target: string;
  skillsDir?: string;
  subset?: string;
}

export interface HarnessReviewDeps {
  exists: (path: string) => boolean;
  homeDir: () => string;
  readText: (path: string) => string;
  spawn: (
    command: string,
    args: string[],
    options: { stdio: 'inherit' },
  ) => { status: number | null };
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
}

export function readUtf8(path: string): string {
  return readFileSync(path, 'utf8');
}

export function parseReviewArgs(argv: string[]): HarnessReviewOptions {
  const options: HarnessReviewOptions = {
    dryRun: false,
    target: '.',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--skills-dir') {
      options.skillsDir = argv[i + 1];
      i += 1;
    } else if (arg === '--subset') {
      options.subset = argv[i + 1];
      i += 1;
    } else if (arg === '--target') {
      options.target = argv[i + 1];
      i += 1;
    } else if (options.target === '.') {
      options.target = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

export function candidateSkillDirs(home: string): string[] {
  return [
    join(home, '.claude/plugins/harness-engineering/skills'),
    join(home, '.codex/harness-engineering/skills'),
    join(home, '.agents/skills/harness-engineering'),
  ];
}

export function resolveSkillsDir(
  options: HarnessReviewOptions,
  exists: (path: string) => boolean,
  home: string,
): string | undefined {
  if (options.skillsDir) {
    return options.skillsDir;
  }
  return candidateSkillDirs(home).find((path) => exists(path));
}

export function buildHarnessReviewPrompt(options: HarnessReviewOptions): string {
  const subset = options.subset ? `\nSubset: ${options.subset}.` : '';
  return [
    'Use the harness-review skill from the installed harness-engineering plugin.',
    `Target: ${options.target}.`,
    `${subset}`,
    'Run the audit through the upstream harness-engineering principle skills.',
    'Return findings first, then open questions, then residual risk.',
    'Exit with a clear non-zero failure if the requested review cannot run.',
  ].join('\n');
}

export function harnessReviewCommand(options: HarnessReviewOptions): string[] {
  return [
    '-p',
    '--verbose',
    '--permission-mode',
    'bypassPermissions',
    '--append-system-prompt-file',
    './CLAUDE.md',
    buildHarnessReviewPrompt(options),
  ];
}

export function runHarnessReview(options: HarnessReviewOptions, deps: HarnessReviewDeps): number {
  const skillsDir = resolveSkillsDir(options, deps.exists, deps.homeDir());
  if (!skillsDir) {
    deps.stderr.error(
      `harness-review: upstream harness-engineering skills not found; install from ${upstreamHarnessEngineeringSkillsUrl}`,
    );
    deps.stderr.error(
      'harness-review: expected ~/.claude/plugins/harness-engineering/skills, ~/.codex/harness-engineering/skills, ~/.agents/skills/harness-engineering, or --skills-dir',
    );
    return 2;
  }

  const skillIssues = validateHarnessEngineeringSkills(skillsDir, deps.exists, deps.readText);
  if (skillIssues.length > 0) {
    for (const issue of skillIssues) {
      deps.stderr.error(`harness-review: ${issue}`);
    }
    return 2;
  }

  const args = harnessReviewCommand(options);
  if (options.dryRun) {
    deps.stdout.log(`harness-review: claude ${args.join(' ')}`);
    return 0;
  }

  const result = deps.spawn('claude', args, { stdio: 'inherit' });
  return result.status ?? 1;
}

/* v8 ignore start */
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const code = runHarnessReview(parseReviewArgs(process.argv.slice(2)), {
      exists: existsSync,
      homeDir: homedir,
      readText: readUtf8,
      spawn: spawnSync as HarnessReviewDeps['spawn'],
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
