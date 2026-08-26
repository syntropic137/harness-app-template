import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { isMainEntry } from './lib/entrypoint';
import { defaultVendorFs, type VendorFs, verifyAndRepairVendorLinks } from './lib/vendor-links';

export {
  defaultVendorFs,
  VENDOR_SYMLINKS,
  type VendorFs,
  type VendorReport,
  verifyAndRepairVendorLinks,
} from './lib/vendor-links';

export type ChmodFn = (path: string, mode: number) => void;
export type MkdirFn = (path: string, options: { recursive: true }) => void;
export type SymlinkFn = (target: string, path: string) => void;

const REQUIRED_TOOLS = ['bun', 'pnpm', 'cargo', 'uv'] as const;

// Keyed by REQUIRED_TOOLS rather than `string`, so the compiler guarantees
// every required tool carries a hint and the lookup below cannot miss.
const INSTALL_HINTS: Record<(typeof REQUIRED_TOOLS)[number], string> = {
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
  mkdir?: MkdirFn;
  symlink?: SymlinkFn;
  vendorFs?: VendorFs;
}

export interface EsbuildMismatch {
  version: string;
  binPath: string;
  actual: string;
}

export function detectMissingTools(spawn: typeof spawnSync): (typeof REQUIRED_TOOLS)[number][] {
  return REQUIRED_TOOLS.filter(
    (tool) => spawn(tool, ['--version'], { stdio: 'ignore' }).status !== 0,
  );
}

/**
 * Inspect a single `.pnpm` directory entry, returning a mismatch when the
 * entry is an `esbuild@VERSION` package whose installed binary reports a
 * different version. Returns null for every non-mismatch case.
 */
function inspectEsbuildEntry(
  pnpmDir: string,
  entry: string,
  spawn: typeof spawnSync,
  exists: (path: string) => boolean,
): EsbuildMismatch | null {
  const match = entry.match(/^esbuild@(\d+\.\d+\.\d+)$/);
  if (!match) {
    return null;
  }
  const version = match[1] as string;
  const binPath = join(pnpmDir, entry, 'node_modules', 'esbuild', 'bin', 'esbuild');
  if (!exists(binPath)) {
    return null;
  }
  const result = spawn(binPath, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    return null;
  }
  const stdout = result.stdout;
  const actual = (typeof stdout === 'string' ? stdout : '').trim();
  if (actual && actual !== version) {
    return { version, binPath, actual };
  }
  return null;
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
    const mismatch = inspectEsbuildEntry(pnpmDir, entry, spawn, exists);
    if (mismatch) {
      out.push(mismatch);
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
  mkdir: MkdirFn = mkdirSync,
  symlink: SymlinkFn = symlinkSync,
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

  const optionalScopeDir = join(
    cwd,
    'node_modules',
    '.pnpm',
    `esbuild@${mismatch.version}`,
    'node_modules',
    '@esbuild',
  );
  const optionalLink = join(optionalScopeDir, platformArch);
  if (!exists(optionalLink)) {
    mkdir(optionalScopeDir, { recursive: true });
    symlink(
      join(
        '..',
        '..',
        '..',
        `@esbuild+${platformArch}@${mismatch.version}`,
        'node_modules',
        '@esbuild',
        platformArch,
      ),
      optionalLink,
    );
  }
  return true;
}

function runInherit(spawn: typeof spawnSync, command: string, args: string[], cwd: string): number {
  const result = spawn(command, args, { cwd, stdio: 'inherit' });
  return result.status ?? 1;
}

/**
 * Return `value` unless it is null/undefined, in which case the fallback is
 * produced lazily — preserving the short-circuit semantics of `value ??
 * fallback()` so side-effecting defaults (process.cwd(), defaultVendorFs())
 * only run when the dependency is absent.
 */
function orElse<T>(value: T | undefined, fallback: () => T): T {
  return value ?? fallback();
}

/** Resolved filesystem/platform context shared by the esbuild-repair steps. */
interface BootstrapContext {
  cwd: string;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  spawn: typeof spawnSync;
  stdout: Pick<typeof console, 'log'>;
  stderr: Pick<typeof console, 'error'>;
  exists: (path: string) => boolean;
  readdir: (path: string) => string[];
  copyFile: (src: string, dst: string) => void;
  chmod: ChmodFn;
  mkdir: MkdirFn;
  symlink: SymlinkFn;
}

/** Apply real-fs/process defaults to the injected dependencies. */
function resolveContext(deps: BootstrapDeps): BootstrapContext {
  return {
    cwd: orElse(deps.cwd, () => process.cwd()),
    platform: orElse(deps.platform, () => process.platform),
    arch: orElse(deps.arch, () => process.arch),
    spawn: deps.spawn,
    stdout: deps.stdout,
    stderr: deps.stderr,
    exists: orElse(deps.exists, () => existsSync),
    readdir: orElse(deps.readdir, () => readdirSync),
    copyFile: orElse(deps.copyFile, () => copyFileSync),
    chmod: orElse(deps.chmod, () => chmodSync),
    mkdir: orElse(deps.mkdir, () => mkdirSync),
    symlink: orElse(deps.symlink, () => symlinkSync),
  };
}

/** Emit the "missing required tools" report, including install hints. */
function reportMissingTools(
  deps: BootstrapDeps,
  missing: readonly (typeof REQUIRED_TOOLS)[number][],
): void {
  deps.stderr.error(`bootstrap: missing required tools: ${missing.join(', ')}`);
  for (const tool of missing) {
    deps.stderr.error(`bootstrap:   ${tool}: ${INSTALL_HINTS[tool]}`);
  }
}

/** Verify/repair vendor symlinks, log the outcome, return true on any error. */
function reportVendorLinks(deps: BootstrapDeps, cwd: string, vendorFs: VendorFs): boolean {
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
  return vendorReport.errors.length > 0;
}

/** Repair one esbuild mismatch, logging success/failure; return true on repair. */
function repairOneEsbuildMismatch(
  ctx: BootstrapContext,
  mismatch: EsbuildMismatch,
  slug: string,
): boolean {
  const repaired = repairEsbuildMismatch(
    ctx.cwd,
    mismatch,
    slug,
    ctx.exists,
    ctx.copyFile,
    ctx.chmod,
    ctx.mkdir,
    ctx.symlink,
  );
  if (repaired) {
    ctx.stdout.log(
      `bootstrap: repaired esbuild@${mismatch.version} binary (was ${mismatch.actual})`,
    );
    return true;
  }
  ctx.stderr.error(
    `bootstrap: no platform binary available for esbuild@${mismatch.version} at ${slug}`,
  );
  return false;
}

/** Detect and repair every esbuild binary mismatch, returning the tallies. */
function repairDetectedEsbuildMismatches(ctx: BootstrapContext): {
  detected: number;
  repaired: number;
} {
  const mismatches = detectEsbuildMismatches(ctx.cwd, ctx.spawn, ctx.exists, ctx.readdir);
  if (mismatches.length === 0) {
    return { detected: 0, repaired: 0 };
  }
  const slug = platformArchSlug(ctx.platform, ctx.arch);
  ctx.stdout.log(
    `bootstrap: detected ${mismatches.length} esbuild binary mismatch(es); repairing for ${slug}`,
  );
  let repaired = 0;
  for (const mismatch of mismatches) {
    if (repairOneEsbuildMismatch(ctx, mismatch, slug)) {
      repaired += 1;
    }
  }
  return { detected: mismatches.length, repaired };
}

/** Clean-install path: an ignored, unrepairable mismatch is fatal. Returns true if it exited. */
function verifyEsbuildAfterCleanInstall(ctx: BootstrapContext, deps: BootstrapDeps): boolean {
  const repair = repairDetectedEsbuildMismatches(ctx);
  if (repair.detected > 0 && repair.repaired === 0) {
    deps.exit(1);
    return true;
  }
  return false;
}

/** Failed-install path: attempt esbuild auto-repair + rebuild. Returns true if it exited. */
function recoverFailedInstall(
  ctx: BootstrapContext,
  deps: BootstrapDeps,
  installStatus: number,
): boolean {
  const repair = repairDetectedEsbuildMismatches(ctx);
  if (repair.detected === 0) {
    deps.stderr.error('bootstrap: pnpm install failed and no known auto-repair applies');
    deps.exit(installStatus);
    return true;
  }
  if (repair.repaired === 0) {
    deps.exit(installStatus);
    return true;
  }
  const rebuildStatus = runInherit(deps.spawn, 'pnpm', ['rebuild', 'esbuild'], ctx.cwd);
  if (rebuildStatus !== 0) {
    deps.stderr.error('bootstrap: pnpm rebuild esbuild failed after binary repair');
    deps.exit(rebuildStatus);
    return true;
  }
  return false;
}

/** Run `pnpm install` and reconcile esbuild binaries. Returns true if it exited. */
function ensurePnpmInstall(ctx: BootstrapContext, deps: BootstrapDeps): boolean {
  const installStatus = runInherit(deps.spawn, 'pnpm', ['install'], ctx.cwd);
  if (installStatus === 0) {
    return verifyEsbuildAfterCleanInstall(ctx, deps);
  }
  return recoverFailedInstall(ctx, deps, installStatus);
}

/**
 * Compose the project APSS CLI into .apss/bin/ if it is not already there.
 *
 * This is a bootstrap step rather than an optional extra because the `dev`
 * sensors profile REQUIRES the apss-topology reading — it is the only source
 * of the MT01 max-cognitive / max-cyclomatic metrics — so without it the
 * pre-push fitness gate fails closed on a freshly-bootstrapped clone. See the
 * ADR-0028 profile block in harness/.harness/governance.toml.
 *
 * Deliberately does NOT `cargo install apss` on the developer's behalf: that
 * is a multi-minute compile of a global binary outside the repo, which is not
 * a thing `just bootstrap` should do silently. When the composer is absent the
 * step soft-skips with the exact command, matching how every other optional
 * adapter is handled.
 */
function ensureApssInstalled(deps: BootstrapDeps, cwd: string): void {
  if (deps.exists?.(join(cwd, '.apss/bin/apss')) ?? existsSync(join(cwd, '.apss/bin/apss'))) {
    deps.stdout.log('bootstrap: apss already composed (.apss/bin/apss)');
    return;
  }
  if (deps.spawn('apss', ['--help'], { stdio: 'ignore' }).status !== 0) {
    deps.stderr.error(
      'bootstrap: warning: apss composer not found; the pre-push fitness gate needs it',
    );
    deps.stderr.error('bootstrap:   fix: cargo install apss && just apss-install');
    return;
  }
  // `apss install` hard-codes its post-build binary lookup under the repo, so
  // an inherited CARGO_TARGET_DIR (common on shared build-cache hosts) sends it
  // looking in the wrong place. Same unset the `just apss-install` recipe does.
  if (runInherit(deps.spawn, 'env', ['-u', 'CARGO_TARGET_DIR', 'apss', 'install'], cwd) !== 0) {
    deps.stderr.error(
      'bootstrap: warning: `apss install` failed; run `just apss-install` manually',
    );
  }
}

/** Run `cargo check` then `uv sync`. Returns true if either failed and it exited. */
function runFinalChecks(deps: BootstrapDeps, cwd: string): boolean {
  if (runInherit(deps.spawn, 'cargo', ['check'], cwd) !== 0) {
    deps.stderr.error('bootstrap: cargo check failed');
    deps.exit(1);
    return true;
  }
  if (runInherit(deps.spawn, 'uv', ['sync'], cwd) !== 0) {
    deps.stderr.error('bootstrap: uv sync failed');
    deps.exit(1);
    return true;
  }
  return false;
}

export function main(deps: BootstrapDeps): void {
  const ctx = resolveContext(deps);
  const vendorFs = orElse(deps.vendorFs, () => defaultVendorFs());

  const missing = detectMissingTools(deps.spawn);
  if (missing.length > 0) {
    reportMissingTools(deps, missing);
    deps.exit(1);
    return;
  }

  if (reportVendorLinks(deps, ctx.cwd, vendorFs)) {
    deps.exit(1);
    return;
  }

  if (ensurePnpmInstall(ctx, deps)) {
    return;
  }

  if (runFinalChecks(deps, ctx.cwd)) {
    return;
  }

  ensureApssInstalled(deps, ctx.cwd);

  deps.stdout.log('bootstrap: complete');
}

/* v8 ignore next 9 */
if (isMainEntry(import.meta.url)) {
  main({
    spawn: spawnSync,
    stdout: console,
    stderr: console,
    exit: (code: number): never => process.exit(code),
  });
}
