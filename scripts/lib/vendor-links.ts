import {
  lstatSync,
  readFileSync,
  readlinkSync,
  type Stats,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export interface VendorFs {
  lstat: (path: string) => Pick<Stats, 'isSymbolicLink' | 'isFile' | 'isDirectory'> | null;
  readlink: (path: string) => string;
  unlink: (path: string) => void;
  symlink: (target: string, path: string) => void;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
}

export interface VendorReport {
  ok: string[];
  repaired: string[];
  errors: string[];
  mode: 'symlink' | 'copy';
}

export const VENDOR_SYMLINKS: ReadonlyArray<readonly [string, string]> = [
  ['CLAUDE.md', 'AGENTS.md'],
  ['GEMINI.md', 'AGENTS.md'],
  ['.codex', 'AGENTS.md'],
  ['.gemini', 'AGENTS.md'],
];

const CANONICAL_AGENT_FILE = 'AGENTS.md';

function emptyReport(mode: VendorReport['mode']): VendorReport {
  return { ok: [], repaired: [], errors: [], mode };
}

function assertCanonicalAgentFile(cwd: string, fs: VendorFs, report: VendorReport): string | null {
  const canonicalPath = join(cwd, CANONICAL_AGENT_FILE);
  const canonicalStat = fs.lstat(canonicalPath);
  if (!canonicalStat?.isFile()) {
    report.errors.push(
      `${CANONICAL_AGENT_FILE} is missing or not a regular file; the canonical agent context must live there`,
    );
    return null;
  }
  return canonicalPath;
}

export function defaultVendorFs(): VendorFs {
  return {
    lstat: (path) => {
      try {
        return lstatSync(path);
      } catch {
        return null;
      }
    },
    readlink: readlinkSync,
    unlink: unlinkSync,
    symlink: (target, path) => symlinkSync(target, path),
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, content) => writeFileSync(path, content),
  };
}

export function verifyAndRepairVendorLinks(cwd: string, fs: VendorFs): VendorReport {
  const report = emptyReport('symlink');
  if (!assertCanonicalAgentFile(cwd, fs, report)) {
    return report;
  }
  for (const [name, target] of VENDOR_SYMLINKS) {
    const linkPath = join(cwd, name);
    const stat = fs.lstat(linkPath);
    if (stat === null) {
      fs.symlink(target, linkPath);
      report.repaired.push(`${name} -> ${target} (created)`);
      continue;
    }
    if (!stat.isSymbolicLink()) {
      report.errors.push(
        `${name} exists but is not a symlink; refusing to clobber. Remove it manually if you intended to track the canonical layout`,
      );
      continue;
    }
    const actualTarget = fs.readlink(linkPath);
    if (actualTarget === target) {
      report.ok.push(name);
      continue;
    }
    fs.unlink(linkPath);
    fs.symlink(target, linkPath);
    report.repaired.push(`${name} -> ${target} (was ${actualTarget})`);
  }
  return report;
}

export function copySyncVendorMirrors(cwd: string, fs: VendorFs): VendorReport {
  const report = emptyReport('copy');
  const canonicalPath = assertCanonicalAgentFile(cwd, fs, report);
  if (!canonicalPath) {
    return report;
  }
  const canonicalBody = fs.readFile(canonicalPath);

  for (const [name, target] of VENDOR_SYMLINKS) {
    const mirrorPath = join(cwd, name);
    const stat = fs.lstat(mirrorPath);
    if (stat === null) {
      fs.writeFile(mirrorPath, canonicalBody);
      report.repaired.push(`${name} <= ${target} (copied)`);
      continue;
    }
    if (stat.isDirectory()) {
      report.errors.push(`${name} exists but is a directory; refusing to overwrite it`);
      continue;
    }
    if (stat.isSymbolicLink()) {
      const actualTarget = fs.readlink(mirrorPath);
      if (actualTarget === target) {
        report.ok.push(name);
        continue;
      }
      fs.unlink(mirrorPath);
      fs.writeFile(mirrorPath, canonicalBody);
      report.repaired.push(`${name} <= ${target} (replaced symlink from ${actualTarget})`);
      continue;
    }
    if (stat.isFile()) {
      const currentBody = fs.readFile(mirrorPath);
      if (currentBody === canonicalBody) {
        report.ok.push(name);
        continue;
      }
      fs.writeFile(mirrorPath, canonicalBody);
      report.repaired.push(`${name} <= ${target} (refreshed copy)`);
      continue;
    }
    report.errors.push(`${name} has an unsupported file type; refusing to overwrite it`);
  }

  return report;
}
