import { beforeEach, describe, expect, test, vi } from 'vitest';

const calls: Array<[string, string[]]> = [];

vi.mock('../lib/git', () => ({
  runInherit: (command: string, args: string[]) => {
    calls.push([command, args]);
  },
}));

async function loadMain(moduleName: string): Promise<(argv?: string[]) => void> {
  const mod = await import(`../${moduleName}.ts`);
  return mod.main;
}

describe('thin script wrappers', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  test('bootstrap checks each required tool/workspace once', async () => {
    const main = await loadMain('bootstrap');
    main();
    expect(calls).toEqual([
      ['bun', ['--version']],
      ['pnpm', ['install']],
      ['cargo', ['check']],
      ['uv', ['sync']],
    ]);
  });

  test.each([
    ['build', ['pnpm', ['turbo', 'run', 'build', '--filter=...']]],
    ['lint', ['pnpm', ['turbo', 'run', 'lint', '--filter=...']]],
    ['boot', ['docker', ['compose', '-f', 'harness/observability/compose.harness.yml', 'up']]],
    ['inspector', ['harness/inspector/bin/inspector', ['--help']]],
    ['sensors', ['harness/sensors/bin/sensors', ['--help']]],
    ['stack', ['harness/stack/bin/stack', ['inspect']]],
    ['versioning', ['harness/versioning/bin/versioning', ['check']]],
    ['cargo', ['cargo', ['check']]],
    ['uv', ['uv', ['sync']]],
  ])('%s delegates to the expected command', async (moduleName, expected) => {
    const main = await loadMain(moduleName);
    main((expected[1] as string[]).slice(-1));
    expect(calls).toEqual([expected]);
  });

  test('test runs affected workspace tests and script coverage', async () => {
    const main = await loadMain('test');
    main(['--filter=...']);
    expect(calls).toEqual([
      ['pnpm', ['turbo', 'run', 'test', '--filter=...']],
      ['pnpm', ['exec', 'vitest', 'run', 'scripts/tests', '--coverage']],
    ]);
  });
});
