import { spawn } from 'node:child_process';

/** The part of `spawnSync`'s result the tests read, so a call site converts without changing its assertions. */
export interface SpawnAsyncResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface SpawnAsyncOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * `spawnSync`, but awaited, so the vitest worker's event loop keeps answering RPC while the child
 * runs. Use it for any
 * test subprocess that takes seconds: a single synchronous call longer than vitest's 60 s RPC
 * deadline fails the run even when every test passes, and a slow box is what makes it that long.
 *
 * Never rejects on a non-zero exit, exactly like `spawnSync`; a spawn failure (ENOENT) rejects.
 */
export function spawnAsync(
  command: string,
  args: readonly string[],
  options: SpawnAsyncOptions = {},
): Promise<SpawnAsyncResult> {
  return new Promise((resolve, reject) => {
    // stdin is /dev/null: the child sees EOF, as under spawnSync without `input`, and there is no
    // pipe for an early-exiting child to EPIPE.
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}
