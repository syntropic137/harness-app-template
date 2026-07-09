// scripts/tests/sensors-profile-cli.test.ts
import { describe, expect, test } from 'vitest';
import {
  gate,
  // @ts-expect-error plain ESM, no .d.ts ships with the slot.
} from '../../harness/sensors/gate.mjs';

function ioStub(files: Record<string, string>, env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      read: async () => '{}',
      write: (s: string) => out.push(s),
      writeErr: (s: string) => err.push(s),
      readFile: (p: string) => files[p] ?? '',
      writeFile: () => {},
      fileExists: (p: string) => p in files,
      env,
    },
    out,
    err,
  };
}

describe('--profile CLI', () => {
  test('unknown profile exits 2 with a clear error', async () => {
    const { io, err } = ioStub({
      'harness/.harness/governance.toml': '[profiles.local]\nrequired_adapters = []\n',
    });
    const code = await gate({ argv: ['--profile=bogus', '--readings-from=none'], io });
    expect(code).toBe(2);
    expect(err.join('')).toMatch(/unknown profile 'bogus'/);
  });

  test('SENSORS_PROFILE env sets the profile name', async () => {
    const { io, err } = ioStub(
      { 'harness/.harness/governance.toml': '[profiles.local]\nrequired_adapters = []\n' },
      { SENSORS_PROFILE: 'bogus-env' },
    );
    const code = await gate({ argv: ['--readings-from=none'], io });
    expect(code).toBe(2);
    expect(err.join('')).toMatch(/unknown profile 'bogus-env'/);
  });

  test('--profile= flag takes precedence over SENSORS_PROFILE env', async () => {
    const { io, err } = ioStub(
      { 'harness/.harness/governance.toml': '[profiles.local]\nrequired_adapters = []\n' },
      { SENSORS_PROFILE: 'local' },
    );
    // flag says bogus, env says local (valid) — flag must win
    const code = await gate({ argv: ['--profile=bogus', '--readings-from=none'], io });
    expect(code).toBe(2);
    expect(err.join('')).toMatch(/unknown profile 'bogus'/);
  });

  test('known profile (local) resolves without error', async () => {
    const emptyReport = JSON.stringify({
      workspace: { folders: [], modules: [], circular_edges: 0 },
    });
    const { io, err } = ioStub({
      'harness/.harness/governance.toml': '[profiles.local]\nrequired_adapters = []\n',
      'harness/sensors/baseline.json': JSON.stringify({ dimensions: {}, folders: {} }),
    });
    // override read() to return an empty workspace report so the gate completes past readings
    const ioWithStdin = { ...io, read: async () => emptyReport };
    const code = await gate({
      argv: ['--profile=local', '--baseline-reference=none'],
      io: ioWithStdin,
    });
    // profile resolved cleanly — no unknown-profile error
    expect(err.join('')).not.toMatch(/unknown profile/);
    // exit 0 or 1 are both fine (depends on baseline state), just not 2 from profile resolution
    expect(code).not.toBe(2);
  });
});
