#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';

const DEFAULT_ARGS = ['run', 'documentation', 'validate', '.'];
const WINDOWS_EXTS = ['.exe', '.cmd', '.bat', '.com', ''];

function commandExistsInPath(command) {
  const isWin = process.platform === 'win32';
  const paths = (process.env.PATH || '').split(delimiter);
  const names = isWin ? WINDOWS_EXTS.map((ext) => `${command}${ext}`) : [command];
  return paths.some((dir) => names.some((name) => existsSync(resolve(dir, name))));
}

function resolveApssCommand() {
  const candidates =
    process.platform === 'win32'
      ? WINDOWS_EXTS.map((ext) => resolve(process.cwd(), `.apss/bin/apss${ext}`))
      : [resolve(process.cwd(), '.apss/bin/apss')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  if (commandExistsInPath('apss')) {
    return 'apss';
  }
  throw new Error(
    'APSS binary not found. Install APSS (cargo install apss --version 1.1.0) or ensure .apss/bin/apss exists.',
  );
}

function main(argv) {
  const command = resolveApssCommand();
  const args = argv.length ? argv : DEFAULT_ARGS;
  const proc = spawnSync(command, args, { stdio: 'inherit' });
  if (proc.error) {
    throw proc.error;
  }
  process.exit(proc.status ?? 0);
}

main(process.argv.slice(2));
