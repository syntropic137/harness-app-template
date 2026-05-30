import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

const SKIP_DIRS = new Set([
  '.git',
  '.turbo',
  '.venv',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
  '__pycache__',
  '.pytest_cache',
  '.ruff_cache',
]);

const TEXT_EXTENSIONS = new Set([
  '',
  '.cjs',
  '.css',
  '.go',
  '.html',
  '.js',
  '.json',
  '.jsonc',
  '.md',
  '.mjs',
  '.py',
  '.rs',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

export function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function removeIfExists(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { force: true, recursive: true });
  }
}

export function renameIfExists(from: string, to: string): void {
  if (!existsSync(from)) {
    return;
  }
  if (existsSync(to)) {
    throw new Error(`refusing to rename ${from} to ${to}: destination exists`);
  }
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

export function walkTextFiles(root: string): string[] {
  const files: string[] = [];
  if (!existsSync(root)) {
    return files;
  }

  const visit = (path: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      return;
    }
    if (stat.isDirectory()) {
      /* v8 ignore next 3 */
      if (SKIP_DIRS.has(path.split('/').at(-1) ?? '')) {
        return;
      }
      for (const entry of readdirSync(path)) {
        visit(join(path, entry));
      }
      return;
    }
    /* v8 ignore next 3 */
    if (!stat.isFile()) {
      return;
    }
    const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')) : '';
    /* v8 ignore next 3 */
    if (TEXT_EXTENSIONS.has(ext)) {
      files.push(path);
    }
  };

  visit(root);
  return files;
}

export function replaceInTree(root: string, replacements: Array<[string, string]>): string[] {
  const changed: string[] = [];
  for (const file of walkTextFiles(root)) {
    let content = readText(file);
    const original = content;
    for (const [from, to] of replacements) {
      content = content.split(from).join(to);
    }
    if (content !== original) {
      writeText(file, content);
      changed.push(relative(root, file));
    }
  }
  return changed;
}
