import { describe, expect, test, vi } from 'vitest';
import type { AgentsSkillsDeps } from '../agents-skills';
import {
  BEGIN_MARKER,
  DEFAULT_AGENTS_MD,
  DEFAULT_SKILLS_DIR,
  discoverSkills,
  END_MARKER,
  parseArgs,
  parseSkillFrontmatter,
  renderSkillsList,
  replaceGeneratedBlock,
  runAgentsSkills,
} from '../agents-skills';

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
}

function agentsMdAround(block: string): string {
  return `# Agent context\n\nintro\n\n${BEGIN_MARKER}\n${block}\n${END_MARKER}\n\noutro\n`;
}

interface FixtureOptions {
  dirs?: string[];
  files?: Map<string, string>;
}

function makeDeps(options: FixtureOptions): AgentsSkillsDeps & {
  written: Map<string, string>;
  logs: string[];
  errors: string[];
} {
  const written = new Map<string, string>();
  const logs: string[] = [];
  const errors: string[] = [];
  const files = options.files ?? new Map<string, string>();
  return {
    listDirNames: () => options.dirs ?? [],
    readText: (path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return content;
    },
    writeText: (path: string, content: string) => {
      written.set(path, content);
    },
    stdout: { log: (message: string) => logs.push(message) },
    stderr: { error: (message: string) => errors.push(message) },
    written,
    logs,
    errors,
  };
}

describe('parseSkillFrontmatter', () => {
  test('parses unquoted name and description', () => {
    expect(parseSkillFrontmatter(skillMd('alpha', 'does alpha things'))).toEqual({
      name: 'alpha',
      description: 'does alpha things',
    });
  });

  test('unquotes double-quoted values', () => {
    const content = '---\nname: "alpha"\ndescription: "colon: heavy, value"\n---\nbody';
    expect(parseSkillFrontmatter(content)).toEqual({
      name: 'alpha',
      description: 'colon: heavy, value',
    });
  });

  test('keeps a lone double quote intact', () => {
    const content = '---\nname: alpha\ndescription: "\n---\nbody';
    expect(parseSkillFrontmatter(content).description).toBe('"');
  });

  test('returns empty object without frontmatter', () => {
    expect(parseSkillFrontmatter('# no frontmatter here')).toEqual({});
  });

  test('ignores unrelated frontmatter keys', () => {
    const content = '---\nname: alpha\nallowed-tools: Bash, Read\ndescription: d\n---\n';
    expect(parseSkillFrontmatter(content)).toEqual({ name: 'alpha', description: 'd' });
  });
});

describe('discoverSkills', () => {
  test('collects skills sorted by directory name', () => {
    const deps = makeDeps({
      dirs: ['beta', 'alpha'],
      files: new Map([
        ['.claude/skills/alpha/SKILL.md', skillMd('alpha', 'first')],
        ['.claude/skills/beta/SKILL.md', skillMd('beta', 'second')],
      ]),
    });
    const result = discoverSkills('.claude/skills', deps);
    expect(result.issues).toEqual([]);
    expect(result.skills).toEqual([
      { name: 'alpha', description: 'first' },
      { name: 'beta', description: 'second' },
    ]);
  });

  test('reports a directory without SKILL.md', () => {
    const deps = makeDeps({ dirs: ['empty'] });
    const result = discoverSkills('.claude/skills', deps);
    expect(result.skills).toEqual([]);
    expect(result.issues).toEqual(['empty: missing SKILL.md']);
  });

  test('reports missing frontmatter fields', () => {
    const deps = makeDeps({
      dirs: ['nameless'],
      files: new Map([['.claude/skills/nameless/SKILL.md', '---\nname: nameless\n---\n']]),
    });
    expect(discoverSkills('.claude/skills', deps).issues).toEqual([
      'nameless: SKILL.md frontmatter must declare name and description',
    ]);
  });

  test('reports a frontmatter name that mismatches the directory', () => {
    const deps = makeDeps({
      dirs: ['actual'],
      files: new Map([['.claude/skills/actual/SKILL.md', skillMd('other', 'd')]]),
    });
    expect(discoverSkills('.claude/skills', deps).issues).toEqual([
      'actual: frontmatter name is other, expected actual',
    ]);
  });
});

describe('renderSkillsList', () => {
  test('renders bold code names with descriptions', () => {
    const list = renderSkillsList([
      { name: 'alpha', description: 'first' },
      { name: 'beta', description: 'second' },
    ]);
    expect(list).toBe('- **`alpha`**: first\n- **`beta`**: second');
  });
});

describe('replaceGeneratedBlock', () => {
  test('replaces the content between markers', () => {
    const updated = replaceGeneratedBlock(agentsMdAround('stale'), 'fresh');
    expect(updated).toBe(agentsMdAround('fresh'));
  });

  test('throws when the begin marker is missing', () => {
    expect(() => replaceGeneratedBlock(`doc\n${END_MARKER}\n`, 'x')).toThrow(/markers/);
  });

  test('throws when the end marker is missing', () => {
    expect(() => replaceGeneratedBlock(`doc\n${BEGIN_MARKER}\n`, 'x')).toThrow(/markers/);
  });

  test('throws when the markers are out of order', () => {
    expect(() => replaceGeneratedBlock(`${END_MARKER}\n${BEGIN_MARKER}\n`, 'x')).toThrow(
      /in that order/,
    );
  });
});

describe('parseArgs', () => {
  test('defaults to check mode with repo-root paths', () => {
    expect(parseArgs([])).toEqual({
      mode: 'check',
      skillsDir: DEFAULT_SKILLS_DIR,
      agentsMd: DEFAULT_AGENTS_MD,
    });
  });

  test('accepts write, check, and path overrides', () => {
    expect(parseArgs(['--write', '--skills-dir', 's', '--agents-md', 'a', '--check'])).toEqual({
      mode: 'check',
      skillsDir: 's',
      agentsMd: 'a',
    });
    expect(parseArgs(['--write']).mode).toBe('write');
  });

  test('rejects unknown arguments', () => {
    expect(() => parseArgs(['--bogus'])).toThrow('unknown argument: --bogus');
  });
});

describe('runAgentsSkills', () => {
  const freshList = '- **`alpha`**: first';

  function fixtureFiles(agentsBlock: string): Map<string, string> {
    return new Map([
      ['skills/alpha/SKILL.md', skillMd('alpha', 'first')],
      ['AGENTS.md', agentsMdAround(agentsBlock)],
    ]);
  }

  test('check mode passes when the block is current', () => {
    const deps = makeDeps({ dirs: ['alpha'], files: fixtureFiles(freshList) });
    const code = runAgentsSkills(
      { mode: 'check', skillsDir: 'skills', agentsMd: 'AGENTS.md' },
      deps,
    );
    expect(code).toBe(0);
    expect(deps.logs).toEqual(['agents skills: AGENTS.md in sync (1 skills)']);
    expect(deps.written.size).toBe(0);
  });

  test('check mode fails on a stale block without writing', () => {
    const deps = makeDeps({ dirs: ['alpha'], files: fixtureFiles('stale entry') });
    const code = runAgentsSkills(
      { mode: 'check', skillsDir: 'skills', agentsMd: 'AGENTS.md' },
      deps,
    );
    expect(code).toBe(1);
    expect(deps.errors[0]).toContain('stale');
    expect(deps.written.size).toBe(0);
  });

  test('write mode regenerates a stale block', () => {
    const deps = makeDeps({ dirs: ['alpha'], files: fixtureFiles('stale entry') });
    const code = runAgentsSkills(
      { mode: 'write', skillsDir: 'skills', agentsMd: 'AGENTS.md' },
      deps,
    );
    expect(code).toBe(0);
    expect(deps.written.get('AGENTS.md')).toBe(agentsMdAround(freshList));
    expect(deps.logs).toEqual(['agents skills: AGENTS.md updated (1 skills)']);
  });

  test('write mode leaves a current block untouched', () => {
    const deps = makeDeps({ dirs: ['alpha'], files: fixtureFiles(freshList) });
    const code = runAgentsSkills(
      { mode: 'write', skillsDir: 'skills', agentsMd: 'AGENTS.md' },
      deps,
    );
    expect(code).toBe(0);
    expect(deps.written.size).toBe(0);
  });

  test('fails before touching AGENTS.md when discovery reports issues', () => {
    const readText = vi.fn(() => {
      throw new Error('ENOENT');
    });
    const deps = makeDeps({ dirs: ['broken'] });
    const spied = { ...deps, readText };
    const code = runAgentsSkills(
      { mode: 'write', skillsDir: 'skills', agentsMd: 'AGENTS.md' },
      spied,
    );
    expect(code).toBe(1);
    expect(deps.errors).toEqual(['agents skills: broken: missing SKILL.md']);
    expect(readText).toHaveBeenCalledTimes(1);
  });
});
