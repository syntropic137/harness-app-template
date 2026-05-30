import { execFileSync, type SpawnOptions, spawn } from 'node:child_process';

export function captureSync(cmd: string, args: string[], cwd?: string): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
}

export interface CaptureResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function tryCapture(cmd: string, args: string[]): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    // The `?.` branches are defensive: with stdio ['ignore', 'pipe', 'pipe']
    // both streams are always Readable, but TS types them as nullable. The
    // null branches are unreachable here. Phase E audit.
    /* c8 ignore next 3 */
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    /* c8 ignore next 3 */
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      resolve({ exitCode: 127, stdout, stderr: `${stderr}${err.message}` });
    });
    child.on('exit', (code) => {
      // `code ?? 1` only takes the fallback on signal-terminated processes
      // (where code is null); not exercised by these unit tests. Phase E audit.
      /* c8 ignore next */
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export function run(cmd: string, args: string[], opts: SpawnOptions = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    /* c8 ignore next -- `code ?? 1` only takes fallback on signal exit */
    child.on('exit', (code) => resolve(code ?? 1));
  });
}
