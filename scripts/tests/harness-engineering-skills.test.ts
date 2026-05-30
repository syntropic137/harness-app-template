import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  expectedHarnessEngineeringSkills,
  parseArgs,
  parseSkillName,
  runSkillReachabilityCheck,
  upstreamHarnessEngineeringRepo,
  validateHarnessEngineeringSkills,
} from '../harness-engineering-skills';

const remoteHead = '0885300d8cc81662e84ac06c252c1cbf42989c8a\tHEAD\n';

function skillFiles(root: string): Record<string, string> {
  return Object.fromEntries(
    expectedHarnessEngineeringSkills.map((skill) => [
      `${root}/${skill.name}/SKILL.md`,
      `---\nname: ${skill.name}\ndescription: ${skill.role}\n---\n\n# ${skill.name}\n`,
    ]),
  );
}

function deps(files: Record<string, string>, failingCommands = new Set<string>()) {
  const logs: string[] = [];
  const errors: string[] = [];
  const removed: string[] = [];
  const spawn = vi.fn((command: string, args: string[]) => {
    const key = `${command} ${args[0]}`;
    if (failingCommands.has(key)) {
      return { status: 1, stdout: '', stderr: `${key} failed\n` };
    }
    return { status: 0, stdout: remoteHead, stderr: '' };
  });
  return {
    deps: {
      spawn: spawn as never,
      exists: (path: string) => path in files,
      readText: (path: string) => {
        const text = files[path];
        if (text === undefined) {
          throw new Error(`missing ${path}`);
        }
        return text;
      },
      mkdtemp: () => '/tmp/fresh-harness',
      removeTree: (path: string) => removed.push(path),
      stdout: { log: (message: string) => logs.push(message) },
      stderr: { error: (message: string) => errors.push(message) },
    },
    logs,
    errors,
    removed,
    spawn,
  };
}

describe('harness-engineering skill reachability', () => {
  test('parses skill names from frontmatter', () => {
    expect(parseSkillName('---\nname: telemetry-query\n---\n')).toBe('telemetry-query');
    expect(parseSkillName('# no frontmatter')).toBeUndefined();
    expect(parseSkillName('---\ndescription: missing name\n---\n')).toBeUndefined();
  });

  test('validates the canonical 13 upstream skills', () => {
    expect(expectedHarnessEngineeringSkills.map((skill) => skill.name)).toEqual([
      'application-legibility',
      'approved-scenarios',
      'authoring-skills',
      'autonomous-validation-loop',
      'browser-legibility',
      'harness-review',
      'long-running-durability',
      'performance-gates',
      'repo-knowledge-map',
      'skill-testing',
      'telemetry-pipeline',
      'telemetry-query',
      'worktree-isolation',
    ]);
    expect(
      validateHarnessEngineeringSkills(
        '/skills',
        (path) => path in skillFiles('/skills'),
        (path) => skillFiles('/skills')[path],
      ),
    ).toEqual([]);
  });

  test('validates real skill files with default filesystem readers', () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-skills-test-'));
    try {
      for (const skill of expectedHarnessEngineeringSkills) {
        const skillDir = join(root, skill.name);
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(
          join(skillDir, 'SKILL.md'),
          `---\nname: ${skill.name}\ndescription: ${skill.role}\n---\n`,
        );
      }
      expect(validateHarnessEngineeringSkills(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reports missing or mismatched skill files', () => {
    const files = skillFiles('/skills');
    delete files['/skills/telemetry-query/SKILL.md'];
    files['/skills/browser-legibility/SKILL.md'] = '---\nname: wrong\n---\n';
    files['/skills/harness-review/SKILL.md'] = '# missing frontmatter\n';
    expect(
      validateHarnessEngineeringSkills(
        '/skills',
        (path) => path in files,
        (path) => files[path],
      ),
    ).toEqual([
      'browser-legibility/SKILL.md frontmatter name is wrong',
      'harness-review/SKILL.md frontmatter name is (missing)',
      'missing telemetry-query/SKILL.md',
    ]);
  });

  test('parses command options', () => {
    expect(parseArgs([])).toEqual({
      freshClone: true,
      keepClone: false,
      remoteUrl: upstreamHarnessEngineeringRepo,
    });
    expect(
      parseArgs([
        '--skills-dir',
        '/local/skills',
        '--fresh-clone',
        '--keep-clone',
        '--remote-url',
        'https://example.test/repo.git',
      ]),
    ).toEqual({
      freshClone: true,
      keepClone: true,
      remoteUrl: 'https://example.test/repo.git',
      skillsDir: '/local/skills',
    });
    expect(() => parseArgs(['--wat'])).toThrow('unknown argument: --wat');
  });

  test('checks remote reachability and validates an existing skills directory', () => {
    const harness = deps(skillFiles('/skills'));
    const code = runSkillReachabilityCheck(
      {
        freshClone: false,
        keepClone: false,
        remoteUrl: upstreamHarnessEngineeringRepo,
        skillsDir: '/skills',
      },
      harness.deps,
    );
    expect(code).toBe(0);
    expect(harness.logs).toEqual([
      'harness-engineering: remote HEAD 0885300d8cc8',
      'harness-engineering: validated 13 skills from /skills',
    ]);
    expect(harness.removed).toEqual([]);
  });

  test('clones fresh by default and removes the temp checkout', () => {
    const harness = deps(skillFiles('/tmp/fresh-harness/skills'));
    const code = runSkillReachabilityCheck(
      {
        freshClone: true,
        keepClone: false,
        remoteUrl: upstreamHarnessEngineeringRepo,
      },
      harness.deps,
    );
    expect(code).toBe(0);
    expect(harness.removed).toEqual(['/tmp/fresh-harness']);
    expect(harness.spawn.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ['git', ['ls-remote', upstreamHarnessEngineeringRepo, 'HEAD']],
      ['git', ['clone', '--depth=1', upstreamHarnessEngineeringRepo, '/tmp/fresh-harness']],
    ]);
  });

  test('keeps fresh clone when requested', () => {
    const harness = deps(skillFiles('/tmp/fresh-harness/skills'));
    const code = runSkillReachabilityCheck(
      {
        freshClone: true,
        keepClone: true,
        remoteUrl: upstreamHarnessEngineeringRepo,
      },
      harness.deps,
    );
    expect(code).toBe(0);
    expect(harness.removed).toEqual([]);
  });

  test('reports remote, clone, option, and validation failures', () => {
    const remoteFail = deps({}, new Set(['git ls-remote']));
    expect(
      runSkillReachabilityCheck(
        {
          freshClone: false,
          keepClone: false,
          remoteUrl: upstreamHarnessEngineeringRepo,
          skillsDir: '/skills',
        },
        remoteFail.deps,
      ),
    ).toBe(1);
    expect(remoteFail.errors).toEqual([
      `harness-engineering: cannot reach ${upstreamHarnessEngineeringRepo}`,
      'git ls-remote failed',
    ]);

    const cloneFail = deps({}, new Set(['git clone']));
    expect(
      runSkillReachabilityCheck(
        {
          freshClone: true,
          keepClone: false,
          remoteUrl: upstreamHarnessEngineeringRepo,
        },
        cloneFail.deps,
      ),
    ).toBe(1);
    expect(cloneFail.errors).toEqual([
      `harness-engineering: fresh clone failed for ${upstreamHarnessEngineeringRepo}`,
      'git clone failed',
    ]);
    expect(cloneFail.removed).toEqual(['/tmp/fresh-harness']);

    const noDir = deps({});
    expect(
      runSkillReachabilityCheck(
        {
          freshClone: false,
          keepClone: false,
          remoteUrl: upstreamHarnessEngineeringRepo,
        },
        noDir.deps,
      ),
    ).toBe(1);
    expect(noDir.errors).toEqual([
      'harness-engineering: provide --skills-dir or use --fresh-clone',
    ]);

    const invalid = deps({});
    expect(
      runSkillReachabilityCheck(
        {
          freshClone: false,
          keepClone: false,
          remoteUrl: upstreamHarnessEngineeringRepo,
          skillsDir: '/skills',
        },
        invalid.deps,
      ),
    ).toBe(1);
    expect(invalid.errors).toContain('harness-engineering: missing telemetry-query/SKILL.md');
  });
});
