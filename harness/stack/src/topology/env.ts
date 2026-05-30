import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function envFilePath(worktreePath: string, isoKey: string): string {
  return join(worktreePath, '.harness', `${isoKey}.env`);
}

export function writeEnvFile(
  worktreePath: string,
  isoKey: string,
  vars: Record<string, string | number>,
): string {
  const path = envFilePath(worktreePath, isoKey);
  mkdirSync(join(worktreePath, '.harness'), { recursive: true });
  const body = `${Object.entries(vars)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('\n')}\n`;
  writeFileSync(path, body, 'utf8');
  return path;
}
