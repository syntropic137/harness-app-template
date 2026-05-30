import { join } from 'node:path';
import { detectIsolation, run } from '../runtime/index.js';

export async function stop(_args: string[]): Promise<number> {
  const iso = detectIsolation();
  return run(
    'docker',
    [
      'compose',
      '-p',
      iso.project,
      '-f',
      join(iso.worktreePath, '.harness', `${iso.isoKey}.compose.yml`),
      'stop',
    ],
    { cwd: iso.worktreePath },
  );
}
