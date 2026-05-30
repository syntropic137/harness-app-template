import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { expectedHarnessEngineeringSkills } from '../harness-engineering-skills';
import {
  buildHarnessReviewPrompt,
  candidateSkillDirs,
  harnessReviewCommand,
  parseReviewArgs,
  readUtf8,
  resolveSkillsDir,
  runHarnessReview,
} from '../harness-review';

function skillFiles(root: string): Record<string, string> {
  return Object.fromEntries(
    expectedHarnessEngineeringSkills.map((skill) => [
      `${root}/${skill.name}/SKILL.md`,
      `---\nname: ${skill.name}\ndescription: ${skill.role}\n---\n`,
    ]),
  );
}

function deps(files: Record<string, string>, status: number | null = 0) {
  const logs: string[] = [];
  const errors: string[] = [];
  const spawn = vi.fn(() => ({ status }));
  return {
    deps: {
      exists: (path: string) =>
        path in files || Object.keys(files).some((file) => file.startsWith(`${path}/`)),
      homeDir: () => '/home/tester',
      readText: (path: string) => files[path] ?? '',
      spawn,
      stdout: { log: (message: string) => logs.push(message) },
      stderr: { error: (message: string) => errors.push(message) },
    },
    errors,
    logs,
    spawn,
  };
}

describe('harness review orchestrator', () => {
  test('parses review arguments', () => {
    expect(parseReviewArgs([])).toEqual({ dryRun: false, target: '.' });
    expect(
      parseReviewArgs([
        '--dry-run',
        '--skills-dir',
        '/skills',
        '--subset',
        'telemetry-query,browser-legibility',
        '--target',
        'docs/plan.md',
      ]),
    ).toEqual({
      dryRun: true,
      skillsDir: '/skills',
      subset: 'telemetry-query,browser-legibility',
      target: 'docs/plan.md',
    });
    expect(parseReviewArgs(['docs/plan.md'])).toEqual({
      dryRun: false,
      target: 'docs/plan.md',
    });
    expect(() => parseReviewArgs(['a', 'b'])).toThrow('unknown argument: b');
  });

  test('resolves candidate skill directories', () => {
    expect(candidateSkillDirs('/home/tester')).toEqual([
      '/home/tester/.claude/plugins/harness-engineering/skills',
      '/home/tester/.codex/harness-engineering/skills',
      '/home/tester/.agents/skills/harness-engineering',
    ]);
    expect(
      resolveSkillsDir(
        { dryRun: false, skillsDir: '/explicit', target: '.' },
        () => false,
        '/home/tester',
      ),
    ).toBe('/explicit');
    expect(
      resolveSkillsDir(
        { dryRun: false, target: '.' },
        (path) => path.endsWith('/.agents/skills/harness-engineering'),
        '/home/tester',
      ),
    ).toBe('/home/tester/.agents/skills/harness-engineering');
    expect(resolveSkillsDir({ dryRun: false, target: '.' }, () => false, '/home/tester')).toBe(
      undefined,
    );
  });

  test('builds the claude harness-review command', () => {
    const options = {
      dryRun: false,
      subset: 'telemetry-query,browser-legibility',
      target: 'docs/plan.md',
    };
    expect(buildHarnessReviewPrompt({ dryRun: false, target: '.' })).not.toContain('Subset:');
    expect(buildHarnessReviewPrompt(options)).toContain(
      'Subset: telemetry-query,browser-legibility.',
    );
    expect(harnessReviewCommand(options)).toEqual([
      '-p',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
      '--append-system-prompt-file',
      './CLAUDE.md',
      buildHarnessReviewPrompt(options),
    ]);
  });

  test('runs dry-run when upstream skills validate', () => {
    const root = '/home/tester/.claude/plugins/harness-engineering/skills';
    const harness = deps(skillFiles(root));
    const code = runHarnessReview({ dryRun: true, target: '.' }, harness.deps);
    expect(code).toBe(0);
    expect(harness.logs[0]).toContain('harness-review: claude -p --verbose');
    expect(harness.spawn).not.toHaveBeenCalled();
  });

  test('runs claude and returns its exit status', () => {
    const root = '/home/tester/.claude/plugins/harness-engineering/skills';
    const harness = deps(skillFiles(root), 7);
    const code = runHarnessReview({ dryRun: false, target: 'README.md' }, harness.deps);
    expect(code).toBe(7);
    expect(harness.spawn).toHaveBeenCalledWith(
      'claude',
      harnessReviewCommand({ dryRun: false, target: 'README.md' }),
      { stdio: 'inherit' },
    );

    const signal = deps(skillFiles(root), null);
    expect(runHarnessReview({ dryRun: false, target: '.' }, signal.deps)).toBe(1);
  });

  test('reports missing or invalid upstream skills', () => {
    const missing = deps({});
    expect(runHarnessReview({ dryRun: false, target: '.' }, missing.deps)).toBe(2);
    expect(missing.errors[0]).toContain('upstream harness-engineering skills not found');

    const invalid = deps({
      '/skills/harness-review/SKILL.md': '---\nname: wrong\n---\n',
    });
    expect(
      runHarnessReview({ dryRun: false, skillsDir: '/skills', target: '.' }, invalid.deps),
    ).toBe(2);
    expect(invalid.errors).toContain('harness-review: missing telemetry-query/SKILL.md');
  });

  test('reads UTF-8 files for the CLI dependency set', () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-review-test-'));
    try {
      const path = join(root, 'sample.txt');
      writeFileSync(path, 'hello\n');
      expect(readUtf8(path)).toBe('hello\n');
      mkdirSync(join(root, 'nested'), { recursive: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
