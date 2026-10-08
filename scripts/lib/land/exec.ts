import { spawn } from 'node:child_process';
import { createLineFolder } from './fold';

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Receives each folded output line as it appears. */
  onLine?: (line: string) => void;
  /** Data for the child's stdin. */
  input?: string;
}

export interface RunResult {
  /** Exit code, or null when the child was killed by a signal. */
  status: number | null;
  /** Signal name when killed by one, e.g. SIGPIPE. */
  signal: string | null;
  /** Folded combined stdout and stderr. */
  output: string;
}

/** Human description of how a child ended, never conflating a signal with an exit code. */
export function describeExit(result: Pick<RunResult, 'status' | 'signal'>): string {
  if (result.signal !== null) return `killed by ${result.signal}`;
  return `exit status ${result.status ?? 'unknown'}`;
}

export function succeeded(result: RunResult): boolean {
  return result.status === 0 && result.signal === null;
}

/** Run a program, streaming folded output, and report signals faithfully. */
export function runProcess(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const folder = createLineFolder((line) => {
      lines.push(line);
      options.onLine?.(line);
    });
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv | undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => folder.write(chunk));
    child.stderr.on('data', (chunk: string) => folder.write(chunk));
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.input ?? '');
    child.on('error', (error) => {
      folder.end();
      resolve({ status: 127, signal: null, output: `${lines.join('\n')}\n${error.message}` });
    });
    child.on('close', (status, signal) => {
      folder.end();
      resolve({ status, signal, output: lines.join('\n') });
    });
  });
}
