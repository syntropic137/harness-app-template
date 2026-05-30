import { spawnSync } from 'node:child_process';

const required = ['bun', 'pnpm', 'git', 'cargo', 'uv', 'just'];

export interface DoctorDeps {
  spawn: typeof spawnSync;
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  exit: (code: number) => never;
}

export function missingTools(spawn: typeof spawnSync): string[] {
  const missing = required.filter((tool) => spawn(tool, ['--version'], { stdio: 'ignore' }).status !== 0);
  const hasContainer =
    spawn('docker', ['--version'], { stdio: 'ignore' }).status === 0 ||
    spawn('podman', ['--version'], { stdio: 'ignore' }).status === 0;
  if (!hasContainer) {
    missing.push('docker-or-podman');
  }
  return missing;
}

export function main(deps: DoctorDeps): void {
  const missing = missingTools(deps.spawn);
  if (missing.length > 0) {
    deps.stderr.error(`missing required tools: ${missing.join(', ')}`);
    deps.exit(1);
  }
  deps.stdout.log('doctor: required tools present');
}

/* v8 ignore next 9 */
if (import.meta.url === `file://${process.argv[1]}`) {
  main({
    spawn: spawnSync,
    stdout: console,
    stderr: console,
    exit: (code: number): never => process.exit(code),
  });
}
