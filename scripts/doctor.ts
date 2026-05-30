import { spawnSync } from 'node:child_process';

const required = ['bun', 'pnpm', 'git', 'cargo', 'uv', 'just'];
const missing = required.filter((tool) => spawnSync(tool, ['--version'], { stdio: 'ignore' }).status !== 0);

const hasContainer =
  spawnSync('docker', ['--version'], { stdio: 'ignore' }).status === 0 ||
  spawnSync('podman', ['--version'], { stdio: 'ignore' }).status === 0;

if (!hasContainer) {
  missing.push('docker-or-podman');
}

if (missing.length > 0) {
  console.error(`missing required tools: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('doctor: required tools present');

