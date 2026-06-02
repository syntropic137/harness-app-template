import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  type Stats,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

export type ChmodFn = (path: string, mode: number) => void;

export interface VendorFs {
  lstat: (path: string) => Pick<Stats, 'isSymbolicLink' | 'isFile' | 'isDirectory'> | null;
  readlink: (path: string) => string;
  unlink: (path: string) => void;
  symlink: (target: string, path: string) => void;
  exists: (path: string) => boolean;
}

export interface VendorReport {
  ok: string[];
  repaired: string[];
  errors: string[];
}

export const VENDOR_SYMLINKS: ReadonlyArray<readonly [string, string]> = [
  ['CLAUDE.md', 'AGENTS.md'],
  ['GEMINI.md', 'AGENTS.md'],
  ['.codex', 'AGENTS.md'],
  ['.gemini', 'AGENTS.md'],
];

const CANONICAL_AGENT_FILE = 'AGENTS.md';

const REQUIRED_TOOLS = ['bun', 'pnpm', 'cargo', 'uv'] as const;

const INSTALL_HINTS: Record<string, string> = {
  bun: 'install via https://bun.sh (curl -fsSL https://bun.sh/install | bash)',
  pnpm: 'install via corepack enable, or npm i -g pnpm',
  cargo: 'install via https://rustup.rs (curl https://sh.rustup.rs -sSf | sh)',
  uv: 'install via https://docs.astral.sh/uv (curl -LsSf https://astral.sh/uv/install.sh | sh)',
};

export interface BootstrapDeps {
  spawn: typeof spawnSync;
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  exit: (code: number) => never;
  cwd?: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  exists?: (path: string) => boolean;
  readdir?: (path: string) => string[];
  copyFile?: (src: string, dst: string) => void;
  chmod?: ChmodFn;
  vendorFs?: VendorFs;
}

function defaultVendorFs(): VendorFs {
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
    exists: existsSync,
  };
}

export interface EsbuildMismatch {
  version: string;
  binPath: string;
  actual: string;
}

export function detectMissingTools(spawn: typeof spawnSync): string[] {
  return REQUIRED_TOOLS.filter(
    (tool) => spawn(tool, ['--version'], { stdio: 'ignore' }).status !== 0,
  );
}

export function detectEsbuildMismatches(
  cwd: string,
  spawn: typeof spawnSync,
  exists: (path: string) => boolean = existsSync,
  readdir: (path: string) => string[] = readdirSync,
): EsbuildMismatch[] {
  const pnpmDir = join(cwd, 'node_modules', '.pnpm');
  if (!exists(pnpmDir)) {
    return [];
  }
  const out: EsbuildMismatch[] = [];
  for (const entry of readdir(pnpmDir)) {
    const match = entry.match(/^esbuild@(\d+\.\d+\.\d+)$/);
    if (!match) {
      continue;
    }
    const version = match[1] as string;
    const binPath = join(pnpmDir, entry, 'node_modules', 'esbuild', 'bin', 'esbuild');
    if (!exists(binPath)) {
      continue;
    }
    const result = spawn(binPath, ['--version'], { encoding: 'utf8' });
    if (result.status !== 0) {
      continue;
    }
    const stdout = result.stdout;
    const actual = (typeof stdout === 'string' ? stdout : '').trim();
    if (actual && actual !== version) {
      out.push({ version, binPath, actual });
    }
  }
  return out;
}

export function platformArchSlug(platform: NodeJS.Platform, arch: NodeJS.Architecture): string {
  const arches: Partial<Record<NodeJS.Architecture, string>> = {
    x64: 'x64',
    arm64: 'arm64',
    arm: 'arm',
    ia32: 'ia32',
    loong64: 'loong64',
    mips64el: 'mips64el',
    ppc64: 'ppc64',
    riscv64: 'riscv64',
    s390x: 's390x',
  };
  const platforms: Partial<Record<NodeJS.Platform, string>> = {
    linux: 'linux',
    darwin: 'darwin',
    win32: 'win32',
    freebsd: 'freebsd',
    openbsd: 'openbsd',
    netbsd: 'netbsd',
    sunos: 'sunos',
  };
  const p = platforms[platform];
  const a = arches[arch];
  if (!p || !a) {
    throw new Error(`unsupported platform/arch for esbuild repair: ${platform}/${arch}`);
  }
  return `${p}-${a}`;
}

export function repairEsbuildMismatch(
  cwd: string,
  mismatch: EsbuildMismatch,
  platformArch: string,
  exists: (path: string) => boolean = existsSync,
  copyFile: (src: string, dst: string) => void = copyFileSync,
  chmod: ChmodFn = chmodSync,
): boolean {
  const source = join(
    cwd,
    'node_modules',
    '.pnpm',
    `@esbuild+${platformArch}@${mismatch.version}`,
    'node_modules',
    '@esbuild',
    platformArch,
    'bin',
    'esbuild',
  );
  if (!exists(source)) {
    return false;
  }
  copyFile(source, mismatch.binPath);
  chmod(mismatch.binPath, 0o755);
  return true;
}

function runInherit(spawn: typeof spawnSync, command: string, args: string[], cwd: string): number {
  const result = spawn(command, args, { cwd, stdio: 'inherit' });
  return result.status ?? 1;
}

export function verifyAndRepairVendorLinks(cwd: string, fs: VendorFs): VendorReport {
  const report: VendorReport = { ok: [], repaired: [], errors: [] };
  const canonicalPath = join(cwd, CANONICAL_AGENT_FILE);
  const canonicalStat = fs.lstat(canonicalPath);
  if (!canonicalStat || !canonicalStat.isFile()) {
    report.errors.push(
      `${CANONICAL_AGENT_FILE} is missing or not a regular file; the canonical agent context must live there`,
    );
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

export function main(deps: BootstrapDeps): void {
  const cwd = deps.cwd ?? process.cwd();
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const exists = deps.exists ?? existsSync;
  const readdir = deps.readdir ?? readdirSync;
  const copyFile = deps.copyFile ?? copyFileSync;
  const chmod = deps.chmod ?? chmodSync;
  const vendorFs = deps.vendorFs ?? defaultVendorFs();

  const missing = detectMissingTools(deps.spawn);
  if (missing.length > 0) {
    deps.stderr.error(`bootstrap: missing required tools: ${missing.join(', ')}`);
    for (const tool of missing) {
      const hint = INSTALL_HINTS[tool];
      if (hint) {
        deps.stderr.error(`bootstrap:   ${tool}: ${hint}`);
      }
    }
    deps.exit(1);
    return;
  }

  const vendorReport = verifyAndRepairVendorLinks(cwd, vendorFs);
  for (const name of vendorReport.ok) {
    deps.stdout.log(`bootstrap: vendor symlink ${name} ok`);
  }
  for (const entry of vendorReport.repaired) {
    deps.stdout.log(`bootstrap: vendor symlink ${entry}`);
  }
  for (const error of vendorReport.errors) {
    deps.stderr.error(`bootstrap: ${error}`);
  }
  if (vendorReport.errors.length > 0) {
    deps.exit(1);
    return;
  }

  const repairDetectedEsbuildMismatches = (): { detected: number; repaired: number } => {
    const mismatches = detectEsbuildMismatches(cwd, deps.spawn, exists, readdir);
    if (mismatches.length === 0) {
      return { detected: 0, repaired: 0 };
    }

    const slug = platformArchSlug(platform, arch);
    deps.stdout.log(
      `bootstrap: detected ${mismatches.length} esbuild binary mismatch(es); repairing for ${slug}`,
    );
    let repaired = 0;
    for (const mismatch of mismatches) {
      if (repairEsbuildMismatch(cwd, mismatch, slug, exists, copyFile, chmod)) {
        deps.stdout.log(
          `bootstrap: repaired esbuild@${mismatch.version} binary (was ${mismatch.actual})`,
        );
        repaired += 1;
      } else {
        deps.stderr.error(
          `bootstrap: no platform binary available for esbuild@${mismatch.version} at ${slug}`,
        );
      }
    }
    return { detected: mismatches.length, repaired };
  };

  const installStatus = runInherit(deps.spawn, 'pnpm', ['install'], cwd);
  if (installStatus !== 0) {
    const repair = repairDetectedEsbuildMismatches();
    if (repair.detected === 0) {
      deps.stderr.error('bootstrap: pnpm install failed and no known auto-repair applies');
      deps.exit(installStatus);
      return;
    }
    if (repair.repaired === 0) {
      deps.exit(installStatus);
      return;
    }
    const rebuildStatus = runInherit(deps.spawn, 'pnpm', ['rebuild', 'esbuild'], cwd);
    if (rebuildStatus !== 0) {
      deps.stderr.error('bootstrap: pnpm rebuild esbuild failed after binary repair');
      deps.exit(rebuildStatus);
      return;
    }
  } else {
    const repair = repairDetectedEsbuildMismatches();
    if (repair.detected > 0 && repair.repaired === 0) {
      deps.exit(1);
      return;
    }
  }

  if (runInherit(deps.spawn, 'cargo', ['check'], cwd) !== 0) {
    deps.stderr.error('bootstrap: cargo check failed');
    deps.exit(1);
    return;
  }
  if (runInherit(deps.spawn, 'uv', ['sync'], cwd) !== 0) {
    deps.stderr.error('bootstrap: uv sync failed');
    deps.exit(1);
    return;
  }
  deps.stdout.log('bootstrap: complete');
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
