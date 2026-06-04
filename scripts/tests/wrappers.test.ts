import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    process.exitCode = undefined;
  });

  // bootstrap is intentionally not a thin wrapper any more: it owns the
  // preflight + esbuild auto-repair flow. See scripts/tests/bootstrap.test.ts
  // for its full coverage suite.

  test.each([
    ['build', ['pnpm', ['turbo', 'run', 'build', '--filter=...']]],
    ['typecheck', ['pnpm', ['turbo', 'run', 'typecheck', '--filter=...']]],
    ['lint', ['pnpm', ['turbo', 'run', 'lint', '--filter=...']]],
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

  test('lint-fix delegates to biome write mode', async () => {
    const main = await loadMain('lint');
    main(['--fix', '--files-ignore-unknown=true']);
    expect(calls).toEqual([
      ['pnpm', ['exec', 'biome', 'check', '.', '--write', '--files-ignore-unknown=true']],
    ]);
  });

  test('qa runs the full quality sweep', async () => {
    const main = await loadMain('qa');
    main(['--filter=...']);
    expect(calls).toEqual([
      ['pnpm', ['turbo', 'run', 'typecheck', '--filter=...']],
      ['pnpm', ['turbo', 'run', 'lint', '--filter=...']],
      ['pnpm', ['turbo', 'run', 'test', '--concurrency=1', '--filter=...']],
      ['pnpm', ['exec', 'vitest', 'run', 'scripts/tests', '--coverage']],
      ['harness/sensors/bin/sensors', ['gate']],
      ['sh', ['-eu', '-c', expect.stringContaining('gitleaks detect --redact --no-banner')]],
    ]);
  });

  test('boot wrapper forwards legacy up through the stack manager', async () => {
    const errors: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation((message: string) => {
      errors.push(message);
    });

    try {
      const main = await loadMain('boot');
      main(['up', '-d', '--bug', 'BUG_COMPLETE_TASK_500']);
      expect(calls).toEqual([
        ['harness/stack/bin/stack', ['boot', '--bug', 'BUG_COMPLETE_TASK_500']],
      ]);
      expect(errors).toEqual(['warning: just boot is deprecated; forwarding to just stack boot']);
      expect(process.exitCode).toBeUndefined();
    } finally {
      error.mockRestore();
    }
  });

  test('boot wrapper forwards bare legacy detach through the stack manager', async () => {
    const errors: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation((message: string) => {
      errors.push(message);
    });

    try {
      const main = await loadMain('boot');
      main(['-d']);
      expect(calls).toEqual([['harness/stack/bin/stack', ['boot']]]);
      expect(errors).toEqual(['warning: just boot is deprecated; forwarding to just stack boot']);
      expect(process.exitCode).toBeUndefined();
    } finally {
      error.mockRestore();
    }
  });

  test('boot wrapper maps legacy down to stack destroy', async () => {
    const errors: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation((message: string) => {
      errors.push(message);
    });

    try {
      const main = await loadMain('boot');
      main(['down', '-v']);
      expect(calls).toEqual([['harness/stack/bin/stack', ['destroy', '-v']]]);
      expect(errors).toEqual([
        'warning: just boot down is deprecated; forwarding to just stack destroy',
      ]);
      expect(process.exitCode).toBeUndefined();
    } finally {
      error.mockRestore();
    }
  });

  test('boot wrapper maps legacy stop to stack stop', async () => {
    const errors: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation((message: string) => {
      errors.push(message);
    });

    try {
      const main = await loadMain('boot');
      main(['stop']);
      expect(calls).toEqual([['harness/stack/bin/stack', ['stop']]]);
      expect(errors).toEqual([
        'warning: just boot stop is deprecated; forwarding to just stack stop',
      ]);
      expect(process.exitCode).toBeUndefined();
    } finally {
      error.mockRestore();
    }
  });

  test('boot wrapper rejects raw compose commands', async () => {
    const errors: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation((message: string) => {
      errors.push(message);
    });

    try {
      const main = await loadMain('boot');
      main(['ps']);
      expect(calls).toEqual([]);
      expect(errors).toEqual([
        'usage: just boot [up|-d|stop|down] [--bug NAME]',
        'use just stack <boot|inspect|ports|stop|destroy|doctor> for the canonical stack-manager entrypoint',
      ]);
      expect(process.exitCode).toBe(64);
    } finally {
      error.mockRestore();
    }
  });

  test('justfile exposes lab stack lifecycle recipes as thin dispatchers', () => {
    const justfile = readFileSync(new URL('../../justfile', import.meta.url), 'utf8');
    const expectedRecipes = [
      'stop:\n    bun run scripts/stack.ts stop',
      'destroy:\n    bun run scripts/stack.ts destroy',
      'inspect:\n    @bun run scripts/stack.ts inspect',
      'ports:\n    @bun run scripts/stack.ts ports',
      'lint-fix *args:\n    bun run scripts/lint.ts --fix {{args}}',
      'doctor-explain check_id:\n    @bun run scripts/stack.ts doctor --explain {{check_id}}',
      'doctor-json *probe:\n    @bun run scripts/stack.ts doctor --json {{probe}}',
    ];

    for (const recipe of expectedRecipes) {
      expect(justfile).toContain(recipe);
    }
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
      ['pnpm', ['turbo', 'run', 'test', '--concurrency=1', '--filter=...']],
      ['pnpm', ['exec', 'vitest', 'run', 'scripts/tests', '--coverage']],
    ]);
  });

  test('test-coverage runs package-local coverage gates', async () => {
    const main = await loadMain('test-coverage');
    main(['--run']);
    expect(calls).toEqual([
      ['pnpm', ['exec', 'vitest', 'run', 'scripts/tests', '--coverage', '--run']],
      [
        'pnpm',
        [
          '--dir',
          'ws_apps/example-typescript',
          'exec',
          'vitest',
          'run',
          '--coverage',
          '--exclude',
          'tests/integration/**',
          '--run',
        ],
      ],
      ['pnpm', ['--dir', 'harness/stack', 'exec', 'vitest', 'run', '--coverage', '--run']],
      ['pnpm', ['--dir', 'harness/inspector', 'exec', 'vitest', 'run', '--coverage', '--run']],
    ]);
  });
});
