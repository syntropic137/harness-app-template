import { spawn } from 'node:child_process';

export interface ExecCaptureResult {
  /** Process exit status. A null code (killed by signal) is reported as 1. */
  status: number;
  /** Combined stdout+stderr, in the order the child emitted it. */
  output: string;
}

/**
 * Run a command with stdio inherited live -- so a human watching a gate run
 * still sees normal progress -- while ALSO capturing the combined
 * stdout+stderr text. The capture exists so a caller (see
 * scripts/lib/starved-runner.ts) can inspect what the process actually
 * printed without giving up live visibility, which `runInherit` in
 * scripts/lib/git.ts cannot do because it hands stdio straight to the
 * child with nothing left for this process to read.
 */
export function execCapture(
  command: string,
  args: string[],
  cwd: string = process.cwd(),
): Promise<ExecCaptureResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['inherit', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      resolvePromise({ status: code ?? 1, output });
    });
  });
}
