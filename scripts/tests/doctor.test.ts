import { describe, expect, test, vi } from 'vitest';
import { main, missingTools } from '../doctor';

function spawnWith(successes: Set<string>) {
  return vi.fn((command: string) => ({ status: successes.has(command) ? 0 : 1 }));
}

describe('doctor', () => {
  test('passes when required tools and docker are present', () => {
    const spawn = spawnWith(new Set(['bun', 'pnpm', 'git', 'cargo', 'uv', 'just', 'docker']));
    expect(missingTools(spawn as never)).toEqual([]);
  });

  test('accepts podman as the container runtime', () => {
    const spawn = spawnWith(new Set(['bun', 'pnpm', 'git', 'cargo', 'uv', 'just', 'podman']));
    expect(missingTools(spawn as never)).toEqual([]);
  });

  test('reports missing container runtime when neither docker nor podman is present', () => {
    const spawn = spawnWith(new Set(['bun', 'pnpm', 'git', 'cargo', 'uv', 'just']));
    expect(missingTools(spawn as never)).toEqual(['docker-or-podman']);
  });

  test('reports missing tools and exits nonzero', () => {
    const spawn = spawnWith(new Set(['bun', 'git', 'docker']));
    const errors: string[] = [];
    const logs: string[] = [];
    expect(() =>
      main({
        spawn: spawn as never,
        stdout: { log: (message: string) => logs.push(message) },
        stderr: { error: (message: string) => errors.push(message) },
        exit: (code: number): never => {
          throw new Error(`exit ${code}`);
        },
      }),
    ).toThrow('exit 1');
    expect(errors).toEqual(['missing required tools: pnpm, cargo, uv, just']);
    expect(logs).toEqual([]);
  });

  test('prints success when nothing is missing', () => {
    const logs: string[] = [];
    main({
      spawn: spawnWith(new Set(['bun', 'pnpm', 'git', 'cargo', 'uv', 'just', 'docker'])) as never,
      stdout: { log: (message: string) => logs.push(message) },
      stderr: { error: () => undefined },
      exit: (code: number): never => {
        throw new Error(`unexpected exit ${code}`);
      },
    });
    expect(logs).toEqual(['doctor: required tools present']);
  });
});
