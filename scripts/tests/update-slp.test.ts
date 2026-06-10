import { beforeEach, describe, expect, test, vi } from 'vitest';

const VALID_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FETCH_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const REPO_ROOT = '/repo';
const CWD_ROOT = process.cwd();
const TEMP_DIR = '/tmp/slp-vendor-1';
const MANIFEST_PATH = `${REPO_ROOT}/.claude/skills/slp-source.json`;
const SKILLS_ROOT = `${REPO_ROOT}/.claude/skills`;

function addRepoFixture(root: string): void {
  fsMock.state.files.set(`${root}/.claude/skills/slp-source.json`, manifest());
  fsMock.state.paths.add(`${root}/.claude`);
  fsMock.state.paths.add(`${root}/.claude/skills`);
  fsMock.state.paths.add(`${root}/.claude/skills/slp-source.json`);
  fsMock.state.paths.add(`${root}/.claude/skills/testing`);
  fsMock.state.paths.add(`${root}/.claude/skills/types`);
}

const fsMock = vi.hoisted(() => {
  const state = {
    files: new Map<string, string>(),
    paths: new Set<string>(),
    realPaths: new Map<string, string>(),
    calls: [] as string[],
    copyFailure: undefined as Error | undefined,
  };

  return {
    state,
    cpSync: vi.fn((src: string, dst: string) => {
      state.calls.push(`cp ${src} ${dst}`);
      if (state.copyFailure) {
        throw state.copyFailure;
      }
      state.paths.add(dst);
    }),
    existsSync: vi.fn((path: string) => state.paths.has(path) || state.files.has(path)),
    mkdtempSync: vi.fn(() => {
      state.paths.add(TEMP_DIR);
      return TEMP_DIR;
    }),
    readFileSync: vi.fn((path: string) => {
      const text = state.files.get(path);
      if (text === undefined) {
        throw new Error(`missing file ${path}`);
      }
      return text;
    }),
    realpathSync: vi.fn((path: string) => {
      const real = state.realPaths.get(path);
      if (real) {
        return real;
      }
      if (state.paths.has(path) || state.files.has(path)) {
        return path;
      }
      throw new Error(`missing realpath ${path}`);
    }),
    rmSync: vi.fn((path: string) => {
      state.calls.push(`rm ${path}`);
      state.paths.delete(path);
      state.files.delete(path);
    }),
    writeFileSync: vi.fn((path: string, text: string) => {
      state.calls.push(`write ${path}`);
      state.files.set(path, text);
      state.paths.add(path);
    }),
  };
});

const childProcessMock = vi.hoisted(() => {
  const state = {
    execCalls: [] as string[][],
    spawnCalls: [] as string[][],
    failCommand: undefined as string | undefined,
    statusOutput: ' M .claude/skills/testing/SKILL.md\n M .claude/skills/slp-source.json\n' as
      | string
      | undefined,
  };

  return {
    state,
    execFileSync: vi.fn((_command: string, args: string[]) => {
      state.execCalls.push(args);
      if (state.failCommand && args.includes(state.failCommand)) {
        throw new Error(`${state.failCommand} failed`);
      }
      if (args.includes('rev-parse')) {
        return `${FETCH_SHA}\n`;
      }
      return '';
    }),
    spawnSync: vi.fn((_command: string, args: string[]) => {
      state.spawnCalls.push(args);
      return { stdout: state.statusOutput };
    }),
  };
});

vi.mock('node:fs', () => fsMock);
vi.mock('node:child_process', () => childProcessMock);

function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    $comment: 'managed',
    note: 'excluded skills documented',
    upstream: 'https://example.test/software-leverage-points',
    commit: VALID_SHA,
    vendoredOn: '2026-06-10',
    sourcePath: 'skills',
    skills: ['testing', 'types'],
    ...overrides,
  });
}

function resetMocks(overrides: Record<string, unknown> = {}): void {
  fsMock.state.files = new Map([[MANIFEST_PATH, manifest(overrides)]]);
  fsMock.state.paths = new Set([
    MANIFEST_PATH,
    `${REPO_ROOT}/.claude`,
    SKILLS_ROOT,
    `${TEMP_DIR}/skills`,
    `${TEMP_DIR}/skills/testing`,
    `${TEMP_DIR}/skills/types`,
    `${SKILLS_ROOT}/testing`,
    `${SKILLS_ROOT}/types`,
  ]);
  fsMock.state.realPaths = new Map();
  fsMock.state.calls = [];
  fsMock.state.copyFailure = undefined;
  addRepoFixture(CWD_ROOT);
  vi.mocked(fsMock.cpSync).mockClear();
  vi.mocked(fsMock.existsSync).mockClear();
  vi.mocked(fsMock.mkdtempSync).mockClear();
  vi.mocked(fsMock.readFileSync).mockClear();
  vi.mocked(fsMock.realpathSync).mockClear();
  vi.mocked(fsMock.rmSync).mockClear();
  vi.mocked(fsMock.writeFileSync).mockClear();

  childProcessMock.state.execCalls = [];
  childProcessMock.state.spawnCalls = [];
  childProcessMock.state.failCommand = undefined;
  childProcessMock.state.statusOutput =
    ' M .claude/skills/testing/SKILL.md\n M .claude/skills/slp-source.json\n';
  vi.mocked(childProcessMock.execFileSync).mockClear();
  vi.mocked(childProcessMock.spawnSync).mockClear();
}

describe('updateSlp', () => {
  beforeEach(() => {
    resetMocks();
  });

  test('fetches the requested ref, checks out FETCH_HEAD detached, stages all skills, writes the manifest, reports status, and cleans up', async () => {
    const { updateSlp } = await import('../update-slp');

    const result = updateSlp({
      repoRoot: REPO_ROOT,
      ref: 'feature/ref',
      now: new Date('2026-06-11T12:00:00Z'),
    });

    expect(result).toEqual({
      sha: FETCH_SHA,
      changed: ' M .claude/skills/testing/SKILL.md\n M .claude/skills/slp-source.json',
    });
    expect(childProcessMock.state.execCalls).toEqual([
      ['clone', '--quiet', 'https://example.test/software-leverage-points', TEMP_DIR],
      ['-C', TEMP_DIR, 'fetch', '--quiet', 'origin', 'feature/ref'],
      ['-C', TEMP_DIR, 'rev-parse', 'FETCH_HEAD'],
      ['-C', TEMP_DIR, 'checkout', '--quiet', '--detach', FETCH_SHA],
    ]);
    expect(childProcessMock.state.spawnCalls).toEqual([
      ['status', '--short', '--', '.claude/skills', '.claude/skills/slp-source.json'],
    ]);
    expect(fsMock.state.calls).toEqual([
      `cp ${TEMP_DIR}/skills/testing ${TEMP_DIR}/.slp-staging/testing`,
      `cp ${TEMP_DIR}/skills/types ${TEMP_DIR}/.slp-staging/types`,
      `rm ${SKILLS_ROOT}/testing`,
      `cp ${TEMP_DIR}/.slp-staging/testing ${SKILLS_ROOT}/testing`,
      `rm ${SKILLS_ROOT}/types`,
      `cp ${TEMP_DIR}/.slp-staging/types ${SKILLS_ROOT}/types`,
      `write ${MANIFEST_PATH}`,
      `rm ${TEMP_DIR}`,
    ]);
    expect(JSON.parse(fsMock.state.files.get(MANIFEST_PATH) ?? '{}')).toMatchObject({
      commit: FETCH_SHA,
      vendoredOn: '2026-06-11',
    });
  });

  test('defaults to main and handles a manifest without optional comment fields', async () => {
    resetMocks({ $comment: undefined, note: undefined, skills: ['testing'] });
    fsMock.state.files.set(
      MANIFEST_PATH,
      JSON.stringify({
        upstream: 'https://example.test/software-leverage-points',
        commit: VALID_SHA,
        vendoredOn: '2026-06-10',
        sourcePath: 'skills',
        skills: ['testing'],
      }),
    );
    const { updateSlp } = await import('../update-slp');

    updateSlp({ repoRoot: REPO_ROOT });

    expect(childProcessMock.state.execCalls[1]).toEqual([
      '-C',
      TEMP_DIR,
      'fetch',
      '--quiet',
      'origin',
      'main',
    ]);
  });

  test('uses process cwd defaults and tolerates missing git status stdout', async () => {
    childProcessMock.state.statusOutput = undefined;
    const { updateSlp } = await import('../update-slp');

    expect(updateSlp()).toEqual({ sha: FETCH_SHA, changed: '' });
    expect(childProcessMock.state.execCalls[1]).toEqual([
      '-C',
      TEMP_DIR,
      'fetch',
      '--quiet',
      'origin',
      'main',
    ]);
  });

  test('prints help without updating', async () => {
    const { main } = await import('../update-slp');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    main(['--help']);

    expect(log).toHaveBeenCalledWith(expect.stringContaining('Usage: just update-slp'));
    expect(childProcessMock.execFileSync).not.toHaveBeenCalled();
    log.mockRestore();
  });

  test('prints changed files from status output', async () => {
    const { main } = await import('../update-slp');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    main(['release']);

    expect(log.mock.calls.map(([line]) => line)).toEqual([
      `pinned to ${FETCH_SHA}`,
      'changed files:',
      ' M .claude/skills/testing/SKILL.md\n M .claude/skills/slp-source.json',
    ]);
    log.mockRestore();
  });

  test('prints no changes when status is empty', async () => {
    childProcessMock.state.statusOutput = '';
    const { main } = await import('../update-slp');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    main(['--', 'ignored']);

    expect(log.mock.calls.map(([line]) => line)).toEqual([`pinned to ${FETCH_SHA}`, 'no changes']);
    log.mockRestore();
  });

  test('main defaults to main when no ref is passed', async () => {
    const { main } = await import('../update-slp');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    main([]);

    expect(childProcessMock.state.execCalls[1]).toEqual([
      '-C',
      TEMP_DIR,
      'fetch',
      '--quiet',
      'origin',
      'main',
    ]);
    log.mockRestore();
  });

  test.each(['clone', 'fetch', 'checkout'])('cleans up temp dir when git %s fails', async (command) => {
    childProcessMock.state.failCommand = command;
    const { updateSlp } = await import('../update-slp');

    expect(() => updateSlp({ repoRoot: REPO_ROOT })).toThrow(`${command} failed`);
    expect(fsMock.state.calls.at(-1)).toBe(`rm ${TEMP_DIR}`);
    expect(fsMock.state.calls).not.toContain(`write ${MANIFEST_PATH}`);
  });

  test('cleans up temp dir when staging copy fails and does not replace destinations', async () => {
    fsMock.state.copyFailure = new Error('copy failed');
    const { updateSlp } = await import('../update-slp');

    expect(() => updateSlp({ repoRoot: REPO_ROOT })).toThrow('copy failed');
    expect(fsMock.state.calls).toEqual([
      `cp ${TEMP_DIR}/skills/testing ${TEMP_DIR}/.slp-staging/testing`,
      `rm ${TEMP_DIR}`,
    ]);
  });

  test('rejects a missing upstream skill before replacing destinations', async () => {
    fsMock.state.paths.delete(`${TEMP_DIR}/skills/types`);
    const { updateSlp } = await import('../update-slp');

    expect(() => updateSlp({ repoRoot: REPO_ROOT })).toThrow('upstream skill not found: types');
    expect(fsMock.state.calls).toEqual([
      `cp ${TEMP_DIR}/skills/testing ${TEMP_DIR}/.slp-staging/testing`,
      `rm ${TEMP_DIR}`,
    ]);
  });

  test('rejects source paths that escape the upstream skills root', async () => {
    fsMock.state.realPaths.set(`${TEMP_DIR}/skills/testing`, '/outside/testing');
    const { updateSlp } = await import('../update-slp');

    expect(() => updateSlp({ repoRoot: REPO_ROOT })).toThrow('source path escapes');
    expect(fsMock.state.calls.at(-1)).toBe(`rm ${TEMP_DIR}`);
  });

  test('rejects existing destination paths that escape the repo skills root before rmSync', async () => {
    fsMock.state.realPaths.set(`${SKILLS_ROOT}/testing`, '/outside/testing');
    const { updateSlp } = await import('../update-slp');

    expect(() => updateSlp({ repoRoot: REPO_ROOT })).toThrow('destination path escapes');
    expect(fsMock.state.calls).toEqual([`rm ${TEMP_DIR}`]);
  });

  test('supports absent destination directories that resolve under the repo skills root', async () => {
    fsMock.state.paths.delete(`${SKILLS_ROOT}/testing`);
    fsMock.state.paths.delete(`${SKILLS_ROOT}/types`);
    const { updateSlp } = await import('../update-slp');

    expect(updateSlp({ repoRoot: REPO_ROOT }).sha).toBe(FETCH_SHA);
    expect(fsMock.state.calls).toContain(`rm ${SKILLS_ROOT}/testing`);
  });

  test.each([
    ['non-object manifest', '[]', 'manifest must be a JSON object'],
    ['bad comment', manifest({ $comment: 1 }), '$comment must be a string'],
    ['bad note', manifest({ note: 1 }), 'note must be a string'],
    ['bad upstream', manifest({ upstream: '' }), 'upstream must be a non-empty string'],
    ['bad commit', manifest({ commit: 'abc' }), 'commit must be a 40-character'],
    ['absolute sourcePath', manifest({ sourcePath: '/skills' }), 'sourcePath must be a relative path'],
    ['escaping sourcePath', manifest({ sourcePath: '../skills' }), 'sourcePath must be a relative path'],
    ['missing skills', manifest({ skills: [] }), 'skills must be a non-empty string list'],
    ['non-string skill', manifest({ skills: ['testing', 1] }), 'skills entries must be non-empty'],
    ['empty skill', manifest({ skills: [''] }), 'skills entries must be non-empty'],
    ['skill with slash', manifest({ skills: ['bad/name'] }), 'must be a single safe directory name'],
    ['skill with backslash', manifest({ skills: ['bad\\name'] }), 'must be a single safe directory name'],
    ['skill with dotdot', manifest({ skills: ['bad..name'] }), 'must be a single safe directory name'],
  ])('rejects invalid manifest: %s', async (_name, text, message) => {
    fsMock.state.files.set(MANIFEST_PATH, text);
    const { updateSlp } = await import('../update-slp');

    expect(() => updateSlp({ repoRoot: REPO_ROOT })).toThrow(message);
    expect(fsMock.mkdtempSync).not.toHaveBeenCalled();
    expect(childProcessMock.execFileSync).not.toHaveBeenCalled();
  });
});
