import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  test('sensors wrapper honors the manifest none plugin swap', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cha-slot-'));
    const logs: string[] = [];
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    const log = vi.spyOn(console, 'log').mockImplementation((message: string) => {
      logs.push(message);
    });

    try {
      writeFileSync(
        join(root, 'harness.manifest.json'),
        `${JSON.stringify({
          slots: {
            sensors: {
              contract: 'sensors',
              plugin: 'none',
              version: '0.6.2-ts-adapter+abstractness',
              required: false,
              swappable: true,
              interface: {
                type: 'cli',
                entrypoint: 'harness/sensors/bin/sensors',
                commands: ['report', 'gate'],
              },
              decisionAt: 'docs/adrs/ADR-0006-sensors.md',
            },
          },
        })}\n`,
      );

      const main = await loadMain('sensors');
      main(['report']);

      expect(calls).toEqual([]);
      expect(logs).toEqual([
        'Slot sensors skipped because harness.manifest.json sets plugin to none.',
      ]);
    } finally {
      cwd.mockRestore();
      log.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
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
